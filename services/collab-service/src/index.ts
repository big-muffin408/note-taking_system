import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { MongoClient, ObjectId } from 'mongodb';
import { WebSocketServer } from 'ws';
import type * as YTypes from 'yjs';
import { errorHandler, notFoundHandler } from './error-handler.js';

const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof import('yjs');
const {
  docs,
  getYDoc,
  setupWSConnection,
} = require('y-websocket/bin/utils') as {
  docs: Map<string, YTypes.Doc & { conns?: Map<unknown, unknown> }>;
  getYDoc: (docName: string, gc?: boolean) => YTypes.Doc & { conns?: Map<unknown, unknown> };
  setupWSConnection: (
    conn: unknown,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean }
  ) => void;
};

const app = express();
const port = Number(process.env.PORT ?? 3004);
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB ?? 'notes';
const persistDebounceMs = Number(process.env.COLLAB_PERSIST_DEBOUNCE_MS ?? 1000);
const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

let mongoClient: MongoClient | null = null;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const loadedDocuments = new Set<string>();
const documentLoadPromises = new Map<string, Promise<YTypes.Doc>>();
const versionSnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const documentLoadedAt = new WeakMap<YTypes.Doc, Date>();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost', 'http://localhost:5173', 'http://localhost:80'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

async function getDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    console.log('collab-service connected to MongoDB');
  }

  return mongoClient.db(dbName);
}

async function loadPersistedUpdate(documentId: string) {
  const db = await getDb();
  const persisted = await db.collection('document_updates').findOne({ documentId });

  if (!persisted?.update) return null;

  if (persisted.update instanceof Uint8Array) return persisted.update;
  if (Buffer.isBuffer(persisted.update)) return new Uint8Array(persisted.update);

  return null;
}

async function persistDocument(documentId: string, ydoc: YTypes.Doc) {
  const db = await getDb();
  const persisted = await db.collection('document_updates').findOne({ documentId });
  const restoredAt = persisted?.restoredAt instanceof Date ? persisted.restoredAt : null;
  const loadedAt = documentLoadedAt.get(ydoc);
  if (restoredAt && loadedAt && loadedAt < restoredAt) {
    return;
  }

  const update = Buffer.from(Y.encodeStateAsUpdate(ydoc));

  await db.collection('document_updates').updateOne(
    { documentId },
    {
      $set: {
        documentId,
        update,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

function schedulePersist(documentId: string, ydoc: YTypes.Doc) {
  const existing = persistTimers.get(documentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    persistTimers.delete(documentId);
    persistDocument(documentId, ydoc).catch((error) => {
      console.error(`Failed to persist collaborative document ${documentId}:`, error);
    });
  }, persistDebounceMs);

  persistTimers.set(documentId, timer);
}

async function ensureDocumentLoaded(documentId: string) {
  const existing = documentLoadPromises.get(documentId);
  if (existing) return existing;

  const ydoc = getYDoc(documentId);

  if (!loadedDocuments.has(documentId)) {
    const loadPromise = (async () => {
      const persistedUpdate = await loadPersistedUpdate(documentId);

      if (persistedUpdate) {
        Y.applyUpdate(ydoc, persistedUpdate);
      }

      ydoc.on('update', () => {
        schedulePersist(documentId, ydoc);
      });

      loadedDocuments.add(documentId);
      documentLoadedAt.set(ydoc, new Date());
      return ydoc;
    })();

    documentLoadPromises.set(documentId, loadPromise);

    try {
      return await loadPromise;
    } finally {
      documentLoadPromises.delete(documentId);
    }
  }

  return ydoc;
}

async function flushDocument(documentId: string, ydoc: YTypes.Doc) {
  const timer = persistTimers.get(documentId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(documentId);
  }

  await persistDocument(documentId, ydoc);
}

async function saveVersionSnapshot(documentId: string, ydoc: YTypes.Doc) {
  try {
    const db = await getDb();
    const persisted = await db.collection('document_updates').findOne({ documentId });
    const restoredAt = persisted?.restoredAt instanceof Date ? persisted.restoredAt : null;
    const loadedAt = documentLoadedAt.get(ydoc);
    if (restoredAt && loadedAt && loadedAt < restoredAt) {
      return;
    }

    const update = Buffer.from(Y.encodeStateAsUpdate(ydoc));

    // Extract text content from the Y.js document for preview/restore compatibility
    let content = '';
    try {
      const yContent = ydoc.getText('content');
      if (yContent) content = yContent.toString();
    } catch {
      // fallback: content stays empty
    }

    // Fetch the document title from the documents collection
    let doc = null;
    try {
      doc = await db.collection('documents').findOne({ _id: new ObjectId(documentId) });
    } catch {
      // documentId might not be a valid ObjectId, that's ok
    }
    const title = doc?.title ?? '未命名笔记';

    await db.collection('versions').insertOne({
      documentId,
      title,
      content,
      yjsUpdate: update,
      modifierId: 'system',
      label: '自动快照',
      createdAt: new Date(),
    });

    // Retention: keep only the latest 50 versions per document (atomic)
    const count = await db.collection('versions').countDocuments({ documentId });
    if (count > 50) {
      const idsToDelete = await db
        .collection('versions')
        .find({ documentId })
        .sort({ createdAt: 1 })
        .limit(count - 50)
        .project({ _id: 1 })
        .toArray();
      if (idsToDelete.length > 0) {
        await db.collection('versions').deleteMany({
          _id: { $in: idsToDelete.map((v) => v._id) },
        });
      }
    }
  } catch (error) {
    console.error(`Failed to save version snapshot for ${documentId}:`, error);
  }
}

function scheduleVersionSnapshot(documentId: string, ydoc: YTypes.Doc) {
  const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const existing = versionSnapshotTimers.get(documentId);
  if (existing) return; // already scheduled

  const timer = setInterval(() => {
    saveVersionSnapshot(documentId, ydoc).catch(() => {});
  }, SNAPSHOT_INTERVAL_MS);

  versionSnapshotTimers.set(documentId, timer);
}

function clearVersionSnapshotTimer(documentId: string) {
  const timer = versionSnapshotTimers.get(documentId);
  if (timer) {
    clearInterval(timer);
    versionSnapshotTimers.delete(documentId);
  }
}

function getDocumentId(request: IncomingMessage) {
  const url = new URL(request.url ?? '/ws/collab/default', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/collab\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getTokenFromRequest(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('token');
  if (token) return token;
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

function verifyToken(token: string): { id: string; email: string } | null {
  try {
    const jwt = require('jsonwebtoken');
    return jwt.verify(token, jwtSecret) as { id: string; email: string };
  } catch {
    return null;
  }
}

async function checkDocumentAccess(userId: string, documentId: string): Promise<boolean> {
  try {
    const db = await getDb();
    let objectId;
    try {
      objectId = new ObjectId(documentId);
    } catch {
      return false;
    }
    const doc = await db.collection('documents').findOne({ _id: objectId });
    if (!doc) return false;
    if (doc.ownerId === userId) return true;

    // Check share via user-service
    const internalHeaders: Record<string, string> = {};
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET ?? '';
    if (internalSecret) internalHeaders['X-Internal-Secret'] = internalSecret;
    const res = await fetch(`${userServiceUrl}/internal/check-access?userId=${encodeURIComponent(userId)}&documentId=${encodeURIComponent(documentId)}`, { headers: internalHeaders });
    if (!res.ok) return false;
    const data = await res.json() as { access: string };
    return data.access === 'read' || data.access === 'write';
  } catch {
    return false;
  }
}

function getConnectionCount() {
  let count = 0;
  docs.forEach((doc) => {
    count += doc.conns?.size ?? 0;
  });
  return count;
}

app.get('/health', (_req, res) => {
  res.json({
    service: 'collab-service',
    status: 'ok',
    documents: docs.size,
    connections: getConnectionCount(),
    timestamp: new Date().toISOString(),
  });
});

// 错误处理中间件
app.use(notFoundHandler);
app.use(errorHandler);

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', async (socket, request) => {
  const documentId = getDocumentId(request);
  if (!documentId) {
    socket.close();
    return;
  }

  // Verify JWT and check document access
  const token = getTokenFromRequest(request);
  const user = token ? verifyToken(token) : null;
  if (!user) {
    socket.close();
    return;
  }

  const hasAccess = await checkDocumentAccess(user.id, documentId);
  if (!hasAccess) {
    socket.close();
    return;
  }

  console.log(`collab client connected: document=${documentId} user=${user.id}`);

  try {
    const ydoc = await ensureDocumentLoaded(documentId);
    setupWSConnection(socket, request, { docName: documentId });

    // Start periodic version snapshots while collaborators are connected
    scheduleVersionSnapshot(documentId, ydoc);

    socket.on('close', () => {
      console.log(`collab client disconnected: document=${documentId}`);
      // Defer to let y-websocket's own close handler remove the connection from
      // ydoc.conns first. Without this, the size check may see stale data.
      process.nextTick(() => {
        const conns = (ydoc as YTypes.Doc & { conns?: Map<unknown, unknown> }).conns;
        if ((conns?.size ?? 0) === 0) {
          // Save a version snapshot on last disconnect and stop the timer
          saveVersionSnapshot(documentId, ydoc).catch(() => {});
          clearVersionSnapshotTimer(documentId);

          // Flush pending changes, then clean up all in-memory state
          flushDocument(documentId, ydoc)
            .catch((error) => {
              console.error(`Failed to flush collaborative document ${documentId}:`, error);
            })
            .finally(() => {
              docs.delete(documentId);
              loadedDocuments.delete(documentId);
              documentLoadPromises.delete(documentId);
            });
        }
      });
    });
  } catch (error) {
    console.error(`Failed to prepare collaborative document ${documentId}:`, error);
    socket.close();
  }
});

server.on('upgrade', (request, socket, head) => {
  const documentId = getDocumentId(request);

  if (!documentId) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit('connection', websocket, request);
  });
});

process.on('SIGTERM', async () => {
  for (const timer of versionSnapshotTimers.values()) clearInterval(timer);
  versionSnapshotTimers.clear();
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  await mongoClient?.close();
  process.exit(0);
});

server.listen(port, () => {
  console.log(`collab-service listening on ${port}`);
});

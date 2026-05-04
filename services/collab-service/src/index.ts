import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import { WebSocketServer } from 'ws';
import type * as YTypes from 'yjs';

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

let mongoClient: MongoClient | null = null;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const loadedDocuments = new Set<string>();

app.use(cors());
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
  const ydoc = getYDoc(documentId);

  if (!loadedDocuments.has(documentId)) {
    const persistedUpdate = await loadPersistedUpdate(documentId);

    if (persistedUpdate) {
      Y.applyUpdate(ydoc, persistedUpdate);
    }

    ydoc.on('update', () => {
      schedulePersist(documentId, ydoc);
    });

    loadedDocuments.add(documentId);
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

function getDocumentId(request: IncomingMessage) {
  const url = new URL(request.url ?? '/ws/collab/default', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/collab\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', async (socket, request) => {
  const documentId = getDocumentId(request);
  if (!documentId) {
    socket.close();
    return;
  }

  console.log(`collab client connected: document=${documentId}`);

  try {
    const ydoc = await ensureDocumentLoaded(documentId);
    setupWSConnection(socket, request, { docName: documentId });

    socket.on('close', () => {
      console.log(`collab client disconnected: document=${documentId}`);
      if ((ydoc.conns?.size ?? 0) === 0) {
        flushDocument(documentId, ydoc).catch((error) => {
          console.error(`Failed to flush collaborative document ${documentId}:`, error);
        });
      }
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
  await mongoClient?.close();
  process.exit(0);
});

server.listen(port, () => {
  console.log(`collab-service listening on ${port}`);
});

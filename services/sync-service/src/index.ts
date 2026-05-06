import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import type { NextFunction, Request, Response } from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3005);
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB ?? 'notes';
const jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}
const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';

let mongoClient: MongoClient | null = null;

interface AuthRequest extends Request {
  userId?: string;
}

interface SyncChange {
  id: string;
  noteId: string;
  type: 'create' | 'update' | 'delete';
  title?: string;
  content?: string;
  createdAt?: string;
  baseUpdatedAt?: string;
}

async function getDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    console.log('sync-service connected to MongoDB');
  }

  return mongoClient.db(dbName);
}

function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), jwtSecret) as { id: string };
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: '无效或已过期的认证令牌' });
  }
}

function serializeNote(note: Record<string, unknown>) {
  return {
    id: (note._id as ObjectId).toHexString(),
    title: note.title,
    content: note.content,
    ownerId: note.ownerId,
    sourcePdfId: note.sourcePdfId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function hasConflict(serverUpdatedAt: unknown, baseUpdatedAt: unknown) {
  if (typeof baseUpdatedAt !== 'string' || !(serverUpdatedAt instanceof Date)) {
    // Cannot determine conflict — conservatively assume conflict to prevent data loss
    return typeof baseUpdatedAt === 'string';
  }

  const baseDate = new Date(baseUpdatedAt);
  if (Number.isNaN(baseDate.getTime())) return true; // malformed baseUpdatedAt = conflict
  return serverUpdatedAt.toISOString() !== baseDate.toISOString();
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost', 'http://localhost:5173', 'http://localhost:80'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({
    service: 'sync-service',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/pull', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    const since = typeof req.query.since === 'string' ? new Date(req.query.since) : null;

    // Capture cursor BEFORE the query to avoid missing documents updated between query and response
    const cursor = new Date().toISOString();

    // Own notes
    const ownQuery: Record<string, unknown> = { ownerId: req.userId };
    if (since && !Number.isNaN(since.getTime())) {
      ownQuery.updatedAt = { $gt: since };
    }

    const ownNotes = await db
      .collection('documents')
      .find(ownQuery)
      .sort({ updatedAt: -1 })
      .toArray();

    // Shared notes
    let sharedNotes: any[] = [];
    try {
      const shareRes = await fetch(`${userServiceUrl}/shares/shared-with-me`, {
        headers: { Authorization: req.headers.authorization ?? '' },
      });
      if (shareRes.ok) {
        const shareData = await shareRes.json() as { items: Array<{ documentId: string }> };
        const sharedIds = shareData.items
          .map((s) => s.documentId)
          .filter((id) => { try { new ObjectId(id); return true; } catch { return false; } });
        if (sharedIds.length > 0) {
          const sharedQuery: Record<string, unknown> = { _id: { $in: sharedIds.map((id) => new ObjectId(id)) } };
          if (since && !Number.isNaN(since.getTime())) {
            sharedQuery.updatedAt = { $gt: since };
          }
          sharedNotes = await db.collection('documents').find(sharedQuery).sort({ updatedAt: -1 }).toArray();
        }
      }
    } catch {
      // ignore share fetch errors
    }

    const allNotes = [...ownNotes, ...sharedNotes];
    allNotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({
      cursor,
      notes: allNotes.map(serializeNote),
    });
  } catch (error) {
    console.error('Pull sync error:', error);
    res.status(500).json({ error: '拉取同步数据失败' });
  }
});

app.post('/push', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const changes = Array.isArray(req.body?.changes) ? (req.body.changes as SyncChange[]) : [];
    const db = await getDb();
    const documents = db.collection('documents');
    const results = [];

    for (const change of changes) {
      try {
        if (change.type === 'create') {
          const now = new Date();
          const doc = {
            title: change.title ?? '未命名笔记',
            content: change.content ?? '<p></p>',
            ownerId: req.userId!,
            createdAt: change.createdAt ? new Date(change.createdAt) : now,
            updatedAt: now,
          };
          const result = await documents.insertOne(doc);
          const saved = await documents.findOne({ _id: result.insertedId });

          results.push({
            queueId: change.id,
            noteId: change.noteId,
            remoteId: result.insertedId.toHexString(),
            status: 'created',
            note: saved ? serializeNote(saved) : undefined,
          });
          continue;
        }

        let objectId: ObjectId;
        try {
          objectId = new ObjectId(change.noteId);
        } catch {
          results.push({
            queueId: change.id,
            noteId: change.noteId,
            status: 'error',
            message: '无效的笔记 ID',
          });
          continue;
        }

        const existing = await documents.findOne({ _id: objectId, ownerId: req.userId });
        if (!existing) {
          results.push({
            queueId: change.id,
            noteId: change.noteId,
            status: change.type === 'delete' ? 'deleted' : 'error',
            message: change.type === 'delete' ? undefined : '笔记不存在',
          });
          continue;
        }

        if (change.type === 'delete') {
          await documents.deleteOne({ _id: objectId, ownerId: req.userId });
          results.push({
            queueId: change.id,
            noteId: change.noteId,
            status: 'deleted',
          });
          continue;
        }

        if (hasConflict(existing.updatedAt, change.baseUpdatedAt)) {
          results.push({
            queueId: change.id,
            noteId: change.noteId,
            status: 'conflict',
            serverNote: serializeNote(existing),
          });
          continue;
        }

        const now = new Date();
        await documents.updateOne(
          { _id: objectId, ownerId: req.userId },
          {
            $set: {
              title: change.title ?? existing.title,
              content: change.content ?? existing.content,
              updatedAt: now,
            },
          },
        );
        const saved = await documents.findOne({ _id: objectId, ownerId: req.userId });

        results.push({
          queueId: change.id,
          noteId: change.noteId,
          status: 'updated',
          note: saved ? serializeNote(saved) : undefined,
        });
      } catch (error) {
        console.error('Push change error:', error);
        results.push({
          queueId: change.id,
          noteId: change.noteId,
          status: 'error',
          message: error instanceof Error ? error.message : '同步失败',
        });
      }
    }

    res.json({ accepted: true, results });
  } catch (error) {
    console.error('Push sync error:', error);
    res.status(500).json({ error: '提交同步数据失败' });
  }
});

process.on('SIGTERM', async () => {
  await mongoClient?.close();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`sync-service listening on ${port}`);
});

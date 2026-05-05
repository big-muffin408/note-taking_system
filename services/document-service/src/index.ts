import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { Client as MinioClient } from 'minio';
import { ObjectId } from 'mongodb';
import { getDb } from './db.js';
import { authMiddleware, type AuthRequest } from './middleware.js';

const app = express();
const port = Number(process.env.PORT ?? 3002);
const aiServiceUrl = process.env.AI_SERVICE_URL ?? 'http://localhost:3003';
const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const minioBucket = process.env.MINIO_BUCKET ?? 'notes-assets';
const minioClient = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ROOT_USER ?? 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'minioadmin'
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

interface PdfParseResponse {
  documentId: string;
  noteId: string;
  fileName: string;
  pages: number;
  parser?: string;
  wordCount: number;
  status: string;
  text: string;
  markdownDraft: string;
  htmlDraft?: string;
  chunks: number;
}

async function auditLog(userId: string, action: string, targetId?: string, metadata?: Record<string, unknown>) {
  try {
    const db = await getDb();
    await db.collection('audit_logs').insertOne({
      userId,
      action,
      targetId,
      targetType: 'document',
      metadata,
      createdAt: new Date(),
    });
  } catch {
    // Silently ignore audit log failures
  }
}

async function checkShareAccess(userId: string, documentId: string): Promise<'none' | 'read' | 'write'> {
  try {
    const res = await fetch(`${userServiceUrl}/internal/check-access?userId=${encodeURIComponent(userId)}&documentId=${encodeURIComponent(documentId)}`);
    if (!res.ok) return 'none';
    const data = await res.json() as { access: string };
    if (data.access === 'write') return 'write';
    if (data.access === 'read') return 'read';
    return 'none';
  } catch {
    return 'none';
  }
}

function stripPdfExtension(fileName: string) {
  return fileName.replace(/\.pdf$/i, '').trim() || 'PDF 笔记';
}

function normalizeUploadedFileName(fileName: string | undefined) {
  const rawName = fileName?.trim() || 'uploaded.pdf';
  const decodedName = Buffer.from(rawName, 'latin1').toString('utf8');
  return decodedName.includes('\uFFFD') ? rawName : decodedName;
}

function sanitizeObjectSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function ensureMinioBucket() {
  const exists = await minioClient.bucketExists(minioBucket).catch((error) => {
    if ((error as { code?: string }).code === 'NoSuchBucket') return false;
    throw error;
  });

  if (!exists) {
    await minioClient.makeBucket(minioBucket);
  }
}

async function putPdfObject(objectName: string, file: Express.Multer.File) {
  await ensureMinioBucket();
  await minioClient.putObject(
    minioBucket,
    objectName,
    file.buffer,
    file.size,
    { 'Content-Type': file.mimetype }
  );
}

async function parsePdfWithAi(
  file: Express.Multer.File,
  pdfId: ObjectId,
  noteId: ObjectId,
  fileName: string
) {
  const form = new FormData();
  const arrayBuffer = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength
  ) as ArrayBuffer;
  form.append('documentId', pdfId.toHexString());
  form.append('noteId', noteId.toHexString());
  form.append(
    'file',
    new Blob([arrayBuffer], { type: file.mimetype || 'application/pdf' }),
    fileName
  );

  const response = await fetch(`${aiServiceUrl}/pdf/parse`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI PDF parse failed (${response.status}): ${detail}`);
  }

  return response.json() as Promise<PdfParseResponse>;
}

app.get('/health', (_req, res) => {
  res.json({
    service: 'document-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Get notes list for authenticated user (own + shared)
app.get('/notes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();

    // Get own notes
    const ownNotes = await db
      .collection('documents')
      .find({ ownerId: req.userId })
      .sort({ updatedAt: -1 })
      .project({ title: 1, content: 1, updatedAt: 1, createdAt: 1, ownerId: 1, sourcePdfId: 1 })
      .toArray();

    // Get shared document IDs from user-service
    let sharedNotes: any[] = [];
    try {
      const shareRes = await fetch(`${userServiceUrl}/shares/shared-with-me`, {
        headers: { Authorization: req.headers.authorization ?? '' },
      });
      if (shareRes.ok) {
        const shareData = await shareRes.json() as { items: Array<{ documentId: string; permission: string }> };
        const sharedIds = shareData.items.map((s) => s.documentId).filter((id) => {
          try { new ObjectId(id); return true; } catch { return false; }
        });
        if (sharedIds.length > 0) {
          const objectIds = sharedIds.map((id) => new ObjectId(id));
          sharedNotes = await db
            .collection('documents')
            .find({ _id: { $in: objectIds } })
            .sort({ updatedAt: -1 })
            .project({ title: 1, content: 1, updatedAt: 1, createdAt: 1, ownerId: 1, sourcePdfId: 1 })
            .toArray();
        }
      }
    } catch {
      // If share check fails, just return own notes
    }

    const allNotes = [...ownNotes, ...sharedNotes];
    allNotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({
      items: allNotes.map((n) => ({
        id: n._id.toHexString(),
        title: n.title,
        ownerId: n.ownerId,
        content: n.content,
        sourcePdfId: n.sourcePdfId,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
      }))
    });
  } catch (error) {
    console.error('List notes error:', error);
    res.status(500).json({ error: '获取笔记列表失败' });
  }
});

// Get single note by ID
app.get('/notes/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const note = await db.collection('documents').findOne({ _id: objectId });

    if (!note) {
      return res.status(404).json({ error: '笔记不存在' });
    }

    if (note.ownerId !== req.userId) {
      const shareAccess = await checkShareAccess(req.userId!, req.params.id);
      if (shareAccess === 'none') {
        return res.status(403).json({ error: '无权访问此笔记' });
      }
    }

    res.json({
      id: note._id.toHexString(),
      title: note.title,
      content: note.content,
      ownerId: note.ownerId,
      sourcePdfId: note.sourcePdfId,
      createdAt: note.createdAt,
      
      updatedAt: note.updatedAt
    });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({ error: '获取笔记失败' });
  }
});

// Create new note
app.post('/notes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    const now = new Date();

    const doc = {
      title: req.body?.title ?? '未命名笔记',
      content: req.body?.content ?? '<p></p>',
      ownerId: req.userId!,
      createdAt: now,
      updatedAt: now
    };

    const result = await db.collection('documents').insertOne(doc);

    await auditLog(req.userId!, 'create_note', result.insertedId.toHexString());

    res.status(201).json({
      id: result.insertedId.toHexString(),
      ...doc
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: '创建笔记失败' });
  }
});

// Update note
app.put('/notes/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const existing = await db.collection('documents').findOne({ _id: objectId });

    if (!existing) {
      return res.status(404).json({ error: '笔记不存在' });
    }

    if (existing.ownerId !== req.userId) {
      const shareAccess = await checkShareAccess(req.userId!, req.params.id);
      if (shareAccess !== 'write') {
        return res.status(403).json({ error: '无权修改此笔记' });
      }
    }

    const baseUpdatedAt = req.body?.baseUpdatedAt;
    const baseDate = typeof baseUpdatedAt === 'string' ? new Date(baseUpdatedAt) : null;
    if (baseDate && !Number.isNaN(baseDate.getTime()) && new Date(existing.updatedAt).toISOString() !== baseDate.toISOString()) {
      return res.status(409).json({
        error: '服务器版本已更新',
        serverNote: {
          id: existing._id.toHexString(),
          title: existing.title,
          content: existing.content,
          ownerId: existing.ownerId,
          sourcePdfId: existing.sourcePdfId,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (req.body?.title !== undefined) updates.title = req.body.title;
    if (req.body?.content !== undefined) updates.content = req.body.content;

    await db.collection('documents').updateOne(
      { _id: objectId },
      { $set: updates }
    );

    await auditLog(req.userId!, 'update_note', req.params.id);

    res.json({
      id: req.params.id,
      title: updates.title ?? existing.title,
      content: updates.content ?? existing.content,
      ownerId: existing.ownerId,
      sourcePdfId: existing.sourcePdfId,
      createdAt: existing.createdAt,
      updatedAt: now
    });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: '更新笔记失败' });
  }
});

// Delete note
app.delete('/notes/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const existing = await db.collection('documents').findOne({ _id: objectId });

    if (!existing) {
      return res.status(404).json({ error: '笔记不存在' });
    }

    if (existing.ownerId !== req.userId) {
      return res.status(403).json({ error: '无权删除此笔记' });
    }

    await db.collection('documents').deleteOne({ _id: objectId });

    await auditLog(req.userId!, 'delete_note', req.params.id);

    // Also clean up shares for this document
    try {
      await fetch(`${userServiceUrl}/internal/cleanup-shares?documentId=${req.params.id}`, { method: 'DELETE' }).catch(() => {});
    } catch { /* ignore */ }

    res.json({ deleted: true, id: req.params.id });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: '删除笔记失败' });
  }
});

app.post('/pdf/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const isPdf =
      file.mimetype === 'application/pdf' ||
      normalizeUploadedFileName(file.originalname).toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return res.status(400).json({ error: '仅支持上传 PDF 文件' });
    }

    const db = await getDb();
    const now = new Date();
    const pdfId = new ObjectId();
    const noteId = new ObjectId();
    const fileName = normalizeUploadedFileName(file.originalname);
    const objectName = `${req.userId}/${pdfId.toHexString()}-${sanitizeObjectSegment(fileName)}`;

    await putPdfObject(objectName, file);
    const parsed = await parsePdfWithAi(file, pdfId, noteId, fileName);
    const content = parsed.htmlDraft ?? parsed.markdownDraft;
    const title = stripPdfExtension(fileName);

    await db.collection('documents').insertOne({
      _id: noteId,
      title,
      content,
      ownerId: req.userId!,
      sourcePdfId: pdfId.toHexString(),
      createdAt: now,
      updatedAt: now
    });

    await db.collection('pdf_assets').insertOne({
      _id: pdfId,
      noteId: noteId.toHexString(),
      ownerId: req.userId!,
      fileName,
      objectName,
      bucket: minioBucket,
      bytes: file.size,
      pages: parsed.pages,
      parser: parsed.parser,
      wordCount: parsed.wordCount,
      chunks: parsed.chunks,
      status: parsed.status,
      createdAt: now,
      updatedAt: now
    });

    await auditLog(req.userId!, 'upload_pdf', noteId.toHexString(), { fileName, pages: parsed.pages });

    res.status(201).json({
      pdfId: pdfId.toHexString(),
      noteId: noteId.toHexString(),
      fileName,
      bytes: file.size,
      pages: parsed.pages,
      parser: parsed.parser,
      status: parsed.status,
      markdownDraft: parsed.markdownDraft
    });
  } catch (error) {
    console.error('PDF upload error:', error);
    const message = error instanceof Error ? error.message : 'PDF 上传解析失败';
    res.status(500).json({ error: message });
  }
});

// --- Version History ---

// Create a version snapshot
app.post('/notes/:id/versions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const note = await db.collection('documents').findOne({ _id: objectId });
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    if (note.ownerId !== req.userId) return res.status(403).json({ error: '无权访问此笔记' });

    const now = new Date();
    const version = {
      documentId: req.params.id,
      title: note.title,
      content: note.content,
      modifierId: req.userId,
      label: req.body?.label ?? null,
      createdAt: now,
    };

    const result = await db.collection('versions').insertOne(version);

    // Retention: keep only the latest 50 versions per document
    const count = await db.collection('versions').countDocuments({ documentId: req.params.id });
    if (count > 50) {
      const old = await db
        .collection('versions')
        .find({ documentId: req.params.id })
        .sort({ createdAt: 1 })
        .limit(count - 50)
        .toArray();
      if (old.length > 0) {
        await db.collection('versions').deleteMany({
          _id: { $in: old.map((v) => v._id) },
        });
      }
    }

    res.status(201).json({
      id: result.insertedId.toHexString(),
      ...version,
    });
  } catch (error) {
    console.error('Create version error:', error);
    res.status(500).json({ error: '创建版本快照失败' });
  }
});

// List versions for a note
app.get('/notes/:id/versions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const note = await db.collection('documents').findOne({ _id: objectId });
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    if (note.ownerId !== req.userId) return res.status(403).json({ error: '无权访问此笔记' });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [versions, total] = await Promise.all([
      db
        .collection('versions')
        .find({ documentId: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection('versions').countDocuments({ documentId: req.params.id }),
    ]);

    res.json({
      items: versions.map((v) => ({
        id: v._id.toHexString(),
        documentId: v.documentId,
        title: v.title,
        modifierId: v.modifierId,
        label: v.label,
        createdAt: v.createdAt,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('List versions error:', error);
    res.status(500).json({ error: '获取版本列表失败' });
  }
});

// Get a specific version
app.get('/notes/:id/versions/:versionId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const note = await db.collection('documents').findOne({ _id: objectId });
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    if (note.ownerId !== req.userId) return res.status(403).json({ error: '无权访问此笔记' });

    let versionObjectId: ObjectId;
    try {
      versionObjectId = new ObjectId(req.params.versionId);
    } catch {
      return res.status(400).json({ error: '无效的版本 ID' });
    }

    const version = await db.collection('versions').findOne({
      _id: versionObjectId,
      documentId: req.params.id,
    });

    if (!version) return res.status(404).json({ error: '版本不存在' });

    const hasYjsUpdate = Boolean(version.yjsUpdate);

    res.json({
      id: version._id.toHexString(),
      documentId: version.documentId,
      title: version.title,
      content: version.content ?? '',
      hasYjsUpdate,
      modifierId: version.modifierId,
      label: version.label,
      createdAt: version.createdAt,
    });
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({ error: '获取版本失败' });
  }
});

// Restore a version
app.post('/notes/:id/versions/:versionId/restore', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: '无效的笔记 ID' });
    }

    const note = await db.collection('documents').findOne({ _id: objectId });
    if (!note) return res.status(404).json({ error: '笔记不存在' });
    if (note.ownerId !== req.userId) return res.status(403).json({ error: '无权修改此笔记' });

    let versionObjectId: ObjectId;
    try {
      versionObjectId = new ObjectId(req.params.versionId);
    } catch {
      return res.status(400).json({ error: '无效的版本 ID' });
    }

    const version = await db.collection('versions').findOne({
      _id: versionObjectId,
      documentId: req.params.id,
    });

    if (!version) return res.status(404).json({ error: '版本不存在' });

    const now = new Date();
    const currentCollaborativeState = await db.collection('document_updates').findOne({
      documentId: req.params.id,
    });

    // Save current state as a new version before restoring
    await db.collection('versions').insertOne({
      documentId: req.params.id,
      title: note.title,
      content: note.content,
      yjsUpdate: currentCollaborativeState?.update,
      modifierId: req.userId,
      label: '恢复前自动快照',
      createdAt: now,
    });

    if (version.yjsUpdate) {
      await db.collection('document_updates').updateOne(
        { documentId: req.params.id },
        {
          $set: {
            documentId: req.params.id,
            update: version.yjsUpdate,
            restoredAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      );

      await db.collection('documents').updateOne(
        { _id: objectId },
        {
          $set: {
            title: version.title,
            updatedAt: now,
          },
        },
      );

      return res.json({
        id: req.params.id,
        title: version.title,
        content: note.content,
        ownerId: note.ownerId,
        sourcePdfId: note.sourcePdfId,
        createdAt: note.createdAt,
        updatedAt: now,
        restoredYjs: true,
      });
    }

    await db.collection('document_updates').updateOne(
      { documentId: req.params.id },
      {
        $set: {
          documentId: req.params.id,
          restoredAt: now,
          updatedAt: now,
        },
        $unset: {
          update: '',
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection('documents').updateOne(
      { _id: objectId },
      {
        $set: {
          title: version.title,
          content: version.content ?? '<p></p>',
          updatedAt: now,
        },
      },
    );

    res.json({
      id: req.params.id,
      title: version.title,
      content: version.content ?? '<p></p>',
      ownerId: note.ownerId,
      sourcePdfId: note.sourcePdfId,
      createdAt: note.createdAt,
      updatedAt: now,
      restoredYjs: false,
    });
  } catch (error) {
    console.error('Restore version error:', error);
    res.status(500).json({ error: '恢复版本失败' });
  }
});

// Internal: check if a user owns a document (used by user-service for share authorization)
app.get('/internal/check-ownership', async (req, res) => {
  try {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    const documentId = typeof req.query.documentId === 'string' ? req.query.documentId : '';

    if (!userId || !documentId) {
      return res.status(400).json({ error: '缺少 userId 或 documentId' });
    }

    const db = await getDb();
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(documentId);
    } catch {
      return res.json({ owner: false });
    }

    const doc = await db.collection('documents').findOne({ _id: objectId });
    if (!doc) return res.json({ owner: false });

    res.json({ owner: doc.ownerId === userId });
  } catch (error) {
    console.error('Check ownership error:', error);
    res.status(500).json({ error: '检查所有权失败' });
  }
});

app.listen(port, () => {
  console.log(`document-service listening on ${port}`);
});

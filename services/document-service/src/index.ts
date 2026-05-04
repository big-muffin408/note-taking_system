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

function stripPdfExtension(fileName: string) {
  return fileName.replace(/\.pdf$/i, '').trim() || 'PDF 笔记';
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

async function parsePdfWithAi(file: Express.Multer.File, pdfId: ObjectId, noteId: ObjectId) {
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
    file.originalname
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

// Get notes list for authenticated user
app.get('/notes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    const notes = await db
      .collection('documents')
      .find({ ownerId: req.userId })
      .sort({ updatedAt: -1 })
      .project({ title: 1, updatedAt: 1, createdAt: 1, ownerId: 1 })
      .toArray();

    res.json({
      items: notes.map((n) => ({
        id: n._id.toHexString(),
        title: n.title,
        ownerId: n.ownerId,
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
      return res.status(403).json({ error: '无权访问此笔记' });
    }

    res.json({
      id: note._id.toHexString(),
      title: note.title,
      content: note.content,
      ownerId: note.ownerId,
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
      return res.status(403).json({ error: '无权修改此笔记' });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.title !== undefined) updates.title = req.body.title;
    if (req.body?.content !== undefined) updates.content = req.body.content;

    await db.collection('documents').updateOne(
      { _id: objectId },
      { $set: updates }
    );

    res.json({
      id: req.params.id,
      ...updates
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
      file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return res.status(400).json({ error: '仅支持上传 PDF 文件' });
    }

    const db = await getDb();
    const now = new Date();
    const pdfId = new ObjectId();
    const noteId = new ObjectId();
    const fileName = file.originalname || 'uploaded.pdf';
    const objectName = `${req.userId}/${pdfId.toHexString()}-${sanitizeObjectSegment(fileName)}`;

    await putPdfObject(objectName, file);
    const parsed = await parsePdfWithAi(file, pdfId, noteId);
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

app.listen(port, () => {
  console.log(`document-service listening on ${port}`);
});

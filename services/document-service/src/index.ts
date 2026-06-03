import cors from 'cors';
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { Client as MinioClient } from 'minio';
import { ObjectId } from 'mongodb';
import { getDb } from './db.js';
import { authMiddleware, type AuthRequest } from './middleware.js';
import { errorHandler, notFoundHandler, AppError, ValidationError, NotFoundError } from './error-handler.js';

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
const internalServiceSecret = process.env.INTERNAL_SERVICE_SECRET ?? '';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost', 'http://localhost:5173', 'http://localhost:80'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
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
  assets?: Array<{
    path: string;
    mimeType: string;
    dataBase64: string;
  }>;
  assetCount?: number;
  fallbackReason?: string;
  warnings?: string[];
  chunks: number;
}

type PdfJobStatus = 'queued' | 'parsing' | 'parsed' | 'failed';

interface PdfJobResponse {
  jobId: string;
  pdfId: string;
  noteId?: string;
  fileName: string;
  bytes: number;
  status: PdfJobStatus;
  parser?: string;
  pages?: number;
  wordCount?: number;
  chunks?: number;
  assetCount?: number;
  fallbackReason?: string;
  warnings?: string[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PdfFileInput {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
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
    const headers: Record<string, string> = {};
    if (internalServiceSecret) headers['X-Internal-Secret'] = internalServiceSecret;
    const res = await fetch(`${userServiceUrl}/internal/check-access?userId=${encodeURIComponent(userId)}&documentId=${encodeURIComponent(documentId)}`, { headers });
    if (!res.ok) return 'none';
    const data = await res.json() as { access: string };
    if (data.access === 'write') return 'write';
    if (data.access === 'read') return 'read';
    return 'none';
  } catch {
    return 'none';
  }
}

// Fetch the set of document IDs the user has favorited (stored per-user in user-service).
async function getUserFavorites(userId: string): Promise<Set<string>> {
  try {
    const headers: Record<string, string> = {};
    if (internalServiceSecret) headers['X-Internal-Secret'] = internalServiceSecret;
    const res = await fetch(`${userServiceUrl}/internal/favorites?userId=${encodeURIComponent(userId)}`, { headers });
    if (!res.ok) return new Set();
    const data = await res.json() as { documentIds: string[] };
    return new Set(data.documentIds ?? []);
  } catch {
    return new Set();
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

function sanitizeAssetPath(value: string) {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => sanitizeObjectSegment(segment).replace(/^_+$/, 'asset'))
    .filter(Boolean)
    .join('/');
}

function normalizeAssetRef(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  const withoutFragment = trimmed.split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function imageRefKeys(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const fileName = normalized.split('/').pop() ?? normalized;
  return [normalized, `./${normalized}`, fileName];
}

function isExternalImageRef(value: string) {
  return /^(https?:|data:|blob:|\/api\/doc\/images\/)/i.test(value.trim());
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

async function putPdfObject(objectName: string, file: PdfFileInput) {
  await ensureMinioBucket();
  await minioClient.putObject(
    minioBucket,
    objectName,
    file.buffer,
    file.size,
    { 'Content-Type': file.mimetype }
  );
}

async function putExtractedPdfAssets(
  userId: string,
  pdfId: ObjectId,
  assets: PdfParseResponse['assets'] = []
) {
  await ensureMinioBucket();

  const refToUrl = new Map<string, string>();
  const storedAssets: Array<{ sourcePath: string; objectName: string; url: string; mimeType: string; bytes: number }> = [];

  for (const asset of assets) {
    if (!asset.path || !asset.dataBase64) continue;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(asset.dataBase64, 'base64');
    } catch {
      continue;
    }

    if (!buffer.length) continue;

    const objectName = `${userId}/pdf-assets/${pdfId.toHexString()}/${sanitizeAssetPath(asset.path)}`;
    const mimeType = asset.mimeType || 'application/octet-stream';

    await minioClient.putObject(
      minioBucket,
      objectName,
      buffer,
      buffer.length,
      { 'Content-Type': mimeType }
    );

    const url = `/api/doc/images/${encodeURIComponent(objectName)}`;
    for (const key of imageRefKeys(asset.path)) {
      refToUrl.set(key, url);
    }
    storedAssets.push({ sourcePath: asset.path, objectName, url, mimeType, bytes: buffer.length });
  }

  return { refToUrl, storedAssets };
}

function resolveExtractedImageUrl(refToUrl: Map<string, string>, rawRef: string) {
  if (isExternalImageRef(rawRef)) return rawRef;
  const normalizedRef = normalizeAssetRef(rawRef).replace(/\\/g, '/').replace(/^\.\//, '');
  return refToUrl.get(normalizedRef) ?? refToUrl.get(`./${normalizedRef}`) ?? refToUrl.get(normalizedRef.split('/').pop() ?? normalizedRef) ?? rawRef;
}

function rewriteMarkdownImageRefs(markdown: string, refToUrl: Map<string, string>) {
  return markdown.replace(/!\[([^\]]*)]\(([^)\s]+)(\s+['"][^'"]*['"])?\)/g, (match, alt: string, src: string, title: string = '') => {
    const nextSrc = resolveExtractedImageUrl(refToUrl, src);
    if (nextSrc === src) return match;
    return `![${alt}](${nextSrc}${title})`;
  });
}

function rewriteHtmlImageRefs(html: string, refToUrl: Map<string, string>) {
  return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (match, before: string, src: string, after: string) => {
    const nextSrc = resolveExtractedImageUrl(refToUrl, src);
    if (nextSrc === src) return match;
    return `${before}${nextSrc}${after}`;
  });
}

async function parsePdfWithAi(
  file: PdfFileInput,
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

  const aiHeaders: Record<string, string> = {};
  const aiServiceSecret = process.env.AI_SERVICE_SECRET ?? '';
  if (aiServiceSecret) aiHeaders['Authorization'] = `Bearer ${aiServiceSecret}`;
  const response = await fetch(`${aiServiceUrl}/pdf/parse`, {
    method: 'POST',
    headers: aiHeaders,
    body: form
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI PDF parse failed (${response.status}): ${detail}`);
  }

  return response.json() as Promise<PdfParseResponse>;
}

function validateUploadedPdf(file: Express.Multer.File | undefined): { file: Express.Multer.File; fileName: string } {
  if (!file) {
    throw new ValidationError('请上传 PDF 文件');
  }

  const fileName = normalizeUploadedFileName(file.originalname);
  const isPdf =
    file.mimetype === 'application/pdf' ||
    fileName.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    throw new ValidationError('仅支持上传 PDF 文件');
  }

  if (file.buffer.length < 4 || file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new ValidationError('文件内容不是有效的 PDF 格式');
  }

  return { file, fileName };
}

function pdfJobToResponse(job: Record<string, any>): PdfJobResponse {
  return {
    jobId: job._id.toHexString(),
    pdfId: job.pdfId,
    noteId: job.noteId,
    fileName: job.fileName,
    bytes: job.bytes,
    status: job.status,
    parser: job.parser,
    pages: job.pages,
    wordCount: job.wordCount,
    chunks: job.chunks,
    assetCount: job.assetCount,
    fallbackReason: job.fallbackReason,
    warnings: job.warnings ?? [],
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function finalizeParsedPdf(
  userId: string,
  pdfId: ObjectId,
  noteId: ObjectId,
  fileName: string,
  objectName: string,
  bytes: number,
  parsed: PdfParseResponse,
) {
  const db = await getDb();
  const now = new Date();
  const { refToUrl, storedAssets } = await putExtractedPdfAssets(userId, pdfId, parsed.assets);
  const markdownDraft = rewriteMarkdownImageRefs(parsed.markdownDraft, refToUrl);
  const htmlDraft = parsed.htmlDraft ? rewriteHtmlImageRefs(parsed.htmlDraft, refToUrl) : undefined;
  const content = htmlDraft ?? markdownDraft;
  const title = stripPdfExtension(fileName);

  await db.collection('documents').updateOne(
    { _id: noteId },
    {
      $setOnInsert: {
        _id: noteId,
        createdAt: now,
      },
      $set: {
        title,
        content,
        ownerId: userId,
        sourcePdfId: pdfId.toHexString(),
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  await db.collection('pdf_assets').updateOne(
    { _id: pdfId },
    {
      $setOnInsert: {
        _id: pdfId,
        createdAt: now,
      },
      $set: {
        noteId: noteId.toHexString(),
        ownerId: userId,
        fileName,
        objectName,
        bucket: minioBucket,
        bytes,
        pages: parsed.pages,
        parser: parsed.parser,
        wordCount: parsed.wordCount,
        chunks: parsed.chunks,
        assetCount: parsed.assetCount ?? storedAssets.length,
        fallbackReason: parsed.fallbackReason,
        warnings: parsed.warnings ?? [],
        extractedImages: storedAssets,
        status: parsed.status,
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  return {
    noteId: noteId.toHexString(),
    markdownDraft,
    pages: parsed.pages,
    parser: parsed.parser,
    wordCount: parsed.wordCount,
    chunks: parsed.chunks,
    assetCount: parsed.assetCount ?? storedAssets.length,
    fallbackReason: parsed.fallbackReason,
    warnings: parsed.warnings ?? [],
    status: parsed.status,
  };
}

async function processPdfJob(jobId: ObjectId, initialFile?: PdfFileInput) {
  const db = await getDb();
  const now = new Date();
  const job = await db.collection('pdf_parse_jobs').findOne({ _id: jobId });
  if (!job) return;

  await db.collection('pdf_parse_jobs').updateOne(
    { _id: jobId },
    { $set: { status: 'parsing', error: null, updatedAt: now }, $inc: { attempts: 1 } },
  );
  await db.collection('pdf_assets').updateOne(
    { _id: new ObjectId(job.pdfId) },
    { $set: { status: 'parsing', updatedAt: now } },
  );

  try {
    let file = initialFile;
    if (!file) {
      const objectStream = await minioClient.getObject(minioBucket, job.objectName);
      file = {
        buffer: await streamToBuffer(objectStream),
        mimetype: 'application/pdf',
        originalname: job.fileName,
        size: job.bytes,
      };
    }

    const pdfId = new ObjectId(job.pdfId);
    const noteId = new ObjectId(job.noteId);
    const parsed = await parsePdfWithAi(file, pdfId, noteId, job.fileName);
    const result = await finalizeParsedPdf(job.ownerId, pdfId, noteId, job.fileName, job.objectName, job.bytes, parsed);
    const finishedAt = new Date();

    await db.collection('pdf_parse_jobs').updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'parsed',
          noteId: result.noteId,
          parser: result.parser,
          pages: result.pages,
          wordCount: result.wordCount,
          chunks: result.chunks,
          assetCount: result.assetCount,
          fallbackReason: result.fallbackReason,
          warnings: result.warnings,
          error: null,
          updatedAt: finishedAt,
        },
      },
    );
    await auditLog(job.ownerId, 'upload_pdf', result.noteId, { fileName: job.fileName, pages: result.pages, asyncJobId: jobId.toHexString() });
  } catch (error) {
    const failedAt = new Date();
    const message = error instanceof Error ? error.message : 'PDF 上传解析失败';
    await db.collection('pdf_parse_jobs').updateOne(
      { _id: jobId },
      { $set: { status: 'failed', error: message, updatedAt: failedAt } },
    );
    await db.collection('pdf_assets').updateOne(
      { _id: new ObjectId(job.pdfId) },
      { $set: { status: 'failed', error: message, updatedAt: failedAt } },
    );
  }
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

    const favorites = await getUserFavorites(req.userId!);

    res.json({
      items: allNotes.map((n) => ({
        id: n._id.toHexString(),
        title: n.title,
        ownerId: n.ownerId,
        content: n.content,
        sourcePdfId: n.sourcePdfId,
        starred: favorites.has(n._id.toHexString()),
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

    const favorites = await getUserFavorites(req.userId!);

    res.json({
      id: note._id.toHexString(),
      title: note.title,
      content: note.content,
      ownerId: note.ownerId,
      sourcePdfId: note.sourcePdfId,
      starred: favorites.has(note._id.toHexString()),
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

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (req.body?.title !== undefined) updates.title = req.body.title;
    if (req.body?.content !== undefined) updates.content = req.body.content;

    // Atomic conditional update: only succeeds if the document hasn't changed since the client read it
    if (baseDate && !Number.isNaN(baseDate.getTime())) {
      const result = await db.collection('documents').findOneAndUpdate(
        { _id: objectId, updatedAt: existing.updatedAt },
        { $set: updates },
        { returnDocument: 'after' }
      );

      if (!result) {
        // Document was modified between our read and write — conflict
        const fresh = await db.collection('documents').findOne({ _id: objectId });
        return res.status(409).json({
          error: '服务器版本已更新',
          serverNote: fresh ? {
            id: fresh._id.toHexString(),
            title: fresh.title,
            content: fresh.content,
            ownerId: fresh.ownerId,
            sourcePdfId: fresh.sourcePdfId,
            createdAt: fresh.createdAt,
            updatedAt: fresh.updatedAt,
          } : undefined,
        });
      }
    } else {
      await db.collection('documents').updateOne(
        { _id: objectId },
        { $set: updates }
      );
    }

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

    // Also clean up shares and favorites for this document
    try {
      const cleanupHeaders: Record<string, string> = {};
      if (internalServiceSecret) cleanupHeaders['X-Internal-Secret'] = internalServiceSecret;
      await Promise.all([
        fetch(`${userServiceUrl}/internal/cleanup-shares?documentId=${req.params.id}`, {
          method: 'DELETE',
          headers: cleanupHeaders,
        }).catch(() => {}),
        fetch(`${userServiceUrl}/internal/cleanup-favorites?documentId=${req.params.id}`, {
          method: 'DELETE',
          headers: cleanupHeaders,
        }).catch(() => {}),
      ]);
    } catch { /* ignore */ }

    res.json({ deleted: true, id: req.params.id });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: '删除笔记失败' });
  }
});

app.post('/pdf/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const { file, fileName } = validateUploadedPdf(req.file);

    const db = await getDb();
    const pdfId = new ObjectId();
    const noteId = new ObjectId();
    const objectName = `${req.userId}/${pdfId.toHexString()}-${sanitizeObjectSegment(fileName)}`;

    await putPdfObject(objectName, file);
    const parsed = await parsePdfWithAi(file, pdfId, noteId, fileName);
    const result = await finalizeParsedPdf(req.userId!, pdfId, noteId, fileName, objectName, file.size, parsed);

    await auditLog(req.userId!, 'upload_pdf', noteId.toHexString(), { fileName, pages: result.pages });

    res.status(201).json({
      pdfId: pdfId.toHexString(),
      noteId: noteId.toHexString(),
      fileName,
      bytes: file.size,
      pages: result.pages,
      parser: result.parser,
      wordCount: result.wordCount,
      chunks: result.chunks,
      assetCount: result.assetCount,
      fallbackReason: result.fallbackReason,
      warnings: result.warnings,
      status: result.status,
      markdownDraft: result.markdownDraft
    });
  } catch (error) {
    console.error('PDF upload error:', error);
    const message = error instanceof Error ? error.message : 'PDF 上传解析失败';
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: message });
  }
});

app.post('/pdf/jobs', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const { file, fileName } = validateUploadedPdf(req.file);
    const db = await getDb();
    const now = new Date();
    const jobId = new ObjectId();
    const pdfId = new ObjectId();
    const noteId = new ObjectId();
    const objectName = `${req.userId}/${pdfId.toHexString()}-${sanitizeObjectSegment(fileName)}`;

    await putPdfObject(objectName, file);

    await db.collection('pdf_assets').insertOne({
      _id: pdfId,
      noteId: noteId.toHexString(),
      ownerId: req.userId!,
      fileName,
      objectName,
      bucket: minioBucket,
      bytes: file.size,
      status: 'queued',
      warnings: [],
      extractedImages: [],
      createdAt: now,
      updatedAt: now,
    });

    await db.collection('pdf_parse_jobs').insertOne({
      _id: jobId,
      pdfId: pdfId.toHexString(),
      noteId: noteId.toHexString(),
      ownerId: req.userId!,
      fileName,
      objectName,
      bytes: file.size,
      status: 'queued',
      attempts: 0,
      warnings: [],
      createdAt: now,
      updatedAt: now,
    });

    if (process.env.DISABLE_PDF_JOB_WORKER !== 'true') {
      setImmediate(() => {
        void processPdfJob(jobId, {
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
          size: file.size,
        });
      });
    }

    res.status(202).json({
      jobId: jobId.toHexString(),
      pdfId: pdfId.toHexString(),
      status: 'queued',
    });
  } catch (error) {
    console.error('Create PDF job error:', error);
    const message = error instanceof Error ? error.message : 'PDF 上传失败';
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: message });
  }
});

app.get('/pdf/jobs/:jobId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let jobId: ObjectId;
    try {
      jobId = new ObjectId(req.params.jobId);
    } catch {
      return res.status(400).json({ error: '无效的 PDF 任务 ID' });
    }

    const job = await db.collection('pdf_parse_jobs').findOne({ _id: jobId, ownerId: req.userId });
    if (!job) return res.status(404).json({ error: 'PDF 解析任务不存在' });

    res.json(pdfJobToResponse(job));
  } catch (error) {
    console.error('Get PDF job error:', error);
    res.status(500).json({ error: '获取 PDF 解析任务失败' });
  }
});

app.post('/pdf/jobs/:jobId/retry', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let jobId: ObjectId;
    try {
      jobId = new ObjectId(req.params.jobId);
    } catch {
      return res.status(400).json({ error: '无效的 PDF 任务 ID' });
    }

    const job = await db.collection('pdf_parse_jobs').findOne({ _id: jobId, ownerId: req.userId });
    if (!job) return res.status(404).json({ error: 'PDF 解析任务不存在' });
    if (job.status !== 'failed') {
      return res.status(409).json({ error: '只有失败的 PDF 解析任务可以重试' });
    }

    const now = new Date();
    await db.collection('pdf_parse_jobs').updateOne(
      { _id: jobId },
      { $set: { status: 'queued', error: null, updatedAt: now } },
    );
    await db.collection('pdf_assets').updateOne(
      { _id: new ObjectId(job.pdfId) },
      { $set: { status: 'queued', error: null, updatedAt: now } },
    );

    if (process.env.DISABLE_PDF_JOB_WORKER !== 'true') {
      setImmediate(() => {
        void processPdfJob(jobId);
      });
    }

    const updated = await db.collection('pdf_parse_jobs').findOne({ _id: jobId });
    res.status(202).json(pdfJobToResponse(updated!));
  } catch (error) {
    console.error('Retry PDF job error:', error);
    res.status(500).json({ error: '重试 PDF 解析任务失败' });
  }
});

// --- Image Upload & Serve ---

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
]);

app.post('/images/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '请上传图片文件' });
    }

    if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
      return res.status(400).json({ error: '仅支持上传图片文件 (JPEG, PNG, GIF, WebP, SVG, BMP, TIFF)' });
    }

    const ext = file.originalname.split('.').pop() || 'bin';
    const imageId = crypto.randomUUID();
    const objectName = `${req.userId}/images/${imageId}.${sanitizeObjectSegment(ext)}`;

    await ensureMinioBucket();
    await minioClient.putObject(
      minioBucket,
      objectName,
      file.buffer,
      file.size,
      { 'Content-Type': file.mimetype }
    );

    const url = `/api/doc/images/${encodeURIComponent(objectName)}`;

    res.status(201).json({ url, key: objectName, fileName: file.originalname, bytes: file.size });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: '图片上传失败' });
  }
});

app.get('/images/:key(*)', async (req, res) => {
  try {
    const objectName = req.params.key;
    if (!objectName) {
      return res.status(400).json({ error: '缺少图片 key' });
    }

    const stream = await minioClient.getObject(minioBucket, objectName);
    const stat = await minioClient.statObject(minioBucket, objectName);

    res.set('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');

    stream.pipe(res);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NoSuchKey' || code === 'NotFound') {
      return res.status(404).json({ error: '图片不存在' });
    }
    console.error('Image serve error:', error);
    res.status(500).json({ error: '获取图片失败' });
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

    // Retention: keep only the latest 50 versions per document (atomic)
    const count = await db.collection('versions').countDocuments({ documentId: req.params.id });
    if (count > 50) {
      const idsToDelete = await db
        .collection('versions')
        .find({ documentId: req.params.id })
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

function requireInternalAuth(req: express.Request, res: express.Response): boolean {
  if (!internalServiceSecret) return true;
  const secret = req.headers['x-internal-secret'];
  if (secret === internalServiceSecret) return true;
  res.status(403).json({ error: 'Forbidden: invalid internal service credentials' });
  return false;
}

// Internal: check if a user owns a document (used by user-service for share authorization)
app.get('/internal/check-ownership', async (req, res) => {
  if (!requireInternalAuth(req, res)) return;
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

// 错误处理中间件
app.use(notFoundHandler);
app.use(errorHandler);

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`document-service listening on ${port}`);
  });
}

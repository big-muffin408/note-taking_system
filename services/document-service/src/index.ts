import cors from 'cors';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3002);

app.use(cors());
app.use(express.json());

const notes = [
  {
    id: 'note-001',
    title: 'AI 协作笔记系统项目说明',
    content: '# 项目骨架\n\n这里是 Markdown 编辑器的占位内容。',
    updatedAt: new Date().toISOString()
  }
];

app.get('/health', (_req, res) => {
  res.json({
    service: 'document-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.get('/notes', (_req, res) => {
  res.json({ items: notes });
});

app.post('/notes', (req, res) => {
  const now = new Date().toISOString();
  const note = {
    id: `note-${Date.now()}`,
    title: req.body?.title ?? '未命名笔记',
    content: req.body?.content ?? '',
    updatedAt: now
  };
  notes.unshift(note);
  res.status(201).json(note);
});

app.post('/pdf/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const fileName = req.header('x-file-name') ?? 'mock.pdf';
  res.status(202).json({
    id: `pdf-${Date.now()}`,
    fileName,
    bytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
    status: 'accepted',
    markdownDraft: '# PDF Markdown 草稿\n\nPDF 解析将在后续迭代接入 MinerU 或 Marker。'
  });
});

app.listen(port, () => {
  console.log(`document-service listening on ${port}`);
});

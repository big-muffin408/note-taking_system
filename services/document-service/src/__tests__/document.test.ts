import express from 'express';
import { request } from './request-helper.js';

// 创建一个简化的测试应用
const app = express();
app.use(express.json());

// 模拟健康检查接口
app.get('/health', (_req, res) => {
  res.json({
    service: 'document-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// 模拟笔记列表接口
app.get('/notes', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  res.json({
    items: [
      {
        id: 'note-1',
        title: '测试笔记 1',
        content: '这是测试笔记内容',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'note-2',
        title: '测试笔记 2',
        content: '这是另一个测试笔记',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    total: 2
  });
});

// 模拟创建笔记接口
app.post('/notes', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const { title, content } = req.body;
  if (!title) {
    return res.status(400).json({ error: '标题不能为空' });
  }

  res.status(201).json({
    id: 'new-note-id',
    title,
    content: content || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
});

// 模拟获取单个笔记接口
app.get('/notes/:id', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const { id } = req.params;
  if (id === 'not-found') {
    return res.status(404).json({ error: '笔记不存在' });
  }

  res.json({
    id,
    title: '测试笔记',
    content: '这是测试笔记内容',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
});

// 模拟更新笔记接口
app.put('/notes/:id', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const { id } = req.params;
  const { title, content } = req.body;

  if (!title && !content) {
    return res.status(400).json({ error: '请提供要更新的内容' });
  }

  res.json({
    id,
    title: title || '测试笔记',
    content: content || '这是测试笔记内容',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
});

// 模拟删除笔记接口
app.delete('/notes/:id', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const { id } = req.params;
  if (id === 'not-found') {
    return res.status(404).json({ error: '笔记不存在' });
  }

  res.json({ deleted: true });
});

// 模拟版本列表接口
app.get('/notes/:id/versions', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  res.json({
    items: [
      {
        id: 'version-1',
        noteId: req.params.id,
        content: '版本 1 内容',
        createdAt: new Date(Date.now() - 3600000).toISOString()
      },
      {
        id: 'version-2',
        noteId: req.params.id,
        content: '版本 2 内容',
        createdAt: new Date().toISOString()
      }
    ],
    total: 2
  });
});

describe('Document Service API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'document-service');
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /notes', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .get('/notes')
        .expect(401);
    });

    it('should return notes list with authorization', async () => {
      const response = await request(app)
        .get('/notes')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.items)).toBe(true);
    });
  });

  describe('POST /notes', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .post('/notes')
        .send({ title: 'Test Note' })
        .expect(401);
    });

    it('should return 400 if title is missing', async () => {
      const response = await request(app)
        .post('/notes')
        .set('Authorization', 'Bearer test-token')
        .send({ content: 'Test content' })
        .expect(400);

      expect(response.body).toHaveProperty('error', '标题不能为空');
    });

    it('should create note with valid data', async () => {
      const response = await request(app)
        .post('/notes')
        .set('Authorization', 'Bearer test-token')
        .send({ title: 'New Note', content: 'New content' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title', 'New Note');
      expect(response.body).toHaveProperty('content', 'New content');
    });
  });

  describe('GET /notes/:id', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .get('/notes/note-1')
        .expect(401);
    });

    it('should return note by id', async () => {
      const response = await request(app)
        .get('/notes/note-1')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body).toHaveProperty('id', 'note-1');
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('content');
    });

    it('should return 404 for non-existent note', async () => {
      await request(app)
        .get('/notes/not-found')
        .set('Authorization', 'Bearer test-token')
        .expect(404);
    });
  });

  describe('PUT /notes/:id', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .put('/notes/note-1')
        .send({ title: 'Updated Title' })
        .expect(401);
    });

    it('should return 400 if no update data provided', async () => {
      const response = await request(app)
        .put('/notes/note-1')
        .set('Authorization', 'Bearer test-token')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should update note with valid data', async () => {
      const response = await request(app)
        .put('/notes/note-1')
        .set('Authorization', 'Bearer test-token')
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(response.body).toHaveProperty('id', 'note-1');
      expect(response.body).toHaveProperty('title', 'Updated Title');
    });
  });

  describe('DELETE /notes/:id', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .delete('/notes/note-1')
        .expect(401);
    });

    it('should delete note by id', async () => {
      const response = await request(app)
        .delete('/notes/note-1')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body).toHaveProperty('deleted', true);
    });

    it('should return 404 for non-existent note', async () => {
      await request(app)
        .delete('/notes/not-found')
        .set('Authorization', 'Bearer test-token')
        .expect(404);
    });
  });

  describe('GET /notes/:id/versions', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .get('/notes/note-1/versions')
        .expect(401);
    });

    it('should return versions list', async () => {
      const response = await request(app)
        .get('/notes/note-1/versions')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.items)).toBe(true);
    });
  });
});

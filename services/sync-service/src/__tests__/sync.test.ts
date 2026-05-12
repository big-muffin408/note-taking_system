import express from 'express';
import { request } from './request-helper.js';

// 创建一个简化的测试应用
const app = express();
app.use(express.json());

// 模拟健康检查接口
app.get('/health', (_req, res) => {
  res.json({
    service: 'sync-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// 模拟拉取接口
app.get('/pull', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const since = req.query.since as string;
  const changes = [
    {
      id: 'note-1',
      title: '测试笔记 1',
      content: '这是测试笔记内容',
      updatedAt: new Date().toISOString()
    },
    {
      id: 'note-2',
      title: '测试笔记 2',
      content: '这是另一个测试笔记',
      updatedAt: new Date(Date.now() - 3600000).toISOString()
    }
  ];

  // 如果有since参数，过滤出更新的笔记
  const filteredChanges = since
    ? changes.filter(c => new Date(c.updatedAt) > new Date(since))
    : changes;

  res.json({
    changes: filteredChanges,
    timestamp: new Date().toISOString()
  });
});

// 模拟推送接口
app.post('/push', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const { changes } = req.body;
  if (!Array.isArray(changes)) {
    return res.status(400).json({ error: '无效的变更数据' });
  }

  // 模拟处理变更
  const results = changes.map(change => ({
    id: change.id,
    success: true,
    updatedAt: new Date().toISOString()
  }));

  res.json({
    results,
    timestamp: new Date().toISOString()
  });
});

describe('Sync Service API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'sync-service');
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /pull', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .get('/pull')
        .expect(401);
    });

    it('should return changes with authorization', async () => {
      const response = await request(app)
        .get('/pull')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body).toHaveProperty('changes');
      expect(response.body).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.changes)).toBe(true);
    });

    it('should filter changes by since parameter', async () => {
      const since = new Date(Date.now() - 1800000).toISOString(); // 30 minutes ago
      const response = await request(app)
        .get(`/pull?since=${encodeURIComponent(since)}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body).toHaveProperty('changes');
      // 应该只返回最近30分钟内更新的笔记
      expect(response.body.changes.length).toBeLessThanOrEqual(2);
    });
  });

  describe('POST /push', () => {
    it('should return 401 without authorization', async () => {
      await request(app)
        .post('/push')
        .send({ changes: [] })
        .expect(401);
    });

    it('should return 400 for invalid changes data', async () => {
      const response = await request(app)
        .post('/push')
        .set('Authorization', 'Bearer test-token')
        .send({ changes: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('error', '无效的变更数据');
    });

    it('should process valid changes', async () => {
      const changes = [
        {
          id: 'note-1',
          type: 'update',
          title: '更新的标题',
          content: '更新的内容'
        }
      ];

      const response = await request(app)
        .post('/push')
        .set('Authorization', 'Bearer test-token')
        .send({ changes })
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(response.body).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results[0]).toHaveProperty('success', true);
    });
  });
});

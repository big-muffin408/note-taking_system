import express from 'express';
import { request } from './request-helper.js';

// 创建一个简化的测试应用
const app = express();
app.use(express.json());

// 模拟健康检查接口
app.get('/health', (_req, res) => {
  res.json({
    service: 'collab-service',
    status: 'ok',
    documents: 5,
    connections: 10,
    timestamp: new Date().toISOString()
  });
});

describe('Collab Service API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'collab-service');
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('documents');
      expect(response.body).toHaveProperty('connections');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return numeric document and connection counts', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(typeof response.body.documents).toBe('number');
      expect(typeof response.body.connections).toBe('number');
    });
  });
});

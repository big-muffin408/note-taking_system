import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from '@notes/shared';

export interface CollabDocLike {
  conns?: Map<unknown, unknown>;
}

// docs 由调用方注入：生产环境传 y-websocket 的内存文档表（见 index.ts），
// 测试可传自构造的 Map 来验证 /health 的统计逻辑
export function createApp(docs: Map<string, CollabDocLike>) {
  const app = express();

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost', 'http://localhost:5173', 'http://localhost:80'];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());

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

  return app;
}

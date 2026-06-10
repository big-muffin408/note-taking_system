import { request } from '@notes/shared/testing';
import { createApp, type CollabDocLike } from '../app.js';

describe('Collab Service API', () => {
  describe('GET /health', () => {
    it('reports an idle service with zero documents and connections', async () => {
      const app = createApp(new Map());
      const response = await request(app).get('/health').expect(200);

      expect(response.body).toMatchObject({
        service: 'collab-service',
        status: 'ok',
        documents: 0,
        connections: 0,
      });
      expect(response.body).toHaveProperty('timestamp');
    });

    it('counts loaded documents and their active connections', async () => {
      const docs = new Map<string, CollabDocLike>([
        ['doc-with-two-clients', { conns: new Map<unknown, unknown>([[{}, {}], [{}, {}]]) }],
        ['doc-without-clients', { conns: new Map() }],
        ['doc-without-conns-map', {}],
      ]);
      const response = await request(createApp(docs)).get('/health').expect(200);

      expect(response.body.documents).toBe(3);
      expect(response.body.connections).toBe(2);
    });
  });

  describe('unknown routes', () => {
    it('falls through to the shared notFoundHandler', async () => {
      const response = await request(createApp(new Map())).get('/nope').expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });
  });
});

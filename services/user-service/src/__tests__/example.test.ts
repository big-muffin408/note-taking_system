import { request } from '@notes/shared/testing';

jest.mock('../db.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
  ensureUserSchema: jest.fn(),
}));

import { app } from '../app.js';

describe('User Service Health Check', () => {
  it('should return health status', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body).toMatchObject({
      service: 'user-service',
      status: 'ok',
    });
    expect(response.body).toHaveProperty('timestamp');
  });

  it('should return JSON content type', async () => {
    const response = await request(app).get('/health').expect('Content-Type', /json/);

    expect(response.status).toBe(200);
  });
});

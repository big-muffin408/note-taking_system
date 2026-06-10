import { request } from '@notes/shared/testing';

jest.mock('../db.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
  ensureUserSchema: jest.fn(),
}));

import pool from '../db.js';
import { app } from '../app.js';
import { signToken } from '../middleware.js';

const mockQuery = pool.query as jest.Mock;
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const token = signToken({ id: 'owner-1', email: 'owner@test.com' });
const auth = `Bearer ${token}`;

function ownershipResponse(owner: boolean) {
  return { ok: true, json: async () => ({ owner }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认空结果，覆盖 auditLog 等附带查询
  mockQuery.mockResolvedValue([[], undefined]);
});

describe('POST /shares', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).post('/shares').send({ documentId: 'd1', email: 'a@b.com' }).expect(401);
  });

  it('rejects missing fields', async () => {
    const res = await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1' })
      .expect(400);
    expect(res.body.error).toContain('邮箱');
  });

  it('returns 404 when the sharee email is unknown', async () => {
    mockQuery.mockResolvedValueOnce([[], undefined]); // SELECT user by email → empty
    await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1', email: 'nobody@test.com' })
      .expect(404);
  });

  it('rejects sharing with yourself', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 'owner-1', display_name: 'Me' }], undefined]);
    const res = await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1', email: 'owner@test.com' })
      .expect(400);
    expect(res.body.error).toContain('自己');
  });

  it('returns 403 when the requester does not own the document', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 'sharee-1', display_name: 'Friend' }], undefined]);
    mockFetch.mockResolvedValueOnce(ownershipResponse(false));
    await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1', email: 'friend@test.com' })
      .expect(403);
  });

  it('returns 502 when document-service is unreachable', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 'sharee-1', display_name: 'Friend' }], undefined]);
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1', email: 'friend@test.com' })
      .expect(502);
  });

  it('creates a read share by default', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 'sharee-1', display_name: 'Friend' }], undefined]);
    mockFetch.mockResolvedValueOnce(ownershipResponse(true));
    const res = await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1', email: 'friend@test.com' })
      .expect(201);
    expect(res.body.permission).toBe('read');
    expect(res.body.shareeId).toBe('sharee-1');
  });

  it('creates a write share when requested', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 'sharee-1', display_name: 'Friend' }], undefined]);
    mockFetch.mockResolvedValueOnce(ownershipResponse(true));
    const res = await request(app)
      .post('/shares')
      .set('Authorization', auth)
      .send({ documentId: 'd1', email: 'friend@test.com', permission: 'write' })
      .expect(201);
    expect(res.body.permission).toBe('write');
  });
});

describe('GET /shares', () => {
  it('requires a documentId', async () => {
    await request(app).get('/shares').set('Authorization', auth).expect(400);
  });

  it('lists shares for a document', async () => {
    mockQuery.mockResolvedValueOnce([
      [
        {
          id: 's1',
          document_id: 'd1',
          sharee_id: 'sharee-1',
          permission: 'read',
          created_at: '2024-01-01',
          email: 'friend@test.com',
          display_name: 'Friend',
        },
      ],
      undefined,
    ]);
    const res = await request(app).get('/shares?documentId=d1').set('Authorization', auth).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: 's1',
      documentId: 'd1',
      shareeEmail: 'friend@test.com',
      permission: 'read',
    });
  });
});

describe('GET /shares/shared-with-me', () => {
  it('lists documents shared with the current user', async () => {
    mockQuery.mockResolvedValueOnce([
      [
        {
          id: 's2',
          document_id: 'd9',
          sharer_id: 'other-1',
          permission: 'write',
          created_at: '2024-02-01',
          sharer_email: 'other@test.com',
          sharer_name: 'Other',
        },
      ],
      undefined,
    ]);
    const res = await request(app).get('/shares/shared-with-me').set('Authorization', auth).expect(200);
    expect(res.body.items[0]).toMatchObject({ documentId: 'd9', sharerEmail: 'other@test.com', permission: 'write' });
  });
});

describe('DELETE /shares/:id', () => {
  it('returns 404 when the share does not exist or is not owned', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
    await request(app).delete('/shares/s1').set('Authorization', auth).expect(404);
  });

  it('revokes an owned share', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    const res = await request(app).delete('/shares/s1').set('Authorization', auth).expect(200);
    expect(res.body.deleted).toBe(true);
  });
});

describe('GET /internal/check-access', () => {
  it('returns none when no share exists', async () => {
    mockQuery.mockResolvedValueOnce([[], undefined]);
    const res = await request(app).get('/internal/check-access?userId=u1&documentId=d1').expect(200);
    expect(res.body.access).toBe('none');
  });

  it('returns the share permission when one exists', async () => {
    mockQuery.mockResolvedValueOnce([[{ permission: 'write' }], undefined]);
    const res = await request(app).get('/internal/check-access?userId=u1&documentId=d1').expect(200);
    expect(res.body.access).toBe('write');
  });

  it('requires userId and documentId', async () => {
    await request(app).get('/internal/check-access?userId=u1').expect(400);
  });
});

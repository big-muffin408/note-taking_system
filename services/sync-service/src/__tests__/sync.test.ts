import { ObjectId } from 'mongodb';
import { request } from '@notes/shared/testing';
import { signToken } from '@notes/shared';

// 只替换 MongoClient，ObjectId 等保持真实实现
const mockCollection = {
  find: jest.fn(),
};

jest.mock('mongodb', () => {
  const actual = jest.requireActual('mongodb');
  return {
    ...actual,
    MongoClient: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      db: () => ({ collection: () => mockCollection }),
      close: jest.fn(),
    })),
  };
});

import { app } from '../app.js';

const SECRET = process.env.JWT_SECRET!;
const auth = `Bearer ${signToken({ id: 'owner-1', email: 'o@t.com' }, SECRET)}`;
const OWN_NOTE_ID = '507f1f77bcf86cd799439011';
const SHARED_NOTE_ID = '507f1f77bcf86cd799439012';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function findResult(notes: unknown[]) {
  return {
    sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(notes) }),
  };
}

function note(id: string, title: string, updatedAt: string, ownerId = 'owner-1') {
  return {
    _id: new ObjectId(id),
    title,
    content: '<p></p>',
    ownerId,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date(updatedAt),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认：user-service 不可达，/pull 应退化为仅自有笔记
  mockFetch.mockResolvedValue({ ok: false });
  mockCollection.find.mockReturnValue(findResult([]));
});

describe('GET /health', () => {
  it('returns the real service identity', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toMatchObject({ service: 'sync-service', status: 'ok' });
    expect(response.body).toHaveProperty('timestamp');
  });
});

describe('GET /pull', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get('/pull').expect(401);
  });

  it('returns own notes and a cursor', async () => {
    mockCollection.find.mockReturnValueOnce(
      findResult([note(OWN_NOTE_ID, '测试笔记', '2026-05-02T00:00:00.000Z')])
    );
    const response = await request(app).get('/pull').set('Authorization', auth).expect(200);

    expect(typeof response.body.cursor).toBe('string');
    expect(response.body.notes).toHaveLength(1);
    expect(response.body.notes[0]).toMatchObject({ id: OWN_NOTE_ID, title: '测试笔记', ownerId: 'owner-1' });
  });

  it('filters own notes by the since parameter', async () => {
    const since = '2026-05-01T12:00:00.000Z';
    await request(app)
      .get(`/pull?since=${encodeURIComponent(since)}`)
      .set('Authorization', auth)
      .expect(200);

    expect(mockCollection.find).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      updatedAt: { $gt: new Date(since) },
    });
  });

  it('merges shared notes sorted by recency', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ documentId: SHARED_NOTE_ID }] }),
    });
    mockCollection.find
      .mockReturnValueOnce(findResult([note(OWN_NOTE_ID, '自己的笔记', '2026-05-01T00:00:00.000Z')]))
      .mockReturnValueOnce(findResult([note(SHARED_NOTE_ID, '共享的笔记', '2026-05-03T00:00:00.000Z', 'other-1')]));

    const response = await request(app).get('/pull').set('Authorization', auth).expect(200);

    expect(mockCollection.find).toHaveBeenNthCalledWith(2, {
      _id: { $in: [new ObjectId(SHARED_NOTE_ID)] },
    });
    expect(response.body.notes.map((n: { id: string }) => n.id)).toEqual([SHARED_NOTE_ID, OWN_NOTE_ID]);
  });
});

describe('POST /push', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).post('/push').send({ changes: [] }).expect(401);
  });

  it('accepts a non-array changes payload as an empty batch', async () => {
    const response = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({ changes: 'invalid' })
      .expect(200);

    expect(response.body).toEqual({ accepted: true, results: [] });
  });
});

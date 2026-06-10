import { ObjectId } from 'mongodb';
import { request } from '@notes/shared/testing';
import { signToken } from '@notes/shared';

const collections = new Map<string, any>();

jest.mock('../db.js', () => ({
  getDb: jest.fn(async () => ({
    collection: (name: string) => collections.get(name),
  })),
}));

import { app } from '../app.js';

const SECRET = process.env.JWT_SECRET!;
const auth = `Bearer ${signToken({ id: 'owner-1', email: 'owner@test.com' }, SECRET)}`;
const NOTE_ID = '507f1f77bcf86cd799439011';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function chainedFind(result: any[]) {
  const chain: any = {
    sort: jest.fn(() => chain),
    project: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    toArray: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function createCollection() {
  return {
    find: jest.fn(() => chainedFind([])),
    findOne: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn(async () => ({ insertedId: new ObjectId(NOTE_ID) })),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

function ownNote(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(NOTE_ID),
    title: '测试笔记',
    content: '<p>内容</p>',
    ownerId: 'owner-1',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    ...overrides,
  };
}

let documents: ReturnType<typeof createCollection>;
let versions: ReturnType<typeof createCollection>;

beforeEach(() => {
  jest.clearAllMocks();
  // 默认：user-service 不可达（无共享、无收藏），路由应退化为仅自有笔记
  mockFetch.mockResolvedValue({ ok: false });
  documents = createCollection();
  versions = createCollection();
  collections.clear();
  collections.set('documents', documents);
  collections.set('versions', versions);
  collections.set('audit_logs', createCollection());
});

describe('GET /health', () => {
  it('returns the real service identity', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ service: 'document-service', status: 'ok' });
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /notes', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get('/notes').expect(401);
  });

  it('lists own notes when share lookups fail', async () => {
    documents.find.mockReturnValueOnce(chainedFind([ownNote()]));
    const res = await request(app).get('/notes').set('Authorization', auth).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: NOTE_ID, title: '测试笔记', ownerId: 'owner-1', starred: false });
  });

  it('marks favorited notes as starred', async () => {
    documents.find.mockReturnValueOnce(chainedFind([ownNote()]));
    mockFetch
      .mockResolvedValueOnce({ ok: false }) // shares/shared-with-me
      .mockResolvedValueOnce({ ok: true, json: async () => ({ documentIds: [NOTE_ID] }) }); // internal/favorites
    const res = await request(app).get('/notes').set('Authorization', auth).expect(200);
    expect(res.body.items[0].starred).toBe(true);
  });
});

describe('POST /notes', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).post('/notes').send({ title: 'x' }).expect(401);
  });

  it('creates a note with the provided fields', async () => {
    const res = await request(app)
      .post('/notes')
      .set('Authorization', auth)
      .send({ title: 'New Note', content: '<p>New content</p>' })
      .expect(201);
    expect(res.body).toMatchObject({ id: NOTE_ID, title: 'New Note', content: '<p>New content</p>', ownerId: 'owner-1' });
    expect(documents.insertOne).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Note', ownerId: 'owner-1' }));
  });

  it('falls back to default title and content when omitted', async () => {
    const res = await request(app).post('/notes').set('Authorization', auth).send({}).expect(201);
    expect(res.body).toMatchObject({ title: '未命名笔记', content: '<p></p>' });
  });
});

describe('GET /notes/:id', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get(`/notes/${NOTE_ID}`).expect(401);
  });

  it('rejects malformed note ids', async () => {
    const res = await request(app).get('/notes/not-an-id').set('Authorization', auth).expect(400);
    expect(res.body.error).toContain('无效');
  });

  it('returns 404 when the note does not exist', async () => {
    await request(app).get(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(404);
  });

  it('returns an owned note', async () => {
    documents.findOne.mockResolvedValueOnce(ownNote());
    const res = await request(app).get(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(200);
    expect(res.body).toMatchObject({ id: NOTE_ID, title: '测试笔记', ownerId: 'owner-1' });
  });

  it("rejects someone else's note without a share", async () => {
    documents.findOne.mockResolvedValueOnce(ownNote({ ownerId: 'other-1' }));
    await request(app).get(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(403);
  });

  it("allows reading someone else's note with a read share", async () => {
    documents.findOne.mockResolvedValueOnce(ownNote({ ownerId: 'other-1' }));
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access: 'read' }) }) // internal/check-access
      .mockResolvedValueOnce({ ok: false }); // internal/favorites
    const res = await request(app).get(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(200);
    expect(res.body.ownerId).toBe('other-1');
  });
});

describe('PUT /notes/:id', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).put(`/notes/${NOTE_ID}`).send({ title: 'x' }).expect(401);
  });

  it('returns 404 when the note does not exist', async () => {
    await request(app).put(`/notes/${NOTE_ID}`).set('Authorization', auth).send({ title: 'x' }).expect(404);
  });

  it('rejects edits without write access', async () => {
    documents.findOne.mockResolvedValueOnce(ownNote({ ownerId: 'other-1' }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access: 'read' }) });
    await request(app).put(`/notes/${NOTE_ID}`).set('Authorization', auth).send({ title: 'x' }).expect(403);
  });

  it('updates an owned note', async () => {
    documents.findOne.mockResolvedValueOnce(ownNote());
    const res = await request(app)
      .put(`/notes/${NOTE_ID}`)
      .set('Authorization', auth)
      .send({ title: '新标题' })
      .expect(200);
    expect(res.body).toMatchObject({ id: NOTE_ID, title: '新标题', content: '<p>内容</p>' });
    expect(documents.updateOne).toHaveBeenCalled();
  });

  it('returns 409 with the server copy when baseUpdatedAt is stale', async () => {
    const existing = ownNote();
    documents.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(ownNote({ title: '服务器版本' }));
    documents.findOneAndUpdate.mockResolvedValueOnce(null);
    const res = await request(app)
      .put(`/notes/${NOTE_ID}`)
      .set('Authorization', auth)
      .send({ title: '本地版本', baseUpdatedAt: '2026-05-01T12:00:00.000Z' })
      .expect(409);
    expect(res.body.serverNote).toMatchObject({ id: NOTE_ID, title: '服务器版本' });
  });
});

describe('DELETE /notes/:id', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).delete(`/notes/${NOTE_ID}`).expect(401);
  });

  it('returns 404 when the note does not exist', async () => {
    await request(app).delete(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(404);
  });

  it('rejects deleting notes owned by others', async () => {
    documents.findOne.mockResolvedValueOnce(ownNote({ ownerId: 'other-1' }));
    await request(app).delete(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(403);
    expect(documents.deleteOne).not.toHaveBeenCalled();
  });

  it('deletes an owned note and reports success', async () => {
    documents.findOne.mockResolvedValueOnce(ownNote());
    const res = await request(app).delete(`/notes/${NOTE_ID}`).set('Authorization', auth).expect(200);
    expect(res.body).toMatchObject({ deleted: true, id: NOTE_ID });
    expect(documents.deleteOne).toHaveBeenCalled();
  });
});

describe('GET /notes/:id/versions', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).get(`/notes/${NOTE_ID}/versions`).expect(401);
  });

  it('lists versions of an owned note', async () => {
    documents.findOne.mockResolvedValueOnce(ownNote());
    versions.find.mockReturnValueOnce(chainedFind([
      {
        _id: new ObjectId('507f1f77bcf86cd799439021'),
        documentId: NOTE_ID,
        title: '测试笔记',
        modifierId: 'owner-1',
        label: '手动快照',
        createdAt: new Date('2026-05-02T00:00:00.000Z'),
      },
    ]));
    versions.countDocuments.mockResolvedValueOnce(1);
    const res = await request(app).get(`/notes/${NOTE_ID}/versions`).set('Authorization', auth).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ documentId: NOTE_ID, label: '手动快照' });
  });
});

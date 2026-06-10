import { ObjectId } from 'mongodb';
import { request } from '@notes/shared/testing';
import { signToken } from '@notes/shared';
import { hasConflict, serializeNote } from '../sync-core.js';

// 只替换 MongoClient，ObjectId 等保持真实实现
const mockCollection = {
  insertOne: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
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
const NOTE_ID = '507f1f77bcf86cd799439011';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hasConflict', () => {
  const server = new Date('2024-03-01T10:00:00.000Z');

  it('reports no conflict when base matches the server timestamp', () => {
    expect(hasConflict(server, '2024-03-01T10:00:00.000Z')).toBe(false);
  });

  it('reports a conflict when timestamps differ', () => {
    expect(hasConflict(server, '2024-03-01T09:59:59.000Z')).toBe(true);
  });

  it('treats a malformed baseUpdatedAt as a conflict', () => {
    expect(hasConflict(server, 'not-a-date')).toBe(true);
  });

  it('reports no conflict when the client sends no baseUpdatedAt', () => {
    expect(hasConflict(server, undefined)).toBe(false);
  });

  it('conservatively reports a conflict when the server timestamp is not a Date', () => {
    expect(hasConflict('2024-03-01T10:00:00.000Z', '2024-03-01T10:00:00.000Z')).toBe(true);
  });
});

describe('serializeNote', () => {
  it('flattens the Mongo document into the API shape', () => {
    const _id = new ObjectId(NOTE_ID);
    const now = new Date();
    expect(serializeNote({ _id, title: 't', content: 'c', ownerId: 'o', createdAt: now, updatedAt: now })).toEqual({
      id: NOTE_ID,
      title: 't',
      content: 'c',
      ownerId: 'o',
      sourcePdfId: undefined,
      createdAt: now,
      updatedAt: now,
    });
  });
});

describe('POST /push', () => {
  it('rejects unauthenticated requests', async () => {
    await request(app).post('/push').send({ changes: [] }).expect(401);
  });

  it('creates new notes', async () => {
    const insertedId = new ObjectId(NOTE_ID);
    mockCollection.insertOne.mockResolvedValueOnce({ insertedId });
    mockCollection.findOne.mockResolvedValueOnce({
      _id: insertedId,
      title: '新笔记',
      content: '<p>hi</p>',
      ownerId: 'owner-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({ changes: [{ id: 'q1', noteId: 'local-1', type: 'create', title: '新笔记', content: '<p>hi</p>' }] })
      .expect(200);

    expect(res.body.results[0]).toMatchObject({ queueId: 'q1', status: 'created', remoteId: NOTE_ID });
  });

  it('rejects updates with an invalid note id', async () => {
    const res = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({ changes: [{ id: 'q1', noteId: 'not-valid', type: 'update', title: 'x' }] })
      .expect(200);

    expect(res.body.results[0]).toMatchObject({ status: 'error', message: '无效的笔记 ID' });
  });

  it('flags a conflict and returns the server copy', async () => {
    const serverUpdatedAt = new Date('2024-03-02T08:00:00.000Z');
    mockCollection.findOne.mockResolvedValueOnce({
      _id: new ObjectId(NOTE_ID),
      title: '服务器版本',
      content: '<p>server</p>',
      ownerId: 'owner-1',
      createdAt: new Date('2024-03-01'),
      updatedAt: serverUpdatedAt,
    });

    const res = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({
        changes: [{
          id: 'q1',
          noteId: NOTE_ID,
          type: 'update',
          title: '本地版本',
          baseUpdatedAt: '2024-03-01T00:00:00.000Z',
        }],
      })
      .expect(200);

    expect(res.body.results[0].status).toBe('conflict');
    expect(res.body.results[0].serverNote).toMatchObject({ id: NOTE_ID, title: '服务器版本' });
    expect(mockCollection.updateOne).not.toHaveBeenCalled();
  });

  it('applies updates when baseUpdatedAt matches', async () => {
    const serverUpdatedAt = new Date('2024-03-02T08:00:00.000Z');
    const existing = {
      _id: new ObjectId(NOTE_ID),
      title: '旧标题',
      content: '<p>old</p>',
      ownerId: 'owner-1',
      createdAt: new Date('2024-03-01'),
      updatedAt: serverUpdatedAt,
    };
    mockCollection.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, title: '新标题', updatedAt: new Date() });
    mockCollection.updateOne.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({
        changes: [{
          id: 'q1',
          noteId: NOTE_ID,
          type: 'update',
          title: '新标题',
          baseUpdatedAt: '2024-03-02T08:00:00.000Z',
        }],
      })
      .expect(200);

    expect(res.body.results[0].status).toBe('updated');
    expect(mockCollection.updateOne).toHaveBeenCalled();
  });

  it('deletes existing notes', async () => {
    mockCollection.findOne.mockResolvedValueOnce({
      _id: new ObjectId(NOTE_ID),
      ownerId: 'owner-1',
      updatedAt: new Date(),
    });
    mockCollection.deleteOne.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({ changes: [{ id: 'q1', noteId: NOTE_ID, type: 'delete' }] })
      .expect(200);

    expect(res.body.results[0].status).toBe('deleted');
    expect(mockCollection.deleteOne).toHaveBeenCalled();
  });

  it('treats deleting a missing note as already deleted', async () => {
    mockCollection.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/push')
      .set('Authorization', auth)
      .send({ changes: [{ id: 'q1', noteId: NOTE_ID, type: 'delete' }] })
      .expect(200);

    expect(res.body.results[0].status).toBe('deleted');
    expect(mockCollection.deleteOne).not.toHaveBeenCalled();
  });
});

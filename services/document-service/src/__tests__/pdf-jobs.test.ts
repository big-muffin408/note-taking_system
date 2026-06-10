import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.DISABLE_PDF_JOB_WORKER = 'true';

const collections = new Map<string, any>();

const minioPutObject = jest.fn().mockResolvedValue(undefined);
const minioBucketExists = jest.fn().mockResolvedValue(true);
const minioMakeBucket = jest.fn().mockResolvedValue(undefined);
const minioGetObject = jest.fn();

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bucketExists: minioBucketExists,
    makeBucket: minioMakeBucket,
    putObject: minioPutObject,
    getObject: minioGetObject,
  })),
}));

jest.mock('../db.js', () => ({
  getDb: jest.fn(async () => ({
    collection: (name: string) => collections.get(name),
  })),
}));

function createCollection(initial: any[] = []) {
  const docs = [...initial];
  return {
    docs,
    insertOne: jest.fn(async (doc: any) => {
      docs.push(doc);
      return { insertedId: doc._id ?? new ObjectId() };
    }),
    updateOne: jest.fn(async (filter: any, update: any) => {
      const doc = docs.find((item) => matchesFilter(item, filter));
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$unset) {
          for (const key of Object.keys(update.$unset)) delete doc[key];
        }
        if (update.$inc) {
          for (const [key, value] of Object.entries(update.$inc)) {
            doc[key] = (doc[key] ?? 0) + Number(value);
          }
        }
      }
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
    findOne: jest.fn(async (filter: any) => docs.find((item) => matchesFilter(item, filter)) ?? null),
  };
}

function matchesFilter(doc: any, filter: any) {
  return Object.entries(filter).every(([key, value]) => {
    const current = doc[key];
    if (current instanceof ObjectId && value instanceof ObjectId) {
      return current.equals(value);
    }
    return current === value;
  });
}

function tokenFor(userId: string) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET!);
}

describe('PDF parse jobs', () => {
  let app: Awaited<typeof import('../app.js')>['app'];

  beforeAll(async () => {
    ({ app } = await import('../app.js'));
  });

  beforeEach(() => {
    collections.clear();
    collections.set('pdf_assets', createCollection());
    collections.set('pdf_parse_jobs', createCollection());
    collections.set('audit_logs', createCollection());
    minioPutObject.mockClear();
    minioBucketExists.mockClear();
    minioMakeBucket.mockClear();
    minioGetObject.mockClear();
  });

  it('rejects files that are not real PDFs', async () => {
    const response = await request(app)
      .post('/pdf/jobs')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .attach('file', Buffer.from('not a pdf'), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    expect(response.body.error).toBe('文件内容不是有效的 PDF 格式');
    expect(minioPutObject).not.toHaveBeenCalled();
  });

  it('creates a queued PDF job and asset record', async () => {
    const response = await request(app)
      .post('/pdf/jobs')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .attach('file', Buffer.from('%PDF-1.4\nsample'), {
        filename: 'sample.pdf',
        contentType: 'application/pdf',
      })
      .expect(202);

    expect(response.body).toMatchObject({
      pdfId: expect.any(String),
      jobId: expect.any(String),
      status: 'queued',
    });

    const jobs = collections.get('pdf_parse_jobs').docs;
    const assets = collections.get('pdf_assets').docs;
    expect(jobs).toHaveLength(1);
    expect(assets).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      ownerId: 'user-1',
      fileName: 'sample.pdf',
      status: 'queued',
      attempts: 0,
    });
    expect(assets[0]).toMatchObject({
      ownerId: 'user-1',
      fileName: 'sample.pdf',
      status: 'queued',
    });
    expect(minioPutObject).toHaveBeenCalledTimes(1);
  });

  it('only returns jobs owned by the authenticated user', async () => {
    const jobId = new ObjectId();
    collections.set('pdf_parse_jobs', createCollection([{
      _id: jobId,
      pdfId: new ObjectId().toHexString(),
      noteId: new ObjectId().toHexString(),
      ownerId: 'user-2',
      fileName: 'private.pdf',
      bytes: 12,
      status: 'failed',
      error: 'boom',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:01.000Z'),
    }]));

    await request(app)
      .get(`/pdf/jobs/${jobId.toHexString()}`)
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .expect(404);

    const response = await request(app)
      .get(`/pdf/jobs/${jobId.toHexString()}`)
      .set('Authorization', `Bearer ${tokenFor('user-2')}`)
      .expect(200);

    expect(response.body).toMatchObject({
      jobId: jobId.toHexString(),
      fileName: 'private.pdf',
      status: 'failed',
      error: 'boom',
    });
  });

  it('allows retry only for failed jobs', async () => {
    const failedJobId = new ObjectId();
    const queuedJobId = new ObjectId();
    const failedPdfId = new ObjectId();
    const queuedPdfId = new ObjectId();

    collections.set('pdf_parse_jobs', createCollection([
      {
        _id: failedJobId,
        pdfId: failedPdfId.toHexString(),
        noteId: new ObjectId().toHexString(),
        ownerId: 'user-1',
        fileName: 'failed.pdf',
        objectName: 'user-1/failed.pdf',
        bytes: 10,
        status: 'failed',
        error: 'AI PDF parse failed',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-12T00:00:01.000Z'),
      },
      {
        _id: queuedJobId,
        pdfId: queuedPdfId.toHexString(),
        noteId: new ObjectId().toHexString(),
        ownerId: 'user-1',
        fileName: 'queued.pdf',
        objectName: 'user-1/queued.pdf',
        bytes: 10,
        status: 'queued',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-12T00:00:01.000Z'),
      },
    ]));
    collections.set('pdf_assets', createCollection([
      { _id: failedPdfId, status: 'failed', error: 'AI PDF parse failed' },
      { _id: queuedPdfId, status: 'queued' },
    ]));

    const retried = await request(app)
      .post(`/pdf/jobs/${failedJobId.toHexString()}/retry`)
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({})
      .expect(202);

    expect(retried.body).toMatchObject({
      jobId: failedJobId.toHexString(),
      status: 'queued',
    });
    expect(retried.body.error).toBeNull();

    await request(app)
      .post(`/pdf/jobs/${queuedJobId.toHexString()}/retry`)
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({})
      .expect(409);
  });
});

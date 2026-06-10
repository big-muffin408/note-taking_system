import type { IncomingMessage } from 'node:http';
import { getTokenFromRequest, signToken, verifyToken } from '@notes/shared';
import { checkDocumentAccess, getDocumentId, type DocumentAccessDeps } from '../connection-auth.js';

const SECRET = process.env.JWT_SECRET!;
const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';

function fakeRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as unknown as IncomingMessage;
}

describe('getDocumentId', () => {
  it('extracts the document id from a collab path', () => {
    expect(getDocumentId(fakeRequest('/ws/collab/abc123'))).toBe('abc123');
  });

  it('decodes URL-encoded ids', () => {
    expect(getDocumentId(fakeRequest('/ws/collab/a%20b'))).toBe('a b');
  });

  it('ignores query parameters', () => {
    expect(getDocumentId(fakeRequest('/ws/collab/abc?token=t'))).toBe('abc');
  });

  it('returns null for non-collab paths', () => {
    expect(getDocumentId(fakeRequest('/ws/other/abc'))).toBeNull();
    expect(getDocumentId(fakeRequest('/ws/collab/a/b'))).toBeNull();
    expect(getDocumentId(fakeRequest('/'))).toBeNull();
  });
});

describe('getTokenFromRequest', () => {
  it('reads the token from the query string', () => {
    expect(getTokenFromRequest(fakeRequest('/ws/collab/abc?token=tok123'))).toBe('tok123');
  });

  it('falls back to the Bearer header', () => {
    expect(getTokenFromRequest(fakeRequest('/ws/collab/abc', { authorization: 'Bearer tok456' }))).toBe('tok456');
  });

  it('prefers the query token over the header', () => {
    expect(getTokenFromRequest(fakeRequest('/ws/collab/abc?token=q', { authorization: 'Bearer h' }))).toBe('q');
  });

  it('returns null when no token is provided', () => {
    expect(getTokenFromRequest(fakeRequest('/ws/collab/abc'))).toBeNull();
  });
});

describe('verifyToken', () => {
  it('returns the payload for a valid token', () => {
    const token = signToken({ id: 'u1', email: 'a@b.com' }, SECRET);
    expect(verifyToken(token, SECRET)).toMatchObject({ id: 'u1', email: 'a@b.com' });
  });

  it('returns null for garbage tokens', () => {
    expect(verifyToken('not-a-jwt', SECRET)).toBeNull();
  });

  it('returns null for expired tokens', () => {
    const token = signToken({ id: 'u1', email: 'a@b.com' }, SECRET, '-1s');
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('returns null for tokens signed with another secret', () => {
    const token = signToken({ id: 'u1', email: 'a@b.com' }, 'other-secret');
    expect(verifyToken(token, SECRET)).toBeNull();
  });
});

describe('checkDocumentAccess', () => {
  const findOne = jest.fn();
  const fetchImpl = jest.fn();

  const deps: DocumentAccessDeps = {
    getDb: async () => ({ collection: () => ({ findOne }) }) as any,
    userServiceUrl: 'http://user-service',
    internalSecret: 'internal-secret',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid ObjectId strings without querying shares', async () => {
    expect(await checkDocumentAccess('u1', 'not-an-object-id', deps)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects when the document does not exist', async () => {
    findOne.mockResolvedValueOnce(null);
    expect(await checkDocumentAccess('u1', VALID_OBJECT_ID, deps)).toBe(false);
  });

  it('grants access to the owner without consulting user-service', async () => {
    findOne.mockResolvedValueOnce({ ownerId: 'u1' });
    expect(await checkDocumentAccess('u1', VALID_OBJECT_ID, deps)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['read', 'write'])('grants access when a %s share exists', async (permission) => {
    findOne.mockResolvedValueOnce({ ownerId: 'someone-else' });
    fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ access: permission }) });
    expect(await checkDocumentAccess('u1', VALID_OBJECT_ID, deps)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/internal/check-access?userId=u1'),
      expect.objectContaining({ headers: { 'X-Internal-Secret': 'internal-secret' } }),
    );
  });

  it('denies access when no share exists', async () => {
    findOne.mockResolvedValueOnce({ ownerId: 'someone-else' });
    fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ access: 'none' }) });
    expect(await checkDocumentAccess('u1', VALID_OBJECT_ID, deps)).toBe(false);
  });

  it('denies access when user-service responds with an error', async () => {
    findOne.mockResolvedValueOnce({ ownerId: 'someone-else' });
    fetchImpl.mockResolvedValueOnce({ ok: false });
    expect(await checkDocumentAccess('u1', VALID_OBJECT_ID, deps)).toBe(false);
  });

  it('denies access when user-service is unreachable', async () => {
    findOne.mockResolvedValueOnce({ ownerId: 'someone-else' });
    fetchImpl.mockRejectedValueOnce(new Error('network down'));
    expect(await checkDocumentAccess('u1', VALID_OBJECT_ID, deps)).toBe(false);
  });
});

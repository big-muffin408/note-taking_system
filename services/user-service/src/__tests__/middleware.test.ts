import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { authMiddleware, adminMiddleware, signToken, type AuthRequest } from '../middleware.js';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  errorHandler,
  notFoundHandler,
} from '@notes/shared';

const TEST_SECRET = process.env.JWT_SECRET!;

function createRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

describe('authMiddleware', () => {
  it('accepts a valid token and sets userId/userEmail', () => {
    const token = signToken({ id: 'user-1', email: 'a@b.com' });
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-1');
    expect(req.userEmail).toBe('a@b.com');
  });

  it('rejects requests without an Authorization header', () => {
    const req = { headers: {} } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer Authorization header', () => {
    const req = { headers: { authorization: 'Basic abc' } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token', () => {
    const token = jwt.sign({ id: 'user-1', email: 'a@b.com' }, TEST_SECRET, { expiresIn: '-1s' });
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign({ id: 'user-1', email: 'a@b.com' }, 'wrong-secret');
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('adminMiddleware', () => {
  it('rejects when authMiddleware has not set userId', () => {
    const req = { headers: {} } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through when userId is present', () => {
    const req = { headers: {}, userId: 'user-1' } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('signToken', () => {
  it('produces a token verifiable with the configured secret', () => {
    const token = signToken({ id: 'user-9', email: 'x@y.com' });
    const decoded = jwt.verify(token, TEST_SECRET) as { id: string; email: string };
    expect(decoded.id).toBe('user-9');
    expect(decoded.email).toBe('x@y.com');
  });
});

describe('errorHandler', () => {
  const cases: Array<[AppError, number, string]> = [
    [new ValidationError('坏请求'), 400, 'VALIDATION_ERROR'],
    [new AuthenticationError(), 401, 'AUTHENTICATION_ERROR'],
    [new AuthorizationError(), 403, 'AUTHORIZATION_ERROR'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError('冲突'), 409, 'CONFLICT'],
    [new RateLimitError(), 429, 'RATE_LIMIT'],
  ];

  it.each(cases)('maps %p to its status code and error code', (err, status, code) => {
    const res = createRes();
    errorHandler(err, {} as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it('maps unknown errors to 500 INTERNAL_ERROR', () => {
    const res = createRes();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(new Error('boom'), {} as any, res, jest.fn());
    consoleSpy.mockRestore();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with the missing route in the message', () => {
    const res = createRes();
    notFoundHandler({ method: 'GET', path: '/nope' } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

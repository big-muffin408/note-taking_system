import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { request } from '@notes/shared/testing';

jest.mock('../db.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
  ensureUserSchema: jest.fn(),
}));

import pool from '../db.js';
import { app } from '../app.js';

const mockQuery = pool.query as jest.Mock;

// 与 app.ts 的 hashVerificationCode 保持一致（依赖 jest.setup.cjs 预设的 JWT_SECRET）
function verificationCodeHash(email: string, code: string) {
  return createHash('sha256').update(`${email}:${code}:${process.env.JWT_SECRET}`).digest('hex');
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    display_name: 'Test User',
    password_hash: bcrypt.hashSync('password123', 4),
    role: 'user',
    failed_login_attempts: 0,
    locked_until: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认空结果，覆盖 auditLog、失败计数更新等附带查询
  mockQuery.mockResolvedValue([[], undefined]);
});

describe('POST /login', () => {
  it('rejects requests missing email or password', async () => {
    const res = await request(app).post('/login').send({ email: 'test@example.com' }).expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects unknown emails', async () => {
    mockQuery.mockResolvedValueOnce([[], undefined]); // SELECT user by email → empty
    const res = await request(app)
      .post('/login')
      .send({ email: 'wrong@example.com', password: 'wrongpassword' })
      .expect(401);
    expect(res.body.error).toBe('邮箱或密码错误');
  });

  it('rejects wrong passwords and records the failed attempt', async () => {
    mockQuery.mockResolvedValueOnce([[userRow()], undefined]);
    const res = await request(app)
      .post('/login')
      .send({ email: 'test@example.com', password: 'not-the-password' })
      .expect(401);
    expect(res.body.error).toBe('邮箱或密码错误');
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
      [1, 'user-1']
    );
  });

  it('rejects logins while the account is locked', async () => {
    mockQuery.mockResolvedValueOnce([
      [userRow({ locked_until: new Date(Date.now() + 10 * 60 * 1000) })],
      undefined,
    ]);
    const res = await request(app)
      .post('/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(403);
    expect(res.body.error).toContain('锁定');
  });

  it('returns a token and the user for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce([[userRow()], undefined]);
    const res = await request(app)
      .post('/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'user',
    });
  });
});

describe('POST /register', () => {
  const payload = {
    email: 'new@example.com',
    password: 'password123',
    displayName: 'New User',
    verificationCode: '123456',
  };

  it('rejects requests missing required fields', async () => {
    const res = await request(app).post('/register').send({ email: 'new@example.com' }).expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/register')
      .send({ ...payload, password: '123' })
      .expect(400);
    expect(res.body.error).toBe('密码长度不能少于 8 位');
  });

  it('rejects already registered emails', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 'user-1' }], undefined]); // SELECT existing user
    const res = await request(app).post('/register').send(payload).expect(409);
    expect(res.body.error).toBe('该邮箱已被注册');
  });

  it('rejects expired or missing verification codes', async () => {
    mockQuery
      .mockResolvedValueOnce([[], undefined]) // SELECT existing user → none
      .mockResolvedValueOnce([[], undefined]); // SELECT verification code → none
    const res = await request(app).post('/register').send(payload).expect(400);
    expect(res.body.error).toContain('验证码已过期');
  });

  it('rejects wrong verification codes', async () => {
    mockQuery
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([
        [{ id: 'code-1', code_hash: verificationCodeHash(payload.email, '654321'), attempts: 0 }],
        undefined,
      ]);
    const res = await request(app).post('/register').send(payload).expect(400);
    expect(res.body.error).toBe('验证码错误');
  });

  it('creates the user and returns a token on success', async () => {
    mockQuery
      .mockResolvedValueOnce([[], undefined]) // SELECT existing user → none
      .mockResolvedValueOnce([
        [{ id: 'code-1', code_hash: verificationCodeHash(payload.email, payload.verificationCode), attempts: 0 }],
        undefined,
      ]); // SELECT verification code → valid
    const res = await request(app).post('/register').send(payload).expect(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({
      email: 'new@example.com',
      displayName: 'New User',
      role: 'user',
    });
    expect(mockQuery).toHaveBeenCalledWith(
      'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)',
      expect.arrayContaining(['new@example.com', 'New User'])
    );
  });
});

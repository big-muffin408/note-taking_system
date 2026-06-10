import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export interface TokenPayload {
  id: string;
  email?: string;
}

// 读取 JWT_SECRET，缺失时立即退出（与各服务原有启动行为一致）
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is not set');
    process.exit(1);
  }
  return secret;
}

export function createAuthMiddleware(options: { secret: string }) {
  const { secret } = options;

  return function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未提供认证令牌' });
    }

    const token = authHeader.slice(7);

    try {
      const decoded = jwt.verify(token, secret) as TokenPayload;
      req.userId = decoded.id;
      if (decoded.email) {
        req.userEmail = decoded.email;
      }
      next();
    } catch {
      return res.status(401).json({ error: '无效或已过期的认证令牌' });
    }
  };
}

export function signToken(
  payload: { id: string; email: string },
  secret: string,
  expiresIn: jwt.SignOptions['expiresIn'] = '7d',
): string {
  return jwt.sign(payload, secret, { expiresIn });
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Must be called after authMiddleware
  if (!req.userId) {
    return res.status(401).json({ error: '未认证' });
  }
  // Role check is done in the route handler since we need to query the DB
  next();
}

export function verifyToken(token: string, secret: string): { id: string; email: string } | null {
  try {
    return jwt.verify(token, secret) as { id: string; email: string };
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('token');
  if (token) return token;
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

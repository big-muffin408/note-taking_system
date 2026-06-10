import { createAuthMiddleware, requireJwtSecret, signToken as sharedSignToken } from '@notes/shared';

export { adminMiddleware, type AuthRequest } from '@notes/shared';

const JWT_SECRET = requireJwtSecret();

export const authMiddleware = createAuthMiddleware({ secret: JWT_SECRET });

export function signToken(payload: { id: string; email: string }): string {
  return sharedSignToken(payload, JWT_SECRET);
}

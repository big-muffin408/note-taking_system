import { createAuthMiddleware, requireJwtSecret } from '@notes/shared';

export { type AuthRequest } from '@notes/shared';

export const authMiddleware = createAuthMiddleware({ secret: requireJwtSecret() });

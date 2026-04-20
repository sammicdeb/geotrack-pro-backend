import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { ok, created, badRequest, unauthorized, conflict, serverError } from '../utils/response';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';

const router = Router();

// POST /auth/register-org
router.post(
  '/register-org',
  [
    body('orgName').trim().notEmpty().withMessage('Organization name is required'),
    body('orgSlug').trim().matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, numbers, hyphens'),
    body('email').isEmail().normalizeEmail(),
    body('name').trim().notEmpty().withMessage('Your name is required'),
    body('username').trim().isLength({ min: 3 }),
    body('password').isLength({ min: 8 }),
    validate,
  ],
  async (req: Request, res: Response) => {
    const { orgName, orgSlug, email, name, username, password } = req.body;
    try {
      const existing = await db.select().from(schema.organizations)
        .where(eq(schema.organizations.slug, orgSlug)).limit(1);
      if (existing.length) return conflict(res, 'Organization slug already taken');

      const passwordHash = await bcrypt.hash(password, 12);

      const [org] = await db.insert(schema.organizations).values({
        name: orgName, slug: orgSlug, email,
      }).returning();

      const [admin] = await db.insert(schema.users).values({
        organizationId: org.id, name, email, username, passwordHash, role: 'admin', status: 'active',
      }).returning();

      const payload = { userId: admin.id, orgId: org.id, role: admin.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      await db.insert(schema.refreshTokens).values({
        token: refreshToken, userId: admin.id, organizationId: org.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      return created(res, {
        organization: { id: org.id, name: org.name, slug: org.slug },
        user: { id: admin.id, name: admin.name, username: admin.username, role: admin.role },
        accessToken, refreshToken,
      });
    } catch (e) {
      logger.error('register-org error', e);
      return serverError(res);
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  [
    body('username').trim().notEmpty(),
    body('password').notEmpty(),
    body('orgSlug').trim().notEmpty().withMessage('Organization slug is required'),
    validate,
  ],
  async (req: Request, res: Response) => {
    const { username, password, orgSlug } = req.body;
    try {
      const [org] = await db.select().from(schema.organizations)
        .where(eq(schema.organizations.slug, orgSlug)).limit(1);
      if (!org || !org.isActive) return unauthorized(res, 'Invalid credentials');

      const [user] = await db.select().from(schema.users)
        .where(and(
          eq(schema.users.organizationId, org.id),
          eq(schema.users.username, username),
        )).limit(1);
      if (!user || user.status !== 'active') return unauthorized(res, 'Invalid credentials');

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return unauthorized(res, 'Invalid credentials');

      const payload = { userId: user.id, orgId: org.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      await db.insert(schema.refreshTokens).values({
        token: refreshToken, userId: user.id, organizationId: org.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, user.id));

      return ok(res, {
        user: { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, avatarUrl: user.avatarUrl },
        organization: { id: org.id, name: org.name, slug: org.slug },
        accessToken, refreshToken,
      });
    } catch (e) {
      logger.error('login error', e);
      return serverError(res);
    }
  }
);

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return badRequest(res, 'Refresh token required');
  try {
    const payload = verifyRefreshToken(refreshToken);
    const [stored] = await db.select().from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.token, refreshToken)).limit(1);
    if (!stored || stored.expiresAt < new Date()) return unauthorized(res, 'Refresh token expired or invalid');

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, payload.userId)).limit(1);
    if (!user || user.status !== 'active') return unauthorized(res, 'User inactive');

    await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.token, refreshToken));

    const newPayload = { userId: user.id, orgId: payload.orgId, role: user.role };
    const newAccess = signAccessToken(newPayload);
    const newRefresh = signRefreshToken(newPayload);

    await db.insert(schema.refreshTokens).values({
      token: newRefresh, userId: user.id, organizationId: payload.orgId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return ok(res, { accessToken: newAccess, refreshToken: newRefresh });
  } catch {
    return unauthorized(res, 'Invalid refresh token');
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.token, refreshToken)).catch(() => null);
  }
  return ok(res, null, 'Logged out');
});

// GET /auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const auth = (req as AuthRequest).auth;
  try {
    const [user] = await db.select({
      id: schema.users.id, name: schema.users.name, username: schema.users.username,
      email: schema.users.email, role: schema.users.role, status: schema.users.status,
      avatarUrl: schema.users.avatarUrl, lastSeenAt: schema.users.lastSeenAt,
    }).from(schema.users).where(eq(schema.users.id, auth.userId)).limit(1);

    if (!user) return unauthorized(res);

    const [org] = await db.select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
      .from(schema.organizations).where(eq(schema.organizations.id, auth.orgId)).limit(1);

    return ok(res, { ...user, organization: org });
  } catch (e) {
    return serverError(res);
  }
});

export default router;

import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import bcrypt from 'bcryptjs';
import { eq, and, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { authenticate } from '../middleware/authenticate';
import { authorizeMinRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ok, created, badRequest, notFound, conflict, serverError, noContent } from '../utils/response';
import { paginate } from '../utils/paginate';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';

const router = Router();
router.use(authenticate);

const userCols = {
  id: schema.users.id, name: schema.users.name, email: schema.users.email,
  username: schema.users.username, role: schema.users.role, status: schema.users.status,
  avatarUrl: schema.users.avatarUrl, lastLatitude: schema.users.lastLatitude,
  lastLongitude: schema.users.lastLongitude, lastSeenAt: schema.users.lastSeenAt,
  createdAt: schema.users.createdAt, updatedAt: schema.users.updatedAt,
};

// GET /users
router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, role, status, search } = req.query as Record<string, string>;
  const { skip, take } = paginate(page, limit);
  try {
    const conditions = [eq(schema.users.organizationId, req.auth.orgId)];
    if (role) conditions.push(eq(schema.users.role, role as typeof schema.users.role._.data));
    if (status) conditions.push(eq(schema.users.status, status as typeof schema.users.status._.data));
    if (search) conditions.push(or(
      ilike(schema.users.name, `%${search}%`),
      ilike(schema.users.username, `%${search}%`),
      ilike(schema.users.email, `%${search}%`),
    )!);

    const where = and(...conditions);
    const [users, [{ count }]] = await Promise.all([
      db.select(userCols).from(schema.users).where(where).limit(take).offset(skip).orderBy(schema.users.name),
      db.select({ count: sql<number>`count(*)` }).from(schema.users).where(where),
    ]);
    return ok(res, { users, total: Number(count), page: parseInt(page ?? '1'), limit: take });
  } catch (e) {
    logger.error('list users', e);
    return serverError(res);
  }
});

// GET /users/:id
router.get('/:id', [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  try {
    const [user] = await db.select(userCols).from(schema.users)
      .where(and(eq(schema.users.id, req.params.id), eq(schema.users.organizationId, req.auth.orgId))).limit(1);
    if (!user) return notFound(res);
    return ok(res, user);
  } catch (e) {
    return serverError(res);
  }
});

// POST /users
router.post(
  '/',
  authorizeMinRole('admin'),
  [
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('username').trim().isLength({ min: 3 }),
    body('password').isLength({ min: 8 }),
    body('role').isIn(['admin', 'supervisor', 'field_agent', 'viewer']),
    validate,
  ],
  async (req: AuthRequest, res: Response) => {
    const { name, email, username, password, role } = req.body;
    try {
      const existing = await db.select({ id: schema.users.id }).from(schema.users)
        .where(and(eq(schema.users.organizationId, req.auth.orgId), eq(schema.users.username, username))).limit(1);
      if (existing.length) return conflict(res, 'Username already taken in this organization');

      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await db.insert(schema.users).values({
        organizationId: req.auth.orgId, name, email, username, passwordHash,
        role, createdBy: req.auth.userId,
      }).returning(userCols);
      return created(res, user);
    } catch (e) {
      logger.error('create user', e);
      return serverError(res);
    }
  }
);

// PATCH /users/:id
router.patch('/:id', authorizeMinRole('admin'), [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  const { name, email, role, status, avatarUrl } = req.body;
  try {
    const [existing] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.id, req.params.id), eq(schema.users.organizationId, req.auth.orgId))).limit(1);
    if (!existing) return notFound(res);

    const [updated] = await db.update(schema.users)
      .set({ name, email, role, status, avatarUrl, updatedAt: new Date() })
      .where(eq(schema.users.id, req.params.id)).returning(userCols);
    return ok(res, updated);
  } catch (e) {
    return serverError(res);
  }
});

// POST /users/:id/change-password
router.post('/:id/change-password',
  [param('id').isUUID(), body('newPassword').isLength({ min: 8 }), validate],
  async (req: AuthRequest, res: Response) => {
    const isSelf = req.params.id === req.auth.userId;
    const isAdmin = ['admin', 'super_admin'].includes(req.auth.role);
    if (!isSelf && !isAdmin) return notFound(res);

    try {
      const [existing] = await db.select().from(schema.users)
        .where(and(eq(schema.users.id, req.params.id), eq(schema.users.organizationId, req.auth.orgId))).limit(1);
      if (!existing) return notFound(res);

      if (isSelf) {
        const { currentPassword } = req.body;
        if (!currentPassword) return badRequest(res, 'Current password required');
        if (!await bcrypt.compare(currentPassword, existing.passwordHash)) return badRequest(res, 'Current password incorrect');
      }

      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      await db.update(schema.users).set({ passwordHash, updatedAt: new Date() }).where(eq(schema.users.id, req.params.id));
      return ok(res, null, 'Password changed');
    } catch (e) {
      return serverError(res);
    }
  }
);

// DELETE /users/:id
router.delete('/:id', authorizeMinRole('admin'), [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  if (req.params.id === req.auth.userId) return badRequest(res, 'Cannot delete your own account');
  try {
    const [existing] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.id, req.params.id), eq(schema.users.organizationId, req.auth.orgId))).limit(1);
    if (!existing) return notFound(res);
    await db.delete(schema.users).where(eq(schema.users.id, req.params.id));
    return noContent(res);
  } catch (e) {
    return serverError(res);
  }
});

// POST /users/:id/assign-zone
router.post('/:id/assign-zone', authorizeMinRole('admin'),
  [param('id').isUUID(), body('zoneId').isUUID(), validate],
  async (req: AuthRequest, res: Response) => {
    const { zoneId } = req.body;
    try {
      const [[user], [zone]] = await Promise.all([
        db.select({ id: schema.users.id }).from(schema.users)
          .where(and(eq(schema.users.id, req.params.id), eq(schema.users.organizationId, req.auth.orgId))).limit(1),
        db.select({ id: schema.zones.id }).from(schema.zones)
          .where(and(eq(schema.zones.id, zoneId), eq(schema.zones.organizationId, req.auth.orgId))).limit(1),
      ]);
      if (!user || !zone) return notFound(res);
      await db.insert(schema.zoneAssignments).values({ userId: req.params.id, zoneId }).onConflictDoNothing();
      return ok(res, null, 'Zone assigned');
    } catch (e) {
      return serverError(res);
    }
  }
);

// DELETE /users/:id/assign-zone/:zoneId
router.delete('/:id/assign-zone/:zoneId', authorizeMinRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(schema.zoneAssignments)
      .where(and(eq(schema.zoneAssignments.userId, req.params.id), eq(schema.zoneAssignments.zoneId, req.params.zoneId)));
    return noContent(res);
  } catch (e) {
    return serverError(res);
  }
});

export default router;

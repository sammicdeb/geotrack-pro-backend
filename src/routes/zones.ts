import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { authenticate } from '../middleware/authenticate';
import { authorizeMinRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ok, created, notFound, serverError, noContent } from '../utils/response';
import { paginate } from '../utils/paginate';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';

const router = Router();
router.use(authenticate);

// GET /zones
router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, status, search } = req.query as Record<string, string>;
  const { skip, take } = paginate(page, limit);
  try {
    const conditions = [eq(schema.zones.organizationId, req.auth.orgId)];
    if (status) conditions.push(eq(schema.zones.status, status as typeof schema.zones.status._.data));
    if (search) conditions.push(ilike(schema.zones.name, `%${search}%`));

    const where = and(...conditions);
    const [zones, [{ count }]] = await Promise.all([
      db.select().from(schema.zones).where(where).limit(take).offset(skip).orderBy(schema.zones.name),
      db.select({ count: sql<number>`count(*)` }).from(schema.zones).where(where),
    ]);
    return ok(res, { zones, total: Number(count), page: parseInt(page ?? '1'), limit: take });
  } catch (e) {
    logger.error('list zones', e);
    return serverError(res);
  }
});

// GET /zones/:id
router.get('/:id', [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  try {
    const [zone] = await db.select().from(schema.zones)
      .where(and(eq(schema.zones.id, req.params.id), eq(schema.zones.organizationId, req.auth.orgId))).limit(1);
    if (!zone) return notFound(res);
    return ok(res, zone);
  } catch (e) {
    return serverError(res);
  }
});

// POST /zones
router.post(
  '/',
  authorizeMinRole('supervisor'),
  [
    body('name').trim().notEmpty(),
    body('shape').isIn(['polygon', 'circle']),
    body('coordinates').isArray({ min: 1 }),
    validate,
  ],
  async (req: AuthRequest, res: Response) => {
    const { name, description, shape, coordinates, radius, color, fillOpacity,
      scheduleEnabled, scheduleDays, scheduleStart, scheduleEnd, scheduleTimezone, source } = req.body;
    try {
      const [zone] = await db.insert(schema.zones).values({
        organizationId: req.auth.orgId, name, description, shape, coordinates, radius,
        color: color ?? '#3B82F6', fillOpacity: fillOpacity ?? 0.2,
        scheduleEnabled: scheduleEnabled ?? false, scheduleDays: scheduleDays ?? [],
        scheduleStart, scheduleEnd, scheduleTimezone,
        source: source ?? 'drawn', createdBy: req.auth.userId,
      }).returning();
      return created(res, zone);
    } catch (e) {
      logger.error('create zone', e);
      return serverError(res);
    }
  }
);

// PATCH /zones/:id
router.patch('/:id', authorizeMinRole('supervisor'), [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  const { name, description, shape, coordinates, radius, color, fillOpacity,
    status, scheduleEnabled, scheduleDays, scheduleStart, scheduleEnd, scheduleTimezone } = req.body;
  try {
    const [existing] = await db.select({ id: schema.zones.id }).from(schema.zones)
      .where(and(eq(schema.zones.id, req.params.id), eq(schema.zones.organizationId, req.auth.orgId))).limit(1);
    if (!existing) return notFound(res);

    const [zone] = await db.update(schema.zones)
      .set({ name, description, shape, coordinates, radius, color, fillOpacity,
        status, scheduleEnabled, scheduleDays, scheduleStart, scheduleEnd, scheduleTimezone,
        updatedAt: new Date() })
      .where(eq(schema.zones.id, req.params.id)).returning();
    return ok(res, zone);
  } catch (e) {
    return serverError(res);
  }
});

// DELETE /zones/:id
router.delete('/:id', authorizeMinRole('admin'), [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  try {
    const [existing] = await db.select({ id: schema.zones.id }).from(schema.zones)
      .where(and(eq(schema.zones.id, req.params.id), eq(schema.zones.organizationId, req.auth.orgId))).limit(1);
    if (!existing) return notFound(res);
    await db.delete(schema.zones).where(eq(schema.zones.id, req.params.id));
    return noContent(res);
  } catch (e) {
    return serverError(res);
  }
});

export default router;

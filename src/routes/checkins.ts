import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import { v4 as uuid } from 'uuid';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { ok, created, notFound, serverError } from '../utils/response';
import { paginate } from '../utils/paginate';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';

const router = Router();
router.use(authenticate);

// GET /checkins
router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit } = req.query as Record<string, string>;
  const { skip, take } = paginate(page, limit);
  try {
    const conditions = [eq(schema.checkIns.organizationId, req.auth.orgId)];
    if (req.auth.role === 'field_agent') conditions.push(eq(schema.checkIns.userId, req.auth.userId));

    const where = and(...conditions);
    const [checkIns, [{ count }]] = await Promise.all([
      db.select().from(schema.checkIns).where(where).limit(take).offset(skip).orderBy(sql`${schema.checkIns.createdAt} desc`),
      db.select({ count: sql<number>`count(*)` }).from(schema.checkIns).where(where),
    ]);
    return ok(res, { checkIns, total: Number(count), page: parseInt(page ?? '1'), limit: take });
  } catch (e) {
    logger.error('list checkins', e);
    return serverError(res);
  }
});

// POST /checkins
router.post('/',
  [
    body('type').isIn(['check_in', 'check_out']),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    validate,
  ],
  async (req: AuthRequest, res: Response) => {
    const { type, latitude, longitude, zoneId, note, durationSeconds, sessionId } = req.body;
    try {
      const [checkIn] = await db.insert(schema.checkIns).values({
        organizationId: req.auth.orgId, userId: req.auth.userId,
        sessionId: sessionId ?? uuid(), type, latitude, longitude, zoneId, note,
        durationSeconds: durationSeconds ? parseInt(durationSeconds, 10) : undefined,
      }).returning();
      return created(res, checkIn);
    } catch (e) {
      logger.error('create checkin', e);
      return serverError(res);
    }
  }
);

// GET /checkins/:id
router.get('/:id', [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  try {
    const [checkIn] = await db.select().from(schema.checkIns)
      .where(and(eq(schema.checkIns.id, req.params.id), eq(schema.checkIns.organizationId, req.auth.orgId))).limit(1);
    if (!checkIn) return notFound(res);
    return ok(res, checkIn);
  } catch (e) {
    return serverError(res);
  }
});

export default router;

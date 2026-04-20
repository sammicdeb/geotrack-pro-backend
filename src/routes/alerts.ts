import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { authenticate } from '../middleware/authenticate';
import { authorizeMinRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ok, created, notFound, serverError, noContent } from '../utils/response';
import { paginate } from '../utils/paginate';
import { AuthRequest } from '../types';
import { getIO } from '../socket/io';
import { logger } from '../config/logger';

const router = Router();
router.use(authenticate);

// GET /alerts
router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit } = req.query as Record<string, string>;
  const { skip, take } = paginate(page, limit);
  try {
    const conditions = [eq(schema.alerts.organizationId, req.auth.orgId)];
    if (req.auth.role === 'field_agent') conditions.push(eq(schema.alerts.userId, req.auth.userId));

    const where = and(...conditions);
    const [alerts, [{ count }]] = await Promise.all([
      db.select().from(schema.alerts).where(where).limit(take).offset(skip).orderBy(sql`${schema.alerts.createdAt} desc`),
      db.select({ count: sql<number>`count(*)` }).from(schema.alerts).where(where),
    ]);
    return ok(res, { alerts, total: Number(count), page: parseInt(page ?? '1'), limit: take });
  } catch (e) {
    logger.error('list alerts', e);
    return serverError(res);
  }
});

// GET /alerts/unread-count
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const conditions = [eq(schema.alerts.organizationId, req.auth.orgId), eq(schema.alerts.read, false)];
    if (req.auth.role === 'field_agent') conditions.push(eq(schema.alerts.userId, req.auth.userId));
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.alerts).where(and(...conditions));
    return ok(res, { count: Number(count) });
  } catch (e) {
    return serverError(res);
  }
});

// GET /alerts/:id
router.get('/:id', [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  try {
    const [alert] = await db.select().from(schema.alerts)
      .where(and(eq(schema.alerts.id, req.params.id), eq(schema.alerts.organizationId, req.auth.orgId))).limit(1);
    if (!alert) return notFound(res);
    return ok(res, alert);
  } catch (e) {
    return serverError(res);
  }
});

// POST /alerts
router.post('/',
  [
    body('type').isIn(['entry', 'exit', 'violation', 'sos', 'admin_message']),
    body('severity').optional().isIn(['info', 'warning', 'critical']),
    body('userId').isUUID(),
    body('message').trim().notEmpty(),
    validate,
  ],
  async (req: AuthRequest, res: Response) => {
    const { type, severity, userId, zoneId, message, latitude, longitude } = req.body;
    try {
      const [alert] = await db.insert(schema.alerts).values({
        organizationId: req.auth.orgId, type, severity: severity ?? 'info',
        userId, zoneId, message, latitude, longitude,
      }).returning();

      try { getIO().to(`org:${req.auth.orgId}`).emit('alert:new', alert); } catch { /* socket not ready */ }
      return created(res, alert);
    } catch (e) {
      logger.error('create alert', e);
      return serverError(res);
    }
  }
);

// POST /alerts/:id/acknowledge
router.post('/:id/acknowledge', authorizeMinRole('supervisor'), [param('id').isUUID(), validate],
  async (req: AuthRequest, res: Response) => {
    try {
      const [existing] = await db.select({ id: schema.alerts.id }).from(schema.alerts)
        .where(and(eq(schema.alerts.id, req.params.id), eq(schema.alerts.organizationId, req.auth.orgId))).limit(1);
      if (!existing) return notFound(res);

      const [alert] = await db.update(schema.alerts)
        .set({ acknowledged: true, acknowledgedBy: req.auth.userId, acknowledgedAt: new Date(), read: true })
        .where(eq(schema.alerts.id, req.params.id)).returning();

      try { getIO().to(`org:${req.auth.orgId}`).emit('alert:acknowledged', alert); } catch { /* socket not ready */ }
      return ok(res, alert);
    } catch (e) {
      return serverError(res);
    }
  }
);

// POST /alerts/mark-read
router.post('/mark-read', async (req: AuthRequest, res: Response) => {
  try {
    const conditions = [eq(schema.alerts.organizationId, req.auth.orgId)];
    if (req.auth.role === 'field_agent') conditions.push(eq(schema.alerts.userId, req.auth.userId));
    await db.update(schema.alerts).set({ read: true }).where(and(...conditions));
    return ok(res, null, 'Marked as read');
  } catch (e) {
    return serverError(res);
  }
});

// DELETE /alerts/:id
router.delete('/:id', authorizeMinRole('admin'), [param('id').isUUID(), validate], async (req: AuthRequest, res: Response) => {
  try {
    const [existing] = await db.select({ id: schema.alerts.id }).from(schema.alerts)
      .where(and(eq(schema.alerts.id, req.params.id), eq(schema.alerts.organizationId, req.auth.orgId))).limit(1);
    if (!existing) return notFound(res);
    await db.delete(schema.alerts).where(eq(schema.alerts.id, req.params.id));
    return noContent(res);
  } catch (e) {
    return serverError(res);
  }
});

export default router;

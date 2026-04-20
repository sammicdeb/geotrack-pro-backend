import { Router, Response } from 'express';
import { eq, and, sql, gte, lte, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { authenticate } from '../middleware/authenticate';
import { authorizeMinRole } from '../middleware/authorize';
import { ok, serverError } from '../utils/response';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';

const router = Router();
router.use(authenticate);
router.use(authorizeMinRole('supervisor'));

// GET /reports/summary
router.get('/summary', async (req: AuthRequest, res: Response) => {
  const orgId = req.auth.orgId;
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  try {
    const [[totalUsers], [activeAgents], [totalZones], [unackedAlerts], [todayCheckIns]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.users)
        .where(and(eq(schema.users.organizationId, orgId), eq(schema.users.status, 'active'))),
      db.select({ count: sql<number>`count(*)` }).from(schema.users)
        .where(and(eq(schema.users.organizationId, orgId), eq(schema.users.role, 'field_agent'),
          eq(schema.users.status, 'active'), gte(schema.users.lastSeenAt, thirtyMinAgo))),
      db.select({ count: sql<number>`count(*)` }).from(schema.zones)
        .where(and(eq(schema.zones.organizationId, orgId), eq(schema.zones.status, 'active'))),
      db.select({ count: sql<number>`count(*)` }).from(schema.alerts)
        .where(and(eq(schema.alerts.organizationId, orgId), eq(schema.alerts.acknowledged, false))),
      db.select({ count: sql<number>`count(*)` }).from(schema.checkIns)
        .where(and(eq(schema.checkIns.organizationId, orgId), gte(schema.checkIns.createdAt, todayStart))),
    ]);
    return ok(res, {
      totalUsers: Number(totalUsers.count),
      activeAgents: Number(activeAgents.count),
      totalZones: Number(totalZones.count),
      unacknowledgedAlerts: Number(unackedAlerts.count),
      todayCheckIns: Number(todayCheckIns.count),
    });
  } catch (e) {
    logger.error('summary report', e);
    return serverError(res);
  }
});

// GET /reports/time-in-zone
router.get('/time-in-zone', async (req: AuthRequest, res: Response) => {
  const { from, to } = req.query as Record<string, string>;
  const orgId = req.auth.orgId;
  try {
    const conditions = [eq(schema.checkIns.organizationId, orgId), eq(schema.checkIns.type, 'check_out'), isNotNull(schema.checkIns.durationSeconds)];
    if (from) conditions.push(gte(schema.checkIns.createdAt, new Date(from)));
    if (to) conditions.push(lte(schema.checkIns.createdAt, new Date(to)));

    const rows = await db.select({
      userId: schema.checkIns.userId,
      durationSeconds: schema.checkIns.durationSeconds,
      userName: schema.users.name,
    }).from(schema.checkIns)
      .innerJoin(schema.users, eq(schema.checkIns.userId, schema.users.id))
      .where(and(...conditions));

    const byUser: Record<string, { userId: string; userName: string; totalSeconds: number }> = {};
    for (const r of rows) {
      if (!byUser[r.userId]) byUser[r.userId] = { userId: r.userId, userName: r.userName, totalSeconds: 0 };
      byUser[r.userId].totalSeconds += r.durationSeconds ?? 0;
    }

    const result = Object.values(byUser)
      .map(u => ({ ...u, totalHours: parseFloat((u.totalSeconds / 3600).toFixed(2)) }))
      .sort((a, b) => b.totalHours - a.totalHours);
    return ok(res, result);
  } catch (e) {
    return serverError(res);
  }
});

// GET /reports/daily-checkins
router.get('/daily-checkins', async (req: AuthRequest, res: Response) => {
  const { from, to } = req.query as Record<string, string>;
  const orgId = req.auth.orgId;
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = to ? new Date(to) : new Date();
  try {
    const rows = await db.select({ createdAt: schema.checkIns.createdAt }).from(schema.checkIns)
      .where(and(eq(schema.checkIns.organizationId, orgId), eq(schema.checkIns.type, 'check_in'),
        gte(schema.checkIns.createdAt, start), lte(schema.checkIns.createdAt, end)));

    const byDay: Record<string, number> = {};
    for (const r of rows) {
      const day = r.createdAt.toISOString().split('T')[0];
      byDay[day] = (byDay[day] ?? 0) + 1;
    }
    const result = Object.entries(byDay).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
    return ok(res, result);
  } catch (e) {
    return serverError(res);
  }
});

// GET /reports/alert-breakdown
router.get('/alert-breakdown', async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      type: schema.alerts.type,
      severity: schema.alerts.severity,
      count: sql<number>`count(*)`,
    }).from(schema.alerts)
      .where(eq(schema.alerts.organizationId, req.auth.orgId))
      .groupBy(schema.alerts.type, schema.alerts.severity);
    return ok(res, rows.map(r => ({ ...r, count: Number(r.count) })));
  } catch (e) {
    return serverError(res);
  }
});

// GET /reports/audit-log
router.get('/audit-log', async (req: AuthRequest, res: Response) => {
  const { page, limit } = req.query as Record<string, string>;
  const skip = Math.max(0, (parseInt(page ?? '1') - 1) * 20);
  const take = Math.min(100, parseInt(limit ?? '20'));
  try {
    const [logs, [{ count }]] = await Promise.all([
      db.select({
        id: schema.auditLogs.id, action: schema.auditLogs.action,
        targetId: schema.auditLogs.targetId, targetType: schema.auditLogs.targetType,
        targetName: schema.auditLogs.targetName, metadata: schema.auditLogs.metadata,
        createdAt: schema.auditLogs.createdAt,
        performedByName: schema.users.name, performedByUsername: schema.users.username,
      }).from(schema.auditLogs)
        .innerJoin(schema.users, eq(schema.auditLogs.performedById, schema.users.id))
        .where(eq(schema.auditLogs.organizationId, req.auth.orgId))
        .limit(take).offset(skip).orderBy(sql`${schema.auditLogs.createdAt} desc`),
      db.select({ count: sql<number>`count(*)` }).from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, req.auth.orgId)),
    ]);
    return ok(res, { logs, total: Number(count) });
  } catch (e) {
    return serverError(res);
  }
});

export default router;

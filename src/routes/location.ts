import { Router, Response } from 'express';
import { body } from 'express-validator';
import { eq, and, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { authenticate } from '../middleware/authenticate';
import { authorizeMinRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ok, serverError } from '../utils/response';
import { AuthRequest } from '../types';
import { getIO } from '../socket/io';

const router = Router();
router.use(authenticate);

// POST /location
router.post('/',
  [body('latitude').isFloat({ min: -90, max: 90 }), body('longitude').isFloat({ min: -180, max: 180 }), validate],
  async (req: AuthRequest, res: Response) => {
    const { latitude, longitude } = req.body;
    try {
      await db.update(schema.users)
        .set({ lastLatitude: latitude, lastLongitude: longitude, lastSeenAt: new Date() })
        .where(eq(schema.users.id, req.auth.userId));
      try {
        getIO().to(`org:${req.auth.orgId}`).emit('location:updated', {
          userId: req.auth.userId, latitude, longitude, timestamp: new Date().toISOString(),
        });
      } catch { /* socket not ready */ }
      return ok(res, null, 'Location updated');
    } catch (e) {
      return serverError(res);
    }
  }
);

// GET /location/agents
router.get('/agents', authorizeMinRole('supervisor'), async (req: AuthRequest, res: Response) => {
  try {
    const agents = await db.select({
      id: schema.users.id, name: schema.users.name, username: schema.users.username,
      avatarUrl: schema.users.avatarUrl, lastLatitude: schema.users.lastLatitude,
      lastLongitude: schema.users.lastLongitude, lastSeenAt: schema.users.lastSeenAt,
    }).from(schema.users).where(and(
      eq(schema.users.organizationId, req.auth.orgId),
      eq(schema.users.role, 'field_agent'),
      eq(schema.users.status, 'active'),
      isNotNull(schema.users.lastLatitude),
    ));
    return ok(res, agents);
  } catch (e) {
    return serverError(res);
  }
});

export default router;

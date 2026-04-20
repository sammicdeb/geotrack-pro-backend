import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { eq } from 'drizzle-orm';
import { verifyAccessToken } from '../utils/jwt';
import { db, schema } from '../db';
import { logger } from '../config/logger';
import { env } from '../config/env';

let io: Server;

export const initSocket = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: { origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    try {
      (socket as Socket & { auth: ReturnType<typeof verifyAccessToken> }).auth = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const auth = (socket as Socket & { auth: ReturnType<typeof verifyAccessToken> }).auth;
    logger.debug(`Socket connected: ${auth.userId}`);
    socket.join(`org:${auth.orgId}`);
    socket.join(`user:${auth.userId}`);

    socket.on('location:update', async (data: { latitude: number; longitude: number }) => {
      const { latitude, longitude } = data;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
      try {
        await db.update(schema.users)
          .set({ lastLatitude: latitude, lastLongitude: longitude, lastSeenAt: new Date() })
          .where(eq(schema.users.id, auth.userId));
        socket.to(`org:${auth.orgId}`).emit('location:updated', {
          userId: auth.userId, latitude, longitude, timestamp: new Date().toISOString(),
        });
      } catch (e) {
        logger.error('location:update error', e);
      }
    });

    socket.on('sos', async (data: { latitude?: number; longitude?: number; message?: string }) => {
      try {
        const [alert] = await db.insert(schema.alerts).values({
          organizationId: auth.orgId, type: 'sos', severity: 'critical',
          userId: auth.userId,
          message: data.message ?? 'SOS - Agent needs immediate assistance',
          latitude: data.latitude, longitude: data.longitude,
        }).returning();
        io.to(`org:${auth.orgId}`).emit('alert:new', alert);
      } catch (e) {
        logger.error('sos error', e);
      }
    });

    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${auth.userId}`));
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

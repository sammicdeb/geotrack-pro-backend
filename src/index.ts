import './config/env';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { logger } from './config/logger';
import { initSocket } from './socket/io';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import zoneRoutes from './routes/zones';
import alertRoutes from './routes/alerts';
import checkInRoutes from './routes/checkins';
import locationRoutes from './routes/location';
import reportRoutes from './routes/reports';

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : true, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth',     authRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/zones',    zoneRoutes);
app.use('/api/alerts',   alertRoutes);
app.use('/api/checkins', checkInRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/reports',  reportRoutes);

app.use(errorHandler);

const start = async () => {
  await db.execute(sql`SELECT 1`);
  logger.info('Database connected');

  initSocket(server);
  logger.info('Socket.io initialized');

  server.listen(env.PORT, () => {
    logger.info(`GeoTrack Pro API running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
};

start().catch(e => {
  logger.error('Failed to start server', e);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  server.close(() => process.exit(0));
});

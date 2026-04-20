import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
};

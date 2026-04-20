import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { unauthorized } from '../utils/response';
import { AuthRequest } from '../types';

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { unauthorized(res); return; }
  const token = header.slice(7);
  try {
    (req as AuthRequest).auth = verifyAccessToken(token);
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
};

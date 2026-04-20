import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from '../types';
import { forbidden } from '../utils/response';

const ROLE_RANK: Record<Role, number> = {
  super_admin: 5,
  admin: 4,
  supervisor: 3,
  field_agent: 2,
  viewer: 1,
};

export const authorize = (...roles: Role[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!roles.includes(req.auth.role)) { forbidden(res); return; }
    next();
  };

export const authorizeMinRole = (minRole: Role) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (ROLE_RANK[req.auth.role] < ROLE_RANK[minRole]) { forbidden(res); return; }
    next();
  };

import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { badRequest } from '../utils/response';

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    badRequest(res, errors.array().map(e => e.msg).join(', '));
    return;
  }
  next();
};

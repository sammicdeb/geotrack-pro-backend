import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthPayload {
  userId: string;
  orgId: string;
  role: Role;
}

export interface AuthRequest extends Request {
  auth: AuthPayload;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type PaginatedQuery = {
  page?: string;
  limit?: string;
};

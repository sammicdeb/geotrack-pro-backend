import { Request } from 'express';

export type Role = 'super_admin' | 'admin' | 'supervisor' | 'field_agent' | 'viewer';

export interface AuthPayload {
  userId: string;
  orgId: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthPayload;
    }
  }
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

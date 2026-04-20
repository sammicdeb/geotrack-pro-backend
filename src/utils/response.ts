import { Response } from 'express';
import { ApiResponse } from '../types';

export const ok = <T>(res: Response, data: T, message?: string) =>
  res.json({ success: true, data, message } as ApiResponse<T>);

export const created = <T>(res: Response, data: T) =>
  res.status(201).json({ success: true, data } as ApiResponse<T>);

export const noContent = (res: Response) => res.status(204).send();

export const badRequest = (res: Response, error: string) =>
  res.status(400).json({ success: false, error } as ApiResponse);

export const unauthorized = (res: Response, error = 'Unauthorized') =>
  res.status(401).json({ success: false, error } as ApiResponse);

export const forbidden = (res: Response, error = 'Forbidden') =>
  res.status(403).json({ success: false, error } as ApiResponse);

export const notFound = (res: Response, error = 'Not found') =>
  res.status(404).json({ success: false, error } as ApiResponse);

export const conflict = (res: Response, error: string) =>
  res.status(409).json({ success: false, error } as ApiResponse);

export const serverError = (res: Response, error = 'Internal server error') =>
  res.status(500).json({ success: false, error } as ApiResponse);

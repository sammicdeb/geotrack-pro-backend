import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthPayload } from '../types';

export const signAccessToken = (payload: AuthPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

export const signRefreshToken = (payload: AuthPayload): string =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions);

export const verifyAccessToken = (token: string): AuthPayload =>
  jwt.verify(token, env.JWT_SECRET) as AuthPayload;

export const verifyRefreshToken = (token: string): AuthPayload =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as AuthPayload;

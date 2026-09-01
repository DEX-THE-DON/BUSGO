import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role, User } from '@busgo/types';
import { env } from './env.js';
import { HttpError } from './http-error.js';
import type { Db } from './db.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Per-request database session (attached by the index.ts onRequest hook). */
    db: Db;
    /** Authenticated user (set by the authenticate preHandler). */
    user?: User;
  }
}

const ALGORITHM = 'HS256';

export function hashPassword(password: string): string {
  // 12 rounds — the same cost passlib used for the seeded demo accounts, so
  // existing password hashes in the database remain verifiable.
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(plainPassword: string, passwordHash?: string | null): boolean {
  if (!passwordHash) return false;
  try {
    return bcrypt.compareSync(plainPassword, passwordHash);
  } catch {
    return false;
  }
}

export function createAccessToken(data: Record<string, unknown>, expiresDeltaMinutes?: number): string {
  const payload = {
    ...data,
    exp: Math.floor(Date.now() / 1000) + 60 * (expiresDeltaMinutes ?? env.accessTokenExpireMinutes),
  };
  return jwt.sign(payload, env.jwtSecret, { algorithm: ALGORITHM });
}

export function decodeAccessToken(token: string): Record<string, unknown> {
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: [ALGORITHM] }) as Record<string, unknown>;
  } catch {
    throw new HttpError(401, 'Invalid or expired authentication token');
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/** TS equivalent of FastAPI's get_current_user dependency. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Not authenticated');

  const payload = decodeAccessToken(token);
  const userId = payload.sub;
  if (userId === undefined || userId === null) {
    throw new HttpError(401, 'Invalid token payload');
  }

  const row = await request.db.first(
    'SELECT id, full_name, email, phone, role FROM users WHERE id = :id',
    { id: Number(userId) },
  );
  if (!row) throw new HttpError(401, 'User no longer exists');
  request.user = row as unknown as User;
}

/** TS equivalent of FastAPI's require_roles(...) dependency factory. */
export function authorize(...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      throw new HttpError(403, `This action requires one of the following roles: ${roles.join(', ')}`);
    }
  };
}

import type { FastifyInstance } from 'fastify';
import {
  AuthResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  UserSchema,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
} from '@busgo/types';
import { authenticate, createAccessToken, hashPassword, verifyPassword } from '../auth.js';
import { HttpError } from '../http-error.js';
import { validateBody } from '../util.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    '/api/auth/register',
    { preValidation: validateBody(RegisterRequestSchema) },
    async (request) => {
      const body = request.body as RegisterRequest;
      const db = request.db;

      const existing = await db.first('SELECT id FROM users WHERE email = :email;', { email: body.email });
      if (existing) throw new HttpError(409, 'An account with that email already exists.');

      const row = await db.first(
        `INSERT INTO users (full_name, email, phone, password_hash, role, created_at)
         VALUES (:full_name, :email, :phone, :pw, 'user', now())
         RETURNING id, full_name, email, phone, role;`,
        { full_name: body.full_name, email: body.email, phone: body.phone ?? null, pw: hashPassword(body.password) },
      );
      await db.commit();

      const token = createAccessToken({ sub: String(row!.id), role: row!.role });
      return AuthResponseSchema.parse({
        access_token: token,
        token_type: 'bearer',
        user: row,
      }) satisfies AuthResponse;
    },
  );

  app.post(
    '/api/auth/login',
    { preValidation: validateBody(LoginRequestSchema) },
    async (request) => {
      const body = request.body as LoginRequest;
      const db = request.db;

      const user = await db.first(
        'SELECT id, full_name, email, phone, role, password_hash FROM users WHERE email = :email;',
        { email: body.email },
      );
      if (!user || !verifyPassword(body.password, user.password_hash as string | null)) {
        throw new HttpError(401, 'Invalid email or password.');
      }

      const token = createAccessToken({ sub: String(user.id), role: user.role });
      const { password_hash: _ignored, ...safeUser } = user;
      return AuthResponseSchema.parse({
        access_token: token,
        token_type: 'bearer',
        user: UserSchema.parse(safeUser),
      }) satisfies AuthResponse;
    },
  );

  app.get('/api/auth/me', { preHandler: [authenticate] }, async (request) => {
    return request.user;
  });
}

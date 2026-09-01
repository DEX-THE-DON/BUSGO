import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { HttpError } from './http-error.js';

/**
 * Fastify preValidation hook that validates + coerces the request body with a
 * Zod schema (the TS equivalent of FastAPI/Pydantic body parsing).
 */
export function validateBody(schema: ZodType) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return reply.code(400).send({ detail });
    }
    request.body = parsed.data;
  };
}

export function parseId(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, 'Invalid id');
  return n;
}

/** node-postgres returns NUMERIC/BIGINT as strings — normalise to number. */
export function toNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function toNumRecord<T extends Record<string, unknown>>(row: T, keys: Array<keyof T>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of keys) out[key as string] = toNum(row[key]);
  return out;
}

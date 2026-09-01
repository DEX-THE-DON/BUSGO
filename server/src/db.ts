import { Pool, type PoolClient } from 'pg';
import { env } from './env.js';

/**
 * node-postgres pool. Connections are acquired per-request (see index.ts
 * hooks) so each request gets one DB client, mirroring the per-request async
 * session behaviour of the original SQLAlchemy backend.
 */
export const pool = new Pool({ connectionString: env.databaseUrl, max: 20 });

export type SqlValue = unknown;

export interface Row {
  [key: string]: unknown;
}

/**
 * Translate the `:name` named-placeholder SQL used by the original backend
 * into node-postgres positional `$1..$n` parameters. A negative lookbehind
 * keeps Postgres `::cast` syntax (`::date`, `::jsonb`) intact.
 */
function convert(sql: string, params?: Record<string, SqlValue>): { text: string; values: unknown[] } {
  if (!params) return { text: sql, values: [] };
  const index = new Map<string, number>();
  const values: unknown[] = [];
  for (const key of Object.keys(params)) {
    index.set(key, values.length + 1);
    values.push(params[key] === undefined ? null : params[key]);
  }
  const text = sql.replace(/(?<!:):([A-Za-z_]\w*)/g, (_m, name: string) => `$${index.get(name) ?? -1}`);
  return { text, values };
}

/**
 * A per-request database session exposing the same result-shaped helpers as
 * the SQLAlchemy code it replaces:
 *   all()       -> Row[]            (mappings().all())
 *   first()     -> Row | undefined  (mappings().first())
 *   value()     -> scalar | undefined (scalars().first())
 *   scalarOne() -> scalar (throws if empty, scalars().one())
 *   execute()   -> Row[] for INSERT/UPDATE/DELETE ... RETURNING
 */
export class Db {
  private committed = false;
  private closed = false;

  constructor(private readonly client: PoolClient) {}

  private async run(sql: string, params?: Record<string, SqlValue>): Promise<Row[]> {
    const { text, values } = convert(sql, params);
    const res = await this.client.query(text, values);
    return res.rows as Row[];
  }

  async all(sql: string, params?: Record<string, SqlValue>): Promise<Row[]> {
    return this.run(sql, params);
  }

  async first(sql: string, params?: Record<string, SqlValue>): Promise<Row | undefined> {
    const rows = await this.run(sql, params);
    return rows[0];
  }

  async value(sql: string, params?: Record<string, SqlValue>): Promise<unknown> {
    const row = await this.first(sql, params);
    if (!row) return undefined;
    return Object.values(row)[0];
  }

  async scalarOne(sql: string, params?: Record<string, SqlValue>): Promise<unknown> {
    const v = await this.value(sql, params);
    if (v === undefined) throw new Error('Query returned no rows');
    return v;
  }

  async execute(sql: string, params?: Record<string, SqlValue>): Promise<Row[]> {
    return this.run(sql, params);
  }

  async commit(): Promise<void> {
    await this.client.query('COMMIT');
    this.committed = true;
  }

  async rollback(): Promise<void> {
    if (this.committed) return;
    try {
      await this.client.query('ROLLBACK');
    } catch {
      // nothing to roll back
    }
  }

  /** Release the pooled client. Uncommitted work is rolled back first. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.rollback();
    this.client.release();
  }
}

/**
 * Typed environment access. Mirrors the env vars the Python backend used
 * (see `.env.example`) 1:1, so a `.env` from the old stack keeps working.
 */

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isNaN(v) ? fallback : v;
}

export const env = {
  /**
   * The asyncpg driver prefix (`postgresql+asyncpg`) is not understood by
   * node-postgres; translate it to the standard `postgres` scheme.
   */
  databaseUrl: (
    str(
      'DATABASE_URL',
      `postgresql+asyncpg://${str('POSTGRES_USER', 'postgres')}:${str('POSTGRES_PASSWORD', 'DEX')}@${str('POSTGRES_HOST', 'localhost')}:${str('POSTGRES_PORT', '5432')}/${str('POSTGRES_DB', 'busgo_db')}`,
    )
  ).replace(/^postgresql(\+asyncpg)?:/, 'postgres:'),

  jwtSecret: str('JWT_SECRET_KEY', 'busgo-dev-secret-change-me'),
  accessTokenExpireMinutes: int('ACCESS_TOKEN_EXPIRE_MINUTES', 120),

  /** HTTP server binding */
  port: int('PORT', 8000),
  host: str('HOST', '0.0.0.0'),

  mpesa: {
    env: str('MPESA_ENV', 'sandbox'),
    consumerKey: str('MPESA_CONSUMER_KEY'),
    consumerSecret: str('MPESA_CONSUMER_SECRET'),
    passkey: str('MPESA_PASSKEY'),
    shortcode: str('MPESA_SHORTCODE', '174379'),
    callbackUrl: str(
      'MPESA_CALLBACK_URL',
      'https://your-domain.example.com/api/pay/daraja/callback',
    ),
  },
};

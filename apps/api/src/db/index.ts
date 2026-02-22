import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Logger } from '@nestjs/common';
import * as schema from './schema';
import { requireEnv } from '../config/env';

const databaseUrl = requireEnv('DATABASE_URL');
const logger = new Logger('Db');

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: readNumberEnv('PG_POOL_MAX', 10),
  idleTimeoutMillis: readNumberEnv('PG_IDLE_TIMEOUT_MS', 30_000),
  connectionTimeoutMillis: readNumberEnv('PG_CONNECT_TIMEOUT_MS', 10_000),
  keepAlive: true,
  ssl:
    process.env['DATABASE_SSL'] === 'true' ||
    databaseUrl.includes('.supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
});

pool.on('error', (error: Error) => {
  logger.error(`Postgres pool error: ${error.message}`, error.stack);
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { requireEnv } from '../config/env';

const databaseUrl = requireEnv('DATABASE_URL');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env['DATABASE_SSL'] === 'true' ||
    databaseUrl.includes('.supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;

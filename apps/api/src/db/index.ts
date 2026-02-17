import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  ssl:
    process.env['DATABASE_SSL'] === 'true' ||
    process.env['DATABASE_URL']?.includes('.supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;

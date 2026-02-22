import { Global, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { requireEnv } from '../config/env';

export const DRIZZLE = 'DRIZZLE';
const logger = new Logger('DbModule');

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): DrizzleDb => {
        const databaseUrl = requireEnv('DATABASE_URL');
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

        // Prevent process crashes when an idle pooled client errors.
        pool.on('error', (error: Error) => {
          logger.error(`Postgres pool error: ${error.message}`, error.stack);
        });

        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}

import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { requireEnv } from '../config/env';

export const DRIZZLE = 'DRIZZLE';

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
          ssl:
            process.env['DATABASE_SSL'] === 'true' ||
            databaseUrl.includes('.supabase.co')
              ? { rejectUnauthorized: false }
              : undefined,
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}

import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const DRIZZLE = 'DRIZZLE';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): DrizzleDb => {
        const pool = new Pool({
          connectionString: process.env['DATABASE_URL'],
          ssl:
            process.env['DATABASE_SSL'] === 'true' ||
            process.env['DATABASE_URL']?.includes('.supabase.co')
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

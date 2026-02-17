import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { OrgModule } from './org/org.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [DbModule, HealthModule, AuthModule, OrgModule, UsersModule],
})
export class AppModule {}

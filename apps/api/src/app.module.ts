import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { OrgModule } from './org/org.module';
import { UsersModule } from './users/users.module';
import { PlaybooksModule } from './playbooks/playbooks.module';

@Module({
  imports: [DbModule, HealthModule, AuthModule, OrgModule, UsersModule, PlaybooksModule],
})
export class AppModule {}

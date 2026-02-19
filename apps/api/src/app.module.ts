import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { OrgModule } from './org/org.module';
import { UsersModule } from './users/users.module';
import { PlaybooksModule } from './playbooks/playbooks.module';
import { AgentsModule } from './agents/agents.module';
import { CallsModule } from './calls/calls.module';
import { SalesRequestsModule } from './sales-requests/sales-requests.module';
import { ProductsModule } from './products/products.module';
import { RequestsModule } from './requests/requests.module';
import { IngestModule } from './ingest/ingest.module';

@Module({
  imports: [DbModule, HealthModule, AuthModule, OrgModule, UsersModule, PlaybooksModule, AgentsModule, CallsModule, SalesRequestsModule, ProductsModule, RequestsModule, IngestModule],
})
export class AppModule {}

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';

@Injectable()
export class OrgService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async getOrg(orgId: string) {
    const [[org], [settings]] = await Promise.all([
      this.db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).limit(1),
      this.db
        .select()
        .from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, orgId))
        .limit(1),
    ]);
    return { org, settings };
  }

  async updateSettings(orgId: string, dto: UpdateOrgSettingsDto) {
    const [updated] = await this.db
      .update(schema.orgSettings)
      .set(dto)
      .where(eq(schema.orgSettings.orgId, orgId))
      .returning();
    return updated;
  }
}

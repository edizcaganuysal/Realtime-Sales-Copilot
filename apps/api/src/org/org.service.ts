import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS } from './company-profile.defaults';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import {
  GTAPHOTOPRO_DEMO_AGENT_NAME,
  GTAPHOTOPRO_DEMO_AGENT_PROMPT,
} from '../agents/gtaphotopro-demo.agent';

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

  async getCompanyProfile(orgId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.orgCompanyProfiles)
      .where(eq(schema.orgCompanyProfiles.orgId, orgId))
      .limit(1);

    if (existing) {
      if (existing.companyName === 'SkyrocketX') {
        const [migrated] = await this.db
          .update(schema.orgCompanyProfiles)
          .set({
            ...GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS,
            updatedAt: new Date(),
          })
          .where(eq(schema.orgCompanyProfiles.orgId, orgId))
          .returning();
        await this.ensureDemoAgent(orgId);
        return migrated;
      }

      await this.ensureDemoAgent(orgId);
      return existing;
    }

    const [inserted] = await this.db
      .insert(schema.orgCompanyProfiles)
      .values({
        orgId,
        ...GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS,
      })
      .returning();

    await this.ensureDemoAgent(orgId);
    return inserted;
  }

  async updateCompanyProfile(orgId: string, dto: UpdateCompanyProfileDto) {
    const safeDto = Object.fromEntries(
      Object.entries(dto)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
    );

    const [updated] = await this.db
      .insert(schema.orgCompanyProfiles)
      .values({
        orgId,
        ...GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS,
        ...safeDto,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.orgCompanyProfiles.orgId,
        set: {
          ...safeDto,
          updatedAt: new Date(),
        },
      })
      .returning();

    await this.ensureDemoAgent(orgId);
    return updated;
  }

  private async ensureDemoAgent(orgId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.orgId, orgId),
          eq(schema.agents.scope, 'ORG'),
          eq(schema.agents.name, GTAPHOTOPRO_DEMO_AGENT_NAME),
        ),
      )
      .limit(1);

    const desiredConfig = {
      maxSuggestionTokens: 120,
      nudgesEnabled: false,
      alternativeCount: 3,
      style: 'specific-numeric',
    };

    if (!existing) {
      await this.db.insert(schema.agents).values({
        orgId,
        ownerUserId: null,
        scope: 'ORG',
        status: 'APPROVED',
        name: GTAPHOTOPRO_DEMO_AGENT_NAME,
        prompt: GTAPHOTOPRO_DEMO_AGENT_PROMPT,
        configJson: desiredConfig,
      });
      return;
    }

    await this.db
      .update(schema.agents)
      .set({
        prompt: GTAPHOTOPRO_DEMO_AGENT_PROMPT,
        status: 'APPROVED',
        configJson: desiredConfig,
      })
      .where(eq(schema.agents.id, existing.id));
  }
}

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { EMPTY_COMPANY_PROFILE_DEFAULTS } from './company-profile.defaults';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { SubscribePlanDto } from './dto/subscribe-plan.dto';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';
import {
  GTAPHOTOPRO_DEMO_AGENT_NAME,
  GTAPHOTOPRO_DEMO_AGENT_PROMPT,
} from '../agents/gtaphotopro-demo.agent';

@Injectable()
export class OrgService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listPlans() {
    return this.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.isActive, true))
      .orderBy(asc(schema.plans.monthlyCredits));
  }

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

  async getSubscription(orgId: string) {
    const [subscription] = await this.db
      .select({
        orgId: schema.orgSubscription.orgId,
        planId: schema.orgSubscription.planId,
        status: schema.orgSubscription.status,
        creditsBalance: schema.orgSubscription.creditsBalance,
        updatedAt: schema.orgSubscription.updatedAt,
        planName: schema.plans.name,
        monthlyCredits: schema.plans.monthlyCredits,
      })
      .from(schema.orgSubscription)
      .innerJoin(schema.plans, eq(schema.orgSubscription.planId, schema.plans.id))
      .where(eq(schema.orgSubscription.orgId, orgId))
      .limit(1);

    if (!subscription) return null;
    return subscription;
  }

  async subscribe(orgId: string, dto: SubscribePlanDto) {
    const planId = dto.plan_id.trim().toLowerCase();
    const [plan] = await this.db
      .select()
      .from(schema.plans)
      .where(and(eq(schema.plans.id, planId), eq(schema.plans.isActive, true)))
      .limit(1);

    if (!plan) throw new NotFoundException('Plan not found');

    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.orgSubscription)
        .where(eq(schema.orgSubscription.orgId, orgId))
        .limit(1);

      const currentBalance = existing?.creditsBalance ?? 0;
      const nextBalance = currentBalance + plan.monthlyCredits;
      const now = new Date();

      if (existing) {
        await tx
          .update(schema.orgSubscription)
          .set({
            planId: plan.id,
            status: 'active',
            creditsBalance: nextBalance,
            updatedAt: now,
          })
          .where(eq(schema.orgSubscription.orgId, orgId));
      } else {
        await tx.insert(schema.orgSubscription).values({
          orgId,
          planId: plan.id,
          status: 'active',
          creditsBalance: nextBalance,
          updatedAt: now,
        });
      }

      const [entry] = await tx
        .insert(schema.creditLedger)
        .values({
          orgId,
          type: 'SUBSCRIPTION_GRANT',
          amount: plan.monthlyCredits,
          balanceAfter: nextBalance,
          metadataJson: {
            plan_id: plan.id,
            plan_name: plan.name,
            monthly_credits: plan.monthlyCredits,
          },
        })
        .returning();

      return { balance: nextBalance, entry };
    });

    const subscription = await this.getSubscription(orgId);
    return {
      subscription,
      balance: result.balance,
      ledgerEntry: result.entry,
    };
  }

  async adjustCredits(orgId: string, dto: AdjustCreditsDto) {
    if (dto.amount === 0) {
      throw new BadRequestException('amount must be non-zero');
    }

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.orgSubscription)
        .where(eq(schema.orgSubscription.orgId, orgId))
        .limit(1);

      if (!existing) {
        throw new BadRequestException('No subscription found for this organization');
      }

      const nextBalance = existing.creditsBalance + dto.amount;

      await tx
        .update(schema.orgSubscription)
        .set({
          creditsBalance: nextBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.orgSubscription.orgId, orgId));

      const [entry] = await tx
        .insert(schema.creditLedger)
        .values({
          orgId,
          type: 'ADJUSTMENT',
          amount: dto.amount,
          balanceAfter: nextBalance,
          metadataJson: { reason },
        })
        .returning();

      return { balance: nextBalance, entry };
    });

    return result;
  }

  async getCredits(orgId: string) {
    const [[subscription], ledger] = await Promise.all([
      this.db
        .select()
        .from(schema.orgSubscription)
        .where(eq(schema.orgSubscription.orgId, orgId))
        .limit(1),
      this.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.orgId, orgId))
        .orderBy(desc(schema.creditLedger.createdAt))
        .limit(50),
    ]);

    return {
      balance: subscription?.creditsBalance ?? 0,
      subscription: subscription
        ? {
            planId: subscription.planId,
            status: subscription.status,
            updatedAt: subscription.updatedAt,
          }
        : null,
      ledger,
    };
  }

  async getCompanyProfile(orgId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.orgCompanyProfiles)
      .where(eq(schema.orgCompanyProfiles.orgId, orgId))
      .limit(1);

    if (existing) {
      await this.ensureDemoAgent(orgId);
      return existing;
    }

    const [inserted] = await this.db
      .insert(schema.orgCompanyProfiles)
      .values({
        orgId,
        ...EMPTY_COMPANY_PROFILE_DEFAULTS,
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
        ...EMPTY_COMPANY_PROFILE_DEFAULTS,
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

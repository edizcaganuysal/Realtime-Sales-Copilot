import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { SignupDto } from './dto/signup.dto';

const FREE_PLAN_ID = 'free';
const FREE_PLAN_NAME = 'Free';
const FREE_PLAN_CREDITS = 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail))
      .limit(1);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    return this.buildAuthPayload(user);
  }

  async signup(dto: SignupDto) {
    const name = dto.name.trim();
    const orgName = dto.orgName.trim();
    const email = this.normalizeEmail(dto.email);
    const password = dto.password;
    const planId = dto.planId?.trim().toLowerCase();

    if (!name) {
      throw new BadRequestException('Name is required');
    }
    if (!orgName) {
      throw new BadRequestException('Organization name is required');
    }

    const [existing] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let created: { orgId: string; user: typeof schema.users.$inferSelect };
    try {
      created = await this.db.transaction(async (tx) => {
        const [org] = await tx
          .insert(schema.orgs)
          .values({ name: orgName })
          .returning({ id: schema.orgs.id });

        await tx.insert(schema.orgSettings).values({
          orgId: org.id,
          requiresAgentApproval: true,
          allowRepAgentCreation: true,
          publisherPolicy: 'ADMIN_AND_MANAGERS',
          liveLayoutDefault: 'STANDARD',
          retentionDays: 90,
        });

        const [user] = await tx
          .insert(schema.users)
          .values({
            orgId: org.id,
            role: 'ADMIN',
            name,
            email,
            passwordHash,
            status: 'ACTIVE',
          })
          .returning();

        return { orgId: org.id, user };
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }

    await this.assignDefaultPlan(created.orgId, planId);

    return this.buildAuthPayload(created.user);
  }

  async me(userId: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException();

    const authPayload = await this.buildAuthPayload(user);
    return {
      user: authPayload.user,
      org: authPayload.org,
      orgSettings: authPayload.orgSettings,
    };
  }

  private async buildAuthPayload(user: typeof schema.users.$inferSelect) {
    const [[org], [orgSettingsRow]] = await Promise.all([
      this.db.select().from(schema.orgs).where(eq(schema.orgs.id, user.orgId)).limit(1),
      this.db
        .select()
        .from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, user.orgId))
        .limit(1),
    ]);

    if (!org) {
      throw new InternalServerErrorException('Organization record is missing');
    }

    const orgSettings = orgSettingsRow ?? (await this.createDefaultOrgSettings(user.orgId));

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        status: user.status,
        createdAt: user.createdAt,
      },
      org: { id: org.id, name: org.name, createdAt: org.createdAt },
      orgSettings: {
        orgId: orgSettings.orgId,
        requiresAgentApproval: orgSettings.requiresAgentApproval,
        allowRepAgentCreation: orgSettings.allowRepAgentCreation,
        publisherPolicy: orgSettings.publisherPolicy,
        liveLayoutDefault: orgSettings.liveLayoutDefault,
        retentionDays: orgSettings.retentionDays,
      },
    };
  }

  private async createDefaultOrgSettings(orgId: string) {
    const [inserted] = await this.db
      .insert(schema.orgSettings)
      .values({
        orgId,
        requiresAgentApproval: true,
        allowRepAgentCreation: true,
        publisherPolicy: 'ADMIN_AND_MANAGERS',
        liveLayoutDefault: 'STANDARD',
        retentionDays: 90,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) return inserted;

    const [existing] = await this.db
      .select()
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId))
      .limit(1);

    if (!existing) {
      throw new InternalServerErrorException('Organization settings are missing');
    }
    return existing;
  }

  private async assignDefaultPlan(orgId: string, requestedPlanId?: string) {
    const targetPlanId = requestedPlanId && requestedPlanId.length > 0 ? requestedPlanId : FREE_PLAN_ID;

    try {
      const [existingPlan] = await this.db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, targetPlanId))
        .limit(1);

      const plan =
        existingPlan ??
        (
          await this.db
            .insert(schema.plans)
            .values({
              id: FREE_PLAN_ID,
              name: FREE_PLAN_NAME,
              monthlyCredits: FREE_PLAN_CREDITS,
              isActive: true,
            })
            .onConflictDoUpdate({
              target: schema.plans.id,
              set: {
                name: FREE_PLAN_NAME,
                monthlyCredits: FREE_PLAN_CREDITS,
                isActive: true,
              },
            })
            .returning()
        )[0];

      if (!plan || !plan.isActive) return;

      const [existingSubscription] = await this.db
        .select()
        .from(schema.orgSubscription)
        .where(eq(schema.orgSubscription.orgId, orgId))
        .limit(1);

      if (existingSubscription) return;

      const balance = Math.max(0, plan.monthlyCredits);
      await this.db.insert(schema.orgSubscription).values({
        orgId,
        planId: plan.id,
        status: 'active',
        creditsBalance: balance,
        updatedAt: new Date(),
      });

      await this.db.insert(schema.creditLedger).values({
        orgId,
        type: 'SIGNUP_GRANT',
        amount: balance,
        balanceAfter: balance,
        metadataJson: {
          plan_id: plan.id,
          plan_name: plan.name,
        },
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === '42P01' || code === '42703') {
        return;
      }
      throw error;
    }
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
}

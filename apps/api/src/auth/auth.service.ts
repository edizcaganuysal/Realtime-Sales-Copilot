import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const [[org], [orgSettings]] = await Promise.all([
      this.db.select().from(schema.orgs).where(eq(schema.orgs.id, user.orgId)).limit(1),
      this.db
        .select()
        .from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, user.orgId))
        .limit(1),
    ]);

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

  async me(userId: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException();

    const [[org], [orgSettings]] = await Promise.all([
      this.db.select().from(schema.orgs).where(eq(schema.orgs.id, user.orgId)).limit(1),
      this.db
        .select()
        .from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, user.orgId))
        .limit(1),
    ]);

    return {
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
}

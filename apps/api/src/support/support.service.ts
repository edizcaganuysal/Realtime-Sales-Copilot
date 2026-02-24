import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { and, desc, asc, eq } from 'drizzle-orm';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly creditsService: CreditsService,
  ) {}

  async createSession(user: JwtPayload, dto: CreateSessionDto) {
    await this.creditsService.requireAvailable(user.orgId, 1);

    const [session] = await this.db
      .insert(schema.supportSessions)
      .values({
        orgId: user.orgId,
        userId: user.sub,
        agentId: dto.agentId ?? null,
        callId: dto.callId ?? null,
        notes: dto.notes ?? '',
      })
      .returning();

    return session;
  }

  async listSessions(user: JwtPayload) {
    return this.db
      .select()
      .from(schema.supportSessions)
      .where(eq(schema.supportSessions.orgId, user.orgId))
      .orderBy(desc(schema.supportSessions.createdAt));
  }

  async getSession(user: JwtPayload, id: string) {
    const [session] = await this.db
      .select()
      .from(schema.supportSessions)
      .where(and(eq(schema.supportSessions.id, id), eq(schema.supportSessions.orgId, user.orgId)))
      .limit(1);
    if (!session) throw new NotFoundException('Support session not found');

    const suggestions = await this.db
      .select()
      .from(schema.supportSuggestions)
      .where(eq(schema.supportSuggestions.sessionId, id))
      .orderBy(desc(schema.supportSuggestions.tsMs));

    return { ...session, suggestions };
  }

  async updateSession(
    user: JwtPayload,
    id: string,
    patch: { notes?: string; issueCategory?: string },
  ) {
    const [session] = await this.db
      .select()
      .from(schema.supportSessions)
      .where(and(eq(schema.supportSessions.id, id), eq(schema.supportSessions.orgId, user.orgId)))
      .limit(1);
    if (!session) throw new NotFoundException('Support session not found');
    if (session.userId !== user.sub) throw new ForbiddenException();

    const updates: Partial<typeof schema.supportSessions.$inferInsert> = {};
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.issueCategory !== undefined) updates.issueCategory = patch.issueCategory;

    const [updated] = await this.db
      .update(schema.supportSessions)
      .set(updates)
      .where(eq(schema.supportSessions.id, id))
      .returning();

    return updated;
  }

  async endSession(user: JwtPayload, id: string) {
    const [session] = await this.db
      .select()
      .from(schema.supportSessions)
      .where(and(eq(schema.supportSessions.id, id), eq(schema.supportSessions.orgId, user.orgId)))
      .limit(1);
    if (!session) throw new NotFoundException('Support session not found');
    if (session.userId !== user.sub) throw new ForbiddenException();
    if (session.resolvedAt) return session;

    const [updated] = await this.db
      .update(schema.supportSessions)
      .set({ status: 'RESOLVED', resolvedAt: new Date() })
      .where(eq(schema.supportSessions.id, id))
      .returning();

    return updated;
  }

  async getTranscript(user: JwtPayload, sessionId: string) {
    const [session] = await this.db
      .select()
      .from(schema.supportSessions)
      .where(
        and(
          eq(schema.supportSessions.id, sessionId),
          eq(schema.supportSessions.orgId, user.orgId),
        ),
      )
      .limit(1);
    if (!session) throw new NotFoundException('Support session not found');

    return this.db
      .select()
      .from(schema.supportTranscript)
      .where(
        and(
          eq(schema.supportTranscript.sessionId, sessionId),
          eq(schema.supportTranscript.isFinal, true),
        ),
      )
      .orderBy(asc(schema.supportTranscript.tsMs));
  }

  async getSupportContext(orgId: string) {
    const [ctx] = await this.db
      .select()
      .from(schema.supportContext)
      .where(eq(schema.supportContext.orgId, orgId))
      .limit(1);
    return ctx ?? null;
  }

  async upsertSupportContext(
    orgId: string,
    data: Partial<typeof schema.supportContext.$inferInsert>,
  ) {
    const existing = await this.getSupportContext(orgId);
    if (existing) {
      const [updated] = await this.db
        .update(schema.supportContext)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.supportContext.orgId, orgId))
        .returning();
      return updated;
    }
    const [created] = await this.db
      .insert(schema.supportContext)
      .values({ orgId, ...data })
      .returning();
    return created;
  }
}

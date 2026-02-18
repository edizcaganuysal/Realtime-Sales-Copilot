import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { GuidanceLevel, LiveLayout } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';

@Injectable()
export class CallsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  private async getOrgSettings(orgId: string) {
    const [settings] = await this.db
      .select()
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId))
      .limit(1);
    return settings;
  }

  async create(user: JwtPayload, dto: CreateCallDto) {
    const orgSettings = await this.getOrgSettings(user.orgId);
    const layoutPreset = dto.layoutPreset ?? (orgSettings.liveLayoutDefault as LiveLayout);
    const guidanceLevel = dto.guidanceLevel ?? GuidanceLevel.STANDARD;

    const [call] = await this.db
      .insert(schema.calls)
      .values({
        orgId: user.orgId,
        userId: user.sub,
        agentId: dto.agentId ?? null,
        playbookId: dto.playbookId ?? null,
        guidanceLevel,
        layoutPreset,
        phoneTo: dto.phoneTo,
        notes: dto.notes ?? null,
        // When Twilio is configured, the call starts as INITIATED and transitions
        // to IN_PROGRESS via the status webhook. Without Twilio it's immediately active.
        status: 'INITIATED',
        startedAt: new Date(),
      })
      .returning();

    return call;
  }

  async list(user: JwtPayload) {
    return this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.orgId, user.orgId), eq(schema.calls.userId, user.sub)))
      .orderBy(desc(schema.calls.startedAt));
  }

  async get(user: JwtPayload, id: string) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);

    if (!call) throw new NotFoundException('Call not found');

    const suggestions = await this.db
      .select()
      .from(schema.callSuggestions)
      .where(eq(schema.callSuggestions.callId, id))
      .orderBy(desc(schema.callSuggestions.tsMs));

    return { ...call, suggestions };
  }

  async update(user: JwtPayload, id: string, dto: UpdateCallDto) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);

    if (!call) throw new NotFoundException('Call not found');
    if (call.userId !== user.sub) throw new ForbiddenException();

    const [updated] = await this.db
      .update(schema.calls)
      .set({ notes: dto.notes })
      .where(eq(schema.calls.id, id))
      .returning();

    return updated;
  }

  async end(user: JwtPayload, id: string) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);

    if (!call) throw new NotFoundException('Call not found');
    if (call.userId !== user.sub) throw new ForbiddenException();

    const [updated] = await this.db
      .update(schema.calls)
      .set({ status: 'COMPLETED', endedAt: new Date() })
      .where(eq(schema.calls.id, id))
      .returning();

    return updated;
  }

  // ── Twilio helpers ────────────────────────────────────────────────────────

  async setTwilioSid(callId: string, callSid: string) {
    await this.db
      .update(schema.calls)
      .set({ twilioCallSid: callSid })
      .where(eq(schema.calls.id, callId));
  }

  /**
   * Called by the Twilio status webhook. Returns the updated call (if found).
   */
  async updateStatusBySid(
    callSid: string,
    status: string,
    extra: { startedAt?: Date; endedAt?: Date } = {},
  ) {
    const [updated] = await this.db
      .update(schema.calls)
      .set({ status, ...extra })
      .where(eq(schema.calls.twilioCallSid, callSid))
      .returning();
    return updated ?? null;
  }

  async setStatusImmediate(callId: string, status: string) {
    await this.db
      .update(schema.calls)
      .set({ status })
      .where(eq(schema.calls.id, callId));
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { and, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CallMode } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsService } from './calls.service';
import { EngineService } from './engine.service';
import { TwilioService } from './twilio.service';
import { SttService } from './stt.service';
import { CallsGateway } from './calls.gateway';
import { MockCallService } from './mock-call.service';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';
import { PromptDebugDto } from './dto/prompt-debug.dto';

// Twilio CallStatus values → internal status
const TWILIO_STATUS: Record<string, string> = {
  initiated: 'INITIATED',
  ringing: 'INITIATED',
  answered: 'IN_PROGRESS',
  'in-progress': 'IN_PROGRESS',
  completed: 'COMPLETED',
  busy: 'FAILED',
  failed: 'FAILED',
  'no-answer': 'FAILED',
  canceled: 'FAILED',
};

// ── Authenticated controller ──────────────────────────────────────────────────

@Controller('calls')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.REP)
export class CallsController {
  private readonly logger = new Logger(CallsController.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly engineService: EngineService,
    private readonly twilioService: TwilioService,
    private readonly mockCallService: MockCallService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  @Get('practice-personas')
  async getPracticePersonas(@CurrentUser() user: JwtPayload) {
    const builtIn = this.mockCallService.getAvailablePersonas();

    const customRows = await this.db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.orgId, user.orgId),
          eq(schema.agents.status, 'APPROVED'),
        ),
      );

    const custom = customRows
      .filter((r) => {
        const cfg = r.configJson as Record<string, unknown> | null;
        return cfg?.type === 'practice_persona';
      })
      .map((r) => {
        const cfg = (r.configJson ?? {}) as Record<string, unknown>;
        return {
          id: `custom:${r.id}`,
          name: r.name,
          title: (cfg.title as string) || 'Custom Prospect',
          description: (cfg.description as string) || '',
          difficulty: (cfg.difficulty as string) || 'Medium',
          color: (cfg.color as string) || 'slate',
          isCustom: true,
        };
      });

    return [...builtIn, ...custom];
  }

  @Post('practice-personas')
  async createPracticePersona(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; title?: string; description?: string; difficulty?: string; prompt: string },
  ) {
    const [row] = await this.db
      .insert(schema.agents)
      .values({
        orgId: user.orgId,
        ownerUserId: user.sub,
        scope: 'PERSONAL',
        status: 'APPROVED',
        name: body.name || 'Custom Prospect',
        prompt: body.prompt,
        configJson: {
          type: 'practice_persona',
          title: body.title || 'Custom Prospect',
          description: body.description || '',
          difficulty: body.difficulty || 'Medium',
          color: 'slate',
        },
      })
      .returning();

    return {
      id: `custom:${row.id}`,
      name: row.name,
      title: body.title || 'Custom Prospect',
      description: body.description || '',
      difficulty: body.difficulty || 'Medium',
      color: 'slate',
      isCustom: true,
    };
  }

  @Patch('practice-personas/:id')
  async updatePracticePersona(
    @CurrentUser() user: JwtPayload,
    @Param('id') rawId: string,
    @Body() body: { name?: string; title?: string; description?: string; difficulty?: string; prompt?: string },
  ) {
    const agentId = rawId.replace(/^custom:/, '');
    const [existing] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!existing) return { error: 'Not found' };

    const oldCfg = (existing.configJson ?? {}) as Record<string, unknown>;
    const newCfg = {
      ...oldCfg,
      type: 'practice_persona',
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
    };

    const [updated] = await this.db
      .update(schema.agents)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
        configJson: newCfg,
      })
      .where(eq(schema.agents.id, agentId))
      .returning();

    return {
      id: `custom:${updated.id}`,
      name: updated.name,
      title: (newCfg.title as string) || 'Custom Prospect',
      description: (newCfg.description as string) || '',
      difficulty: (newCfg.difficulty as string) || 'Medium',
      color: 'slate',
      isCustom: true,
    };
  }

  @Delete('practice-personas/:id')
  @HttpCode(200)
  async deletePracticePersona(
    @CurrentUser() user: JwtPayload,
    @Param('id') rawId: string,
  ) {
    const agentId = rawId.replace(/^custom:/, '');
    await this.db
      .delete(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)));
    return { ok: true };
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCallDto) {
    const call = await this.callsService.create(user, dto);

    if (dto.mode === CallMode.MOCK) {
      // Mock call — browser will connect to /mock-stream WS, engine starts immediately
      this.logger.log(`Call ${call.id} created in MOCK mode — waiting for browser WS`);
      await this.callsService.setStatusImmediate(call.id, 'IN_PROGRESS');
      this.engineService.start(call.id, false); // no stub transcript — OpenAI provides real transcript
      return call;
    }

    if (this.twilioService.available) {
      // Real call — engine starts only after Twilio confirms "answered" via webhook
      try {
        const callSid = await this.twilioService.initiateCall(call.id, dto.phoneTo);
        await this.callsService.setTwilioSid(call.id, callSid);
        this.logger.log(`Call ${call.id} created with Twilio SID ${callSid} — waiting for answer`);
      } catch (err) {
        this.logger.error(`Twilio initiation failed: ${(err as Error).message}`);
        // Fall back to stub mode if Twilio fails
        await this.callsService.setStatusImmediate(call.id, 'IN_PROGRESS');
        this.engineService.start(call.id, true);
      }
    } else {
      // Stub / dev mode — fake transcript + suggestions
      this.logger.log(`Call ${call.id} created in stub mode`);
      await this.callsService.setStatusImmediate(call.id, 'IN_PROGRESS');
      this.engineService.start(call.id, true);
    }

    return call;
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.callsService.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.callsService.get(user, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCallDto,
  ) {
    const updated = await this.callsService.update(user, id, dto);
    if (
      dto.notes !== undefined ||
      dto.products_mode !== undefined ||
      dto.selected_product_ids !== undefined
    ) {
      void this.engineService.refreshContext(id).catch((err: Error) =>
        this.logger.error(`Engine context refresh failed for ${id}: ${err.message}`),
      );
    }
    return updated;
  }

  @Get(':id/transcript')
  transcript(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.callsService.getTranscript(user, id);
  }

  @Get(':id/summary')
  summary(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.callsService.getSummary(user, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    this.engineService.stop(id);
    const call = await this.callsService.end(user, id);
    // Fire post-call analysis async — do not await, do not block the response
    void this.engineService
      .runPostCall(call.id, call.notes ?? null, call.playbookId ?? null)
      .catch((err: Error) =>
        this.logger.error(`Post-call analysis failed for ${call.id}: ${err.message}`),
      );
    return call;
  }

  @Post(':id/session-start')
  @HttpCode(200)
  async sessionStart(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const call = await this.callsService.get(user, id);
    if (call.status === 'IN_PROGRESS' || call.mode === CallMode.MOCK) {
      const shouldUseStub = call.mode !== CallMode.MOCK && !this.twilioService.available;
      this.engineService.start(id, shouldUseStub);
    }
    this.engineService.emitSessionStart(id);
    return { ok: true };
  }

  @Post(':id/suggestions/more')
  @HttpCode(200)
  async moreSuggestions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { mode?: 'SWAP' | 'MORE_OPTIONS'; count?: number },
  ) {
    await this.callsService.get(user, id);
    return this.engineService.getAlternatives(id, {
      mode: body?.mode,
      count: body?.count,
    });
  }

  @Post('prompt-debug')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  promptDebug(@CurrentUser() user: JwtPayload, @Body() dto: PromptDebugDto) {
    return this.engineService.promptDebug(user.orgId, dto);
  }
}

// ── Public Twilio webhook controller (no auth — Twilio calls these directly) ──

@Controller('calls')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly engineService: EngineService,
    private readonly sttService: SttService,
    private readonly gateway: CallsGateway,
  ) {}

  /**
   * Twilio fetches this TwiML when the outbound call is answered.
   * Returns a <Stream> verb pointing to our /media-stream WebSocket.
   */
  @Get('twiml')
  @Header('Content-Type', 'text/xml')
  twiml(@Query('callId') callId: string) {
    const base = (process.env['TWILIO_WEBHOOK_BASE_URL'] ?? '').replace(/\/$/, '');
    // Convert http(s):// → ws(s)://
    const wsBase = base.replace(/^https/, 'wss').replace(/^http(?!s)/, 'ws');
    const streamUrl = `${wsBase}/media-stream`;

    this.logger.log(`TwiML requested — callId: ${callId}, streamUrl: ${streamUrl}`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" track="inbound_track">
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Connect>
</Response>`;
  }

  /**
   * Twilio posts call status updates here (form-encoded body).
   */
  @Post('webhook/status')
  @HttpCode(204)
  async statusWebhook(@Body() body: Record<string, string>) {
    const callSid = body['CallSid'] ?? '';
    const twilioStatus = (body['CallStatus'] ?? '').toLowerCase();

    this.logger.log(`Status webhook received: CallSid=${callSid} CallStatus=${twilioStatus}`);

    if (!callSid || !twilioStatus) {
      this.logger.warn('Status webhook missing CallSid or CallStatus — ignoring');
      return;
    }

    const newStatus = TWILIO_STATUS[twilioStatus];
    if (!newStatus) {
      this.logger.warn(`Unknown Twilio status "${twilioStatus}" — ignoring`);
      return;
    }

    const extra: { startedAt?: Date; endedAt?: Date } = {};
    if (newStatus === 'IN_PROGRESS') extra.startedAt = new Date();
    if (newStatus === 'COMPLETED' || newStatus === 'FAILED') extra.endedAt = new Date();

    const call = await this.callsService.updateStatusBySid(callSid, newStatus, extra);

    if (call) {
      // Notify the live UI of the new call status
      this.gateway.emitToCall(call.id, 'call.status', { status: newStatus, startedAt: extra.startedAt ?? null });
      this.logger.log(`Emitted call.status=${newStatus} to room ${call.id}`);

      if (newStatus === 'IN_PROGRESS') {
        // Call is now answered — start the engine (no stub transcript, Deepgram handles it)
        const stubTranscript = !this.sttService.available;
        this.logger.log(
          `Call ${call.id} answered — starting engine (stubTranscript=${stubTranscript})`,
        );
        this.engineService.start(call.id, stubTranscript);
      }

      if (newStatus === 'COMPLETED' || newStatus === 'FAILED') {
        this.logger.log(`Call ${call.id} ended (${newStatus}) — stopping engine`);
        this.engineService.stop(call.id);
      }
    } else {
      this.logger.warn(`No call found for Twilio SID ${callSid}`);
    }

    this.logger.log(`Status webhook: ${callSid} → ${twilioStatus} (→ ${newStatus})`);
  }
}

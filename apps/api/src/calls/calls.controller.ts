import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CallsService } from './calls.service';
import { EngineService } from './engine.service';
import { TwilioService } from './twilio.service';
import { SttService } from './stt.service';
import { CallsGateway } from './calls.gateway';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';

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
  ) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCallDto) {
    const call = await this.callsService.create(user, dto);

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
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCallDto,
  ) {
    return this.callsService.update(user, id, dto);
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    this.engineService.stop(id);
    return this.callsService.end(user, id);
  }

  @Post(':id/suggestions/more')
  @HttpCode(200)
  moreSuggestions(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.callsService.moreSuggestions(user, id);
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
    const streamUrl = `${wsBase}/media-stream?callId=${callId}`;

    this.logger.log(`TwiML requested — callId: ${callId}, streamUrl: ${streamUrl}`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" track="inbound_track" />
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

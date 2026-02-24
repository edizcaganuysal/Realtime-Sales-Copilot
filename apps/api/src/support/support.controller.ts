import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '@live-sales-coach/shared';
import { SupportService } from './support.service';
import { SupportEngineService } from './support-engine.service';
import { ActionRunnerService } from './action-runner.service';
import { CreateSessionDto } from './dto/create-session.dto';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly engineService: SupportEngineService,
    private readonly actionRunner: ActionRunnerService,
  ) {}

  /* ── Sessions ─────────────────────────────────────────────────────────── */

  @Post('sessions')
  createSession(@CurrentUser() user: JwtPayload, @Body() dto: CreateSessionDto) {
    return this.supportService.createSession(user, dto);
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: JwtPayload) {
    return this.supportService.listSessions(user);
  }

  @Get('sessions/:id')
  getSession(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.supportService.getSession(user, id);
  }

  @Patch('sessions/:id')
  updateSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { notes?: string; issueCategory?: string },
  ) {
    return this.supportService.updateSession(user, id, body);
  }

  @Post('sessions/:id/end')
  endSession(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.supportService.endSession(user, id);
  }

  @Post('sessions/:id/session-start')
  sessionStart(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    this.engineService.emitSessionStart(id);
    return { ok: true };
  }

  @Get('sessions/:id/transcript')
  getTranscript(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.supportService.getTranscript(user, id);
  }

  /* ── Actions ──────────────────────────────────────────────────────────── */

  @Post('actions/:id/approve')
  approveAction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.actionRunner.approveAction(id, user.sub);
  }

  @Post('actions/:id/reject')
  rejectAction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.actionRunner.rejectAction(id, user.sub);
  }

  /* ── Support Context ──────────────────────────────────────────────────── */

  @Get('context')
  getSupportContext(@CurrentUser() user: JwtPayload) {
    return this.supportService.getSupportContext(user.orgId);
  }

  @Patch('context')
  upsertSupportContext(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.supportService.upsertSupportContext(user.orgId, body);
  }
}

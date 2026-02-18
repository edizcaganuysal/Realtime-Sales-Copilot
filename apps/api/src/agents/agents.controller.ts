import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AgentScope, AgentStatus, Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Controller('agents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.REP)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('scope') scope?: AgentScope,
    @Query('status') status?: AgentStatus,
  ) {
    return this.agentsService.list(user, scope, status);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAgentDto) {
    return this.agentsService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agentsService.update(user, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agentsService.submit(user, id);
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER)
  @HttpCode(200)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agentsService.approve(user, id);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER)
  @HttpCode(200)
  reject(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agentsService.reject(user, id);
  }
}

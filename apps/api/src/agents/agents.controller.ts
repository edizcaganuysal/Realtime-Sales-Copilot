import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
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
  list(@CurrentUser() user: JwtPayload) {
    return this.agentsService.list(user);
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

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agentsService.remove(user, id);
  }

  @Post('generate-strategy')
  generateStrategyForOrg(@CurrentUser() user: JwtPayload) {
    return this.agentsService.generateStrategyForOrg(user);
  }

  @Post(':id/draft-openers')
  draftOpeners(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agentsService.draftOpeners(user, id);
  }

  @Post(':id/generate-strategy')
  generateStrategy(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.agentsService.generateStrategy(user, id);
  }
}

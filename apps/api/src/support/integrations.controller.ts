import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '@live-sales-coach/shared';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/create-integration.dto';
import {
  CreateActionDefinitionDto,
  UpdateActionDefinitionDto,
} from './dto/create-action-definition.dto';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  /* ── Integrations ─────────────────────────────────────────────────────── */

  @Get('integrations')
  listIntegrations(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.listIntegrations(user.orgId);
  }

  @Post('integrations')
  createIntegration(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateIntegrationDto,
  ) {
    return this.integrationsService.createIntegration(user.orgId, dto);
  }

  @Patch('integrations/:id')
  updateIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.integrationsService.updateIntegration(user.orgId, id, dto);
  }

  @Delete('integrations/:id')
  deleteIntegration(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.deleteIntegration(user.orgId, id);
  }

  /* ── Action Definitions ───────────────────────────────────────────────── */

  @Get('action-definitions')
  listActionDefinitions(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.listActionDefinitions(user.orgId);
  }

  @Post('action-definitions')
  createActionDefinition(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateActionDefinitionDto,
  ) {
    return this.integrationsService.createActionDefinition(user.orgId, dto);
  }

  @Patch('action-definitions/:id')
  updateActionDefinition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateActionDefinitionDto,
  ) {
    return this.integrationsService.updateActionDefinition(user.orgId, id, dto);
  }

  @Delete('action-definitions/:id')
  deleteActionDefinition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.integrationsService.deleteActionDefinition(user.orgId, id);
  }
}

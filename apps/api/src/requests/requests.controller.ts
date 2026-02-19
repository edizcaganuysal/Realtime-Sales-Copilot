import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestsService } from './requests.service';
import { CreateCustomAgentRequestDto } from './dto/create-custom-agent-request.dto';
import { CreateFineTuneRequestDto } from './dto/create-fine-tune-request.dto';

@Controller('requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post('custom-agent')
  createCustomAgentRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCustomAgentRequestDto,
  ) {
    return this.requestsService.createCustomAgentRequest(user, dto);
  }

  @Post('fine-tune')
  createFineTuneRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFineTuneRequestDto,
  ) {
    return this.requestsService.createFineTuneRequest(user, dto);
  }
}

@Controller('admin/requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER)
export class AdminRequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  listRequests(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.requestsService.listAdminRequests(user.orgId, status);
  }
}

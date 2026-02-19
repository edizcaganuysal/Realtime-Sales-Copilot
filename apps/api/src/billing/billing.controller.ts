import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { BillingService } from './billing.service';
import { CreateCreditRequestDto } from './dto/create-credit-request.dto';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('credits/request')
  @Roles(Role.ADMIN)
  createCreditRequest(@CurrentUser() user: JwtPayload, @Body() dto: CreateCreditRequestDto) {
    return this.billingService.createCreditRequest(user.orgId, user.sub, dto);
  }

  @Get('credits/requests')
  @Roles(Role.MANAGER)
  listCreditRequests(@CurrentUser() user: JwtPayload) {
    return this.billingService.listCreditRequests(user.orgId);
  }

  @Post('credits/requests/:id/approve')
  @Roles(Role.ADMIN)
  approveCreditRequest(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.billingService.approveCreditRequest(user.orgId, id);
  }
}

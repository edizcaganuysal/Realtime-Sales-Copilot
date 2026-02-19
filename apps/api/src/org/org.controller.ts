import { Body, Controller, Get, NotFoundException, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '@live-sales-coach/shared';
import { OrgService } from './org.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { UpdateSalesContextDto } from './dto/update-sales-context.dto';
import { SubscribePlanDto } from './dto/subscribe-plan.dto';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';

@Controller('org')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Get()
  @Roles(Role.MANAGER)
  getOrg(@CurrentUser() user: JwtPayload) {
    return this.orgService.getOrg(user.orgId);
  }

  @Patch('settings')
  @Roles(Role.MANAGER)
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateOrgSettingsDto) {
    return this.orgService.updateSettings(user.orgId, dto);
  }

  @Get('company-profile')
  @Roles(Role.REP)
  getCompanyProfile(@CurrentUser() user: JwtPayload) {
    return this.orgService.getCompanyProfile(user.orgId);
  }

  @Patch('company-profile')
  @Roles(Role.MANAGER)
  updateCompanyProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateCompanyProfileDto) {
    return this.orgService.updateCompanyProfile(user.orgId, dto);
  }

  @Get('sales-context')
  @Roles(Role.REP)
  getSalesContext(@CurrentUser() user: JwtPayload) {
    return this.orgService.getSalesContext(user.orgId);
  }

  @Patch('sales-context')
  @Roles(Role.MANAGER)
  updateSalesContext(@CurrentUser() user: JwtPayload, @Body() dto: UpdateSalesContextDto) {
    return this.orgService.updateSalesContext(user.orgId, dto);
  }

  @Get('subscription')
  @Roles(Role.REP)
  async getSubscription(@CurrentUser() user: JwtPayload) {
    const subscription = await this.orgService.getSubscription(user.orgId);
    if (!subscription) throw new NotFoundException('Subscription not found');
    return subscription;
  }

  @Post('subscribe')
  @Roles(Role.ADMIN)
  subscribe(@CurrentUser() user: JwtPayload, @Body() dto: SubscribePlanDto) {
    return this.orgService.subscribe(user.orgId, dto);
  }

  @Post('credits/adjust')
  @Roles(Role.ADMIN)
  adjustCredits(@CurrentUser() user: JwtPayload, @Body() dto: AdjustCreditsDto) {
    return this.orgService.adjustCredits(user.orgId, dto);
  }

  @Get('credits')
  @Roles(Role.REP)
  getCredits(@CurrentUser() user: JwtPayload) {
    return this.orgService.getCredits(user.orgId);
  }
}

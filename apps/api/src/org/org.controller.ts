import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@live-sales-coach/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '@live-sales-coach/shared';
import { OrgService } from './org.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

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
}

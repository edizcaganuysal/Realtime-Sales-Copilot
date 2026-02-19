import { Controller, Get } from '@nestjs/common';
import { OrgService } from './org.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly orgService: OrgService) {}

  @Get()
  listPlans() {
    return this.orgService.listPlans();
  }
}

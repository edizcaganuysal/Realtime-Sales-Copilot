import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { PlansController } from './plans.controller';

@Module({
  controllers: [OrgController, PlansController],
  providers: [OrgService],
})
export class OrgModule {}

import { Module } from '@nestjs/common';
import { RequestsController, AdminRequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  controllers: [RequestsController, AdminRequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}

import { Module } from '@nestjs/common';
import { SalesRequestsController } from './sales-requests.controller';

@Module({
  controllers: [SalesRequestsController],
})
export class SalesRequestsModule {}

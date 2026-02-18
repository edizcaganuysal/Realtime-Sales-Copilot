import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsGateway } from './calls.gateway';
import { EngineService } from './engine.service';

@Module({
  controllers: [CallsController],
  providers: [CallsService, CallsGateway, EngineService],
})
export class CallsModule {}

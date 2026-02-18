import { Module } from '@nestjs/common';
import { CallsController, TwilioWebhookController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsGateway } from './calls.gateway';
import { EngineService } from './engine.service';
import { TwilioService } from './twilio.service';
import { SttService } from './stt.service';
import { MediaStreamService } from './media-stream.service';

@Module({
  controllers: [TwilioWebhookController, CallsController],
  providers: [CallsService, CallsGateway, EngineService, TwilioService, SttService, MediaStreamService],
})
export class CallsModule {}

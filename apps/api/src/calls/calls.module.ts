import { Module } from '@nestjs/common';
import { CallsController, TwilioWebhookController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsGateway } from './calls.gateway';
import { EngineService } from './engine.service';
import { TwilioService } from './twilio.service';
import { SttService } from './stt.service';
import { LlmService } from './llm.service';
import { MediaStreamService } from './media-stream.service';
import { MockCallService } from './mock-call.service';
import { AiCallService } from './ai-call.service';
import { CreditsModule } from '../credits/credits.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [CreditsModule, SupportModule],
  controllers: [TwilioWebhookController, CallsController],
  providers: [
    CallsService,
    CallsGateway,
    EngineService,
    TwilioService,
    SttService,
    LlmService,
    MediaStreamService,
    MockCallService,
    AiCallService,
  ],
})
export class CallsModule {}

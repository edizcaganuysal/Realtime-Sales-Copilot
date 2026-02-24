import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import { SupportEngineService } from './support-engine.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ActionRunnerService } from './action-runner.service';
import { LlmService } from '../calls/llm.service';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [CreditsModule],
  controllers: [SupportController, IntegrationsController],
  providers: [
    SupportService,
    SupportGateway,
    SupportEngineService,
    IntegrationsService,
    ActionRunnerService,
    LlmService,
  ],
  exports: [SupportEngineService, SupportGateway],
})
export class SupportModule {}

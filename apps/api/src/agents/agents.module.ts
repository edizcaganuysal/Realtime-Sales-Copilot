import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { LlmService } from '../calls/llm.service';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [CreditsModule],
  controllers: [AgentsController],
  providers: [AgentsService, LlmService],
})
export class AgentsModule {}

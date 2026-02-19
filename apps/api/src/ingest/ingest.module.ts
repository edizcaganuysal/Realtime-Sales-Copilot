import { Module } from '@nestjs/common';
import { AiFieldsController, IngestController, QualityController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [CreditsModule],
  controllers: [IngestController, QualityController, AiFieldsController],
  providers: [IngestService],
})
export class IngestModule {}

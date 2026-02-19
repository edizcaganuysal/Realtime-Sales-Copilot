import { Module } from '@nestjs/common';
import { AiFieldsController, IngestController, QualityController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  controllers: [IngestController, QualityController, AiFieldsController],
  providers: [IngestService],
})
export class IngestModule {}

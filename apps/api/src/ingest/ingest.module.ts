import { Module } from '@nestjs/common';
import { IngestController, QualityController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  controllers: [IngestController, QualityController],
  providers: [IngestService],
})
export class IngestModule {}

import { Module } from '@nestjs/common';
import { AiFieldsController, IngestController, QualityController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { CreditsModule } from '../credits/credits.module';
import { EmbeddingModule } from '../embeddings/embedding.module';

@Module({
  imports: [CreditsModule, EmbeddingModule],
  controllers: [IngestController, QualityController, AiFieldsController],
  providers: [IngestService],
})
export class IngestModule {}

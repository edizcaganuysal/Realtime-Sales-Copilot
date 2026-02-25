import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { PlansController } from './plans.controller';
import { EmbeddingModule } from '../embeddings/embedding.module';

@Module({
  imports: [EmbeddingModule],
  controllers: [OrgController, PlansController],
  providers: [OrgService],
})
export class OrgModule {}

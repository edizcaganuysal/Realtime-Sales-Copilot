import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { EmbeddingModule } from '../embeddings/embedding.module';

@Module({
  imports: [EmbeddingModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}

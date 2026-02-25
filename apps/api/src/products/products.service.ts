import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { EmbeddingService } from '../embeddings/embedding.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Optional() private readonly embeddingService?: EmbeddingService,
  ) {}

  private toStringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
      .slice(0, 50);
  }

  private toJsonArray(input: unknown): unknown[] {
    if (!Array.isArray(input)) return [];
    return input.slice(0, 50);
  }

  private toJsonObject(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return input as Record<string, unknown>;
  }

  private normalizeCreate(
    dto: CreateProductDto,
  ): Omit<typeof schema.products.$inferInsert, 'orgId'> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const valueProps = this.toStringArray(dto.value_props ?? []);
    if (valueProps.length < 3) {
      throw new BadRequestException('value_props must include at least 3 items');
    }

    return {
      name,
      elevatorPitch: dto.elevator_pitch?.trim() || null,
      valueProps,
      differentiators: this.toStringArray(dto.differentiators ?? []),
      pricingRules: this.toJsonObject(dto.pricing_rules ?? {}),
      dontSay: this.toStringArray(dto.dont_say ?? []),
      faqs: this.toJsonArray(dto.faqs ?? []),
      objections: this.toJsonArray(dto.objections ?? []),
    };
  }

  private normalizeUpdate(dto: UpdateProductDto): Partial<typeof schema.products.$inferInsert> {
    const patch: Partial<typeof schema.products.$inferInsert> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      patch.name = name;
    }

    if (dto.elevator_pitch !== undefined) {
      const trimmed = dto.elevator_pitch?.trim();
      patch.elevatorPitch = trimmed && trimmed.length > 0 ? trimmed : null;
    }

    if (dto.value_props !== undefined) {
      const valueProps = this.toStringArray(dto.value_props);
      if (valueProps.length < 3) {
        throw new BadRequestException('value_props must include at least 3 items');
      }
      patch.valueProps = valueProps;
    }

    if (dto.differentiators !== undefined) {
      patch.differentiators = this.toStringArray(dto.differentiators);
    }

    if (dto.pricing_rules !== undefined) {
      patch.pricingRules = this.toJsonObject(dto.pricing_rules);
    }

    if (dto.dont_say !== undefined) {
      patch.dontSay = this.toStringArray(dto.dont_say);
    }

    if (dto.faqs !== undefined) {
      patch.faqs = this.toJsonArray(dto.faqs);
    }

    if (dto.objections !== undefined) {
      patch.objections = this.toJsonArray(dto.objections);
    }

    return patch;
  }

  list(orgId: string) {
    return this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.orgId, orgId))
      .orderBy(asc(schema.products.name));
  }

  async create(orgId: string, dto: CreateProductDto) {
    const normalized = this.normalizeCreate(dto);
    const [created] = await this.db
      .insert(schema.products)
      .values({
        ...normalized,
        orgId,
      })
      .returning();

    this.triggerEmbeddingRebuild(orgId);
    return created;
  }

  async update(orgId: string, id: string, dto: UpdateProductDto) {
    const [existing] = await this.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId)))
      .limit(1);

    if (!existing) throw new NotFoundException('Product not found');

    const patch = this.normalizeUpdate(dto);
    if (Object.keys(patch).length === 0) {
      const [current] = await this.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, id))
        .limit(1);
      return current;
    }

    const [updated] = await this.db
      .update(schema.products)
      .set(patch)
      .where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId)))
      .returning();

    this.triggerEmbeddingRebuild(orgId);
    return updated;
  }

  async remove(orgId: string, id: string) {
    const [deleted] = await this.db
      .delete(schema.products)
      .where(and(eq(schema.products.id, id), eq(schema.products.orgId, orgId)))
      .returning({ id: schema.products.id });

    if (!deleted) throw new NotFoundException('Product not found');
    this.triggerEmbeddingRebuild(orgId);
    return { id: deleted.id };
  }

  private triggerEmbeddingRebuild(orgId: string) {
    if (this.embeddingService) {
      void this.embeddingService.rebuildOrgEmbeddings(orgId).catch((err) => {
        this.logger.warn(`Embedding rebuild failed for org ${orgId}: ${(err as Error).message}`);
      });
    }
  }
}

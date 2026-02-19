import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { GuidanceLevel, LiveLayout, ProductsMode } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

@Injectable()
export class CallsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  private async getOrgSettings(orgId: string) {
    const [settings] = await this.db
      .select()
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId))
      .limit(1);
    return settings;
  }

  private normalizeSelectedProductIds(ids?: string[]) {
    if (!ids || ids.length === 0) return [];
    return [...new Set(ids.filter((id) => id && id.length > 0))];
  }

  private async getValidOrgProductIds(
    orgId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.orgId, orgId), inArray(schema.products.id, ids)));
    return rows.map((row) => row.id);
  }

  private async syncCallProducts(
    tx: Tx,
    orgId: string,
    callId: string,
    productsMode: ProductsMode,
    selectedProductIds: string[],
  ) {
    await tx.delete(schema.callProducts).where(eq(schema.callProducts.callId, callId));

    if (productsMode !== ProductsMode.SELECTED) return;
    if (selectedProductIds.length === 0) {
      throw new BadRequestException(
        'selected_product_ids is required when products_mode is SELECTED',
      );
    }

    const validIds = await this.getValidOrgProductIds(orgId, selectedProductIds);
    if (validIds.length !== selectedProductIds.length) {
      throw new BadRequestException('One or more selected_product_ids are invalid for this org');
    }

    await tx.insert(schema.callProducts).values(
      validIds.map((productId) => ({
        callId,
        productId,
      })),
    );
  }

  private getOrgProducts(orgId: string) {
    return this.db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.orgId, orgId))
      .orderBy(asc(schema.products.name));
  }

  private getCallSelectedProducts(orgId: string, callId: string) {
    return this.db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.callProducts)
      .innerJoin(schema.products, eq(schema.callProducts.productId, schema.products.id))
      .where(and(eq(schema.callProducts.callId, callId), eq(schema.products.orgId, orgId)))
      .orderBy(asc(schema.products.name));
  }

  private async hydrateCall(
    orgId: string,
    call: typeof schema.calls.$inferSelect,
  ) {
    const [selectedProducts, availableProducts] = await Promise.all([
      call.productsMode === ProductsMode.SELECTED
        ? this.getCallSelectedProducts(orgId, call.id)
        : Promise.resolve([]),
      this.getOrgProducts(orgId),
    ]);

    return {
      ...call,
      selectedProducts,
      availableProducts,
    };
  }

  async create(user: JwtPayload, dto: CreateCallDto) {
    const orgSettings = await this.getOrgSettings(user.orgId);
    const layoutPreset = dto.layoutPreset ?? (orgSettings.liveLayoutDefault as LiveLayout);
    const guidanceLevel = dto.guidanceLevel ?? GuidanceLevel.STANDARD;
    const productsMode = dto.products_mode ?? ProductsMode.ALL;
    const selectedProductIds = this.normalizeSelectedProductIds(dto.selected_product_ids);

    const contactJson: Record<string, unknown> = {};
    if (dto.practicePersonaId) contactJson.practicePersonaId = dto.practicePersonaId;
    if (dto.customPersonaPrompt) contactJson.customPersonaPrompt = dto.customPersonaPrompt;

    const call = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.calls)
        .values({
          orgId: user.orgId,
          userId: user.sub,
          agentId: dto.agentId ?? null,
          playbookId: null,
          mode: dto.mode ?? 'OUTBOUND',
          guidanceLevel,
          layoutPreset,
          productsMode,
          phoneTo: dto.phoneTo,
          contactJson,
          notes: dto.notes ?? null,
          status: 'INITIATED',
          startedAt: new Date(),
        })
        .returning();

      await this.syncCallProducts(tx, user.orgId, created.id, productsMode, selectedProductIds);

      return created;
    });

    return this.hydrateCall(user.orgId, call);
  }

  async list(user: JwtPayload) {
    return this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.orgId, user.orgId), eq(schema.calls.userId, user.sub)))
      .orderBy(desc(schema.calls.startedAt));
  }

  async get(user: JwtPayload, id: string) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);

    if (!call) throw new NotFoundException('Call not found');

    const suggestions = await this.db
      .select()
      .from(schema.callSuggestions)
      .where(eq(schema.callSuggestions.callId, id))
      .orderBy(desc(schema.callSuggestions.tsMs));

    const hydrated = await this.hydrateCall(user.orgId, call);

    return { ...hydrated, suggestions };
  }

  async update(user: JwtPayload, id: string, dto: UpdateCallDto) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);

    if (!call) throw new NotFoundException('Call not found');
    if (call.userId !== user.sub) throw new ForbiddenException();

    const shouldSyncProducts =
      dto.products_mode !== undefined || dto.selected_product_ids !== undefined;

    const nextMode =
      dto.products_mode ??
      (dto.selected_product_ids !== undefined ? ProductsMode.SELECTED : (call.productsMode as ProductsMode));

    const selectedProductIds = this.normalizeSelectedProductIds(dto.selected_product_ids);

    const updatedCall = await this.db.transaction(async (tx) => {
      const patch: Partial<typeof schema.calls.$inferInsert> = {};

      if (dto.notes !== undefined) patch.notes = dto.notes;
      if (shouldSyncProducts) patch.productsMode = nextMode;

      let next = call;
      if (Object.keys(patch).length > 0) {
        const [updated] = await tx
          .update(schema.calls)
          .set(patch)
          .where(eq(schema.calls.id, id))
          .returning();
        next = updated;
      }

      if (shouldSyncProducts) {
        await this.syncCallProducts(tx, user.orgId, id, nextMode, selectedProductIds);
      }

      return next;
    });

    return this.hydrateCall(user.orgId, updatedCall);
  }

  async end(user: JwtPayload, id: string) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);

    if (!call) throw new NotFoundException('Call not found');
    if (call.userId !== user.sub) throw new ForbiddenException();

    const [updated] = await this.db
      .update(schema.calls)
      .set({ status: 'COMPLETED', endedAt: new Date() })
      .where(eq(schema.calls.id, id))
      .returning();

    return updated;
  }

  async getTranscript(user: JwtPayload, id: string) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);
    if (!call) throw new NotFoundException('Call not found');

    return this.db
      .select()
      .from(schema.callTranscript)
      .where(and(eq(schema.callTranscript.callId, id), eq(schema.callTranscript.isFinal, true)))
      .orderBy(asc(schema.callTranscript.tsMs));
  }

  async getSummary(user: JwtPayload, id: string) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, id), eq(schema.calls.orgId, user.orgId)))
      .limit(1);
    if (!call) throw new NotFoundException('Call not found');

    const [summary] = await this.db
      .select()
      .from(schema.callSummaries)
      .where(eq(schema.callSummaries.callId, id))
      .limit(1);
    return summary ?? null;
  }

  async setTwilioSid(callId: string, callSid: string) {
    await this.db
      .update(schema.calls)
      .set({ twilioCallSid: callSid })
      .where(eq(schema.calls.id, callId));
  }

  async updateStatusBySid(
    callSid: string,
    status: string,
    extra: { startedAt?: Date; endedAt?: Date } = {},
  ) {
    const [updated] = await this.db
      .update(schema.calls)
      .set({ status, ...extra })
      .where(eq(schema.calls.twilioCallSid, callSid))
      .returning();
    return updated ?? null;
  }

  async setStatusImmediate(callId: string, status: string) {
    await this.db
      .update(schema.calls)
      .set({ status })
      .where(eq(schema.calls.id, callId));
  }
}

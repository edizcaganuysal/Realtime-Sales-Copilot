import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  FAST_CALL_MODELS,
  GuidanceLevel,
  LiveLayout,
  ProductsMode,
  type FastCallModel,
} from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';
import { CreditsService } from '../credits/credits.service';
// Flat-rate billing removed — credits now debited per-LLM-call in engine services
import { LlmService } from './llm.service';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly creditsService: CreditsService,
    private readonly llm: LlmService,
  ) {}

  private compactText(value: string, max = 200) {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max - 1).trimEnd()}...`;
  }

  private normalizeBrand(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private normalizeTopic(value: string) {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) return 'your current priorities';
    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.slice(0, 6).join(' ');
  }

  private resolveCallModel(value?: string): FastCallModel {
    if (value && FAST_CALL_MODELS.includes(value as FastCallModel)) {
      return value as FastCallModel;
    }
    return 'gpt-5-mini';
  }

  private extractProspectIdentity(
    contactJson: Record<string, unknown> | null | undefined,
  ): { name: string; companyName: string } {
    const source = contactJson ?? {};
    const read = (keys: string[]) => {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
      return '';
    };
    return {
      name: read(['name', 'firstName', 'first_name', 'contactName', 'contact_name']),
      companyName: read([
        'company',
        'companyName',
        'company_name',
        'organization',
        'organizationName',
        'org_name',
        'accountName',
      ]),
    };
  }

  private isOpenerValid(
    opener: string,
    context: {
      sellerCompanyName: string;
      prospectCompanyName: string;
    },
  ) {
    const text = opener.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (!/[.?!]$/.test(text)) return false;
    const sellerNorm = this.normalizeBrand(context.sellerCompanyName);
    const prospectNorm = this.normalizeBrand(context.prospectCompanyName);
    const normalized = this.normalizeBrand(text);
    if (sellerNorm && normalized.includes(sellerNorm)) return false;
    const mentionsCompanyPattern = /\b(?:at|from)\s+[A-Za-z]/i.test(text);
    if (!prospectNorm) {
      if (mentionsCompanyPattern) return false;
      return true;
    }
    if (sellerNorm && sellerNorm === prospectNorm) {
      return !mentionsCompanyPattern;
    }
    if (!mentionsCompanyPattern) return true;
    return normalized.includes(prospectNorm);
  }

  private buildDeterministicOpener(input: {
    prospectName: string;
    prospectCompanyName: string;
    sellerCompanyName: string;
    whatWeSell: string;
    callType: string;
    notes: string | null;
    offeringName: string;
  }) {
    const topic = this.normalizeTopic(input.offeringName || input.whatWeSell);
    const leadName = input.prospectName || 'there';
    const salutation = `Hi ${leadName}`;
    const prospectNorm = this.normalizeBrand(input.prospectCompanyName);
    const sellerNorm = this.normalizeBrand(input.sellerCompanyName);
    const canUseProspectCompany =
      prospectNorm.length > 0 && prospectNorm !== sellerNorm;
    if (input.callType === 'follow_up' || /follow|existing|check-in/i.test(input.notes ?? '')) {
      if (canUseProspectCompany) {
        return `${salutation} at ${input.prospectCompanyName}—quick follow-up: are you still the right person for ${topic}?`;
      }
      return `${salutation}—quick follow-up: are you still the right person for ${topic}?`;
    }
    if (canUseProspectCompany) {
      return `${salutation} at ${input.prospectCompanyName}—quick question: are you the right person for ${topic}?`;
    }
    return `${salutation}—quick question: are you the right person for ${topic}?`;
  }

  private async generatePreparedOpener(
    orgId: string,
    callId: string,
    callType: string,
    notes: string | null,
    productsMode: ProductsMode,
    llmModel: FastCallModel,
  ) {
    const [contextRow, callRow, selectedProducts, allProducts] = await Promise.all([
      this.db
        .select()
        .from(schema.salesContext)
        .where(eq(schema.salesContext.orgId, orgId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select({ contactJson: schema.calls.contactJson })
        .from(schema.calls)
        .where(eq(schema.calls.id, callId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      productsMode === ProductsMode.SELECTED
        ? this.db
            .select({
              id: schema.products.id,
              name: schema.products.name,
              elevatorPitch: schema.products.elevatorPitch,
            })
            .from(schema.callProducts)
            .innerJoin(schema.products, eq(schema.callProducts.productId, schema.products.id))
            .where(and(eq(schema.callProducts.callId, callId), eq(schema.products.orgId, orgId)))
            .orderBy(asc(schema.products.name))
        : Promise.resolve([]),
      this.db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          elevatorPitch: schema.products.elevatorPitch,
        })
        .from(schema.products)
        .where(eq(schema.products.orgId, orgId))
        .orderBy(asc(schema.products.name)),
    ]);

    const selected = productsMode === ProductsMode.SELECTED && selectedProducts.length > 0
      ? selectedProducts
      : allProducts;
    const names = selected.map((item) => item.name).slice(0, 4);
    const summary = selected
      .map((item) => `${item.name}${item.elevatorPitch ? `: ${this.compactText(item.elevatorPitch, 120)}` : ''}`)
      .slice(0, 4)
      .join(' | ');
    const identity = this.extractProspectIdentity(
      callRow?.contactJson as Record<string, unknown> | null | undefined,
    );

    const context = {
      sellerCompanyName: contextRow?.companyName?.trim() || '',
      prospectName: identity.name,
      prospectCompanyName: identity.companyName,
      whatWeSell: contextRow?.whatWeSell?.trim() || '',
      callType,
      notes,
      offeringName: names[0] ?? '',
    };

    const deterministic = this.buildDeterministicOpener(context);
    if (!this.llm.available) {
      return deterministic;
    }

    try {
      const system =
        'You are an expert sales coach that drafts a concise opening line before a live call starts. Output plain text only.';
      const user =
        `Call type: ${callType}\n` +
        `Seller company: ${context.sellerCompanyName || 'Unknown'}\n` +
        `Prospect name: ${context.prospectName || 'Unknown'}\n` +
        `Prospect company: ${context.prospectCompanyName || 'Unknown'}\n` +
        `What we sell: ${context.whatWeSell || 'Not provided'}\n` +
        `Offerings: ${names.length > 0 ? names.join(', ') : 'None'}\n` +
        `Offering summary: ${summary || 'None'}\n` +
        `Notes: ${notes ?? 'None'}\n` +
        'Generate exactly ONE sentence opener for the rep, max 18 words. Prefer: "Hi [Name]—quick question: are you the right person for [topic]?" Do not mention the seller company name. Mention a company name only if prospect company is known and different from seller company. If prospect company is unknown, use "your team" or "your org". Output plain text only, no markdown, no labels.';
      const openerResult = await this.llm.chatFast(system, user, {
        model: llmModel,
        billing: { orgId, ledgerType: 'USAGE_LLM_ENGINE_TICK', metadata: { call_id: callId, prepared_opener: true } },
      });
      const opener = openerResult.text.replace(/\s+/g, ' ').trim();
      if (this.isOpenerValid(opener, context)) return opener;
      const retryResult = await this.llm.chatFast(
        system,
        `${user}\nHard rule: never include the seller company name. Keep one complete sentence only.`,
        {
          model: llmModel,
          billing: { orgId, ledgerType: 'USAGE_LLM_ENGINE_TICK', metadata: { call_id: callId, prepared_opener_retry: true } },
        },
      );
      const retry = retryResult.text.replace(/\s+/g, ' ').trim();
      if (this.isOpenerValid(retry, context)) return retry;
      return deterministic;
    } catch {
      return deterministic;
    }
  }

  private async generateFollowupSeed(
    orgId: string,
    callId: string,
    productsMode: ProductsMode,
    llmModel: FastCallModel,
  ): Promise<string> {
    const FALLBACK = JSON.stringify([
      'What outcome matters most to you right now?',
      "What's your timeline for making a decision?",
      'What does your current process look like?',
    ]);

    try {
      const [contextRow, selectedProducts, allProducts] = await Promise.all([
        this.db
          .select()
          .from(schema.salesContext)
          .where(eq(schema.salesContext.orgId, orgId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        productsMode === ProductsMode.SELECTED
          ? this.db
              .select({ name: schema.products.name })
              .from(schema.callProducts)
              .innerJoin(schema.products, eq(schema.callProducts.productId, schema.products.id))
              .where(and(eq(schema.callProducts.callId, callId), eq(schema.products.orgId, orgId)))
              .orderBy(asc(schema.products.name))
          : Promise.resolve([]),
        this.db
          .select({ name: schema.products.name })
          .from(schema.products)
          .where(eq(schema.products.orgId, orgId))
          .orderBy(asc(schema.products.name))
          .limit(4),
      ]);

      const selected = productsMode === ProductsMode.SELECTED && selectedProducts.length > 0 ? selectedProducts : allProducts;
      const names = selected.map((item) => item.name).slice(0, 3);
      const companyName = contextRow?.companyName?.trim() || '';
      const whatWeSell = contextRow?.whatWeSell?.trim() || '';

      if (!this.llm.available) return FALLBACK;

      const system = 'You are a sales coach. Generate short, high-signal discovery questions. Return a valid JSON array of strings only. No markdown.';
      const user =
        `Company: ${companyName || 'Unknown'}\n` +
        `What we sell: ${whatWeSell || 'Not provided'}\n` +
        `Offerings: ${names.length > 0 ? names.join(', ') : 'None'}\n` +
        'Generate 3 short discovery questions (max 12 words each) a rep can ask after the prospect responds to the opener. Return a JSON array of 3 strings.';

      const seedResult = await this.llm.chatFast(system, user, {
        model: llmModel,
        billing: { orgId, ledgerType: 'USAGE_LLM_ENGINE_TICK', metadata: { call_id: callId, followup_seed: true } },
      });
      const parsed = this.llm.parseJson<string[]>(seedResult.text, []);
      const questions = Array.isArray(parsed)
        ? parsed.map((q) => (typeof q === 'string' ? q.trim() : '')).filter((q) => q.length > 0).slice(0, 3)
        : [];

      return questions.length > 0 ? JSON.stringify(questions) : FALLBACK;
    } catch {
      return FALLBACK;
    }
  }

  private async getOrgSettings(orgId: string) {
    const [settings] = await this.db
      .select()
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId))
      .limit(1);
    return settings;
  }

  private async resolvePlaybookId(orgId: string, requestedPlaybookId?: string | null) {
    if (requestedPlaybookId) {
      const [playbook] = await this.db
        .select({ id: schema.playbooks.id })
        .from(schema.playbooks)
        .where(and(eq(schema.playbooks.orgId, orgId), eq(schema.playbooks.id, requestedPlaybookId)))
        .limit(1);
      if (!playbook) {
        throw new BadRequestException('playbookId is invalid for this org');
      }
      return playbook.id;
    }

    const [defaultPlaybook] = await this.db
      .select({ id: schema.playbooks.id })
      .from(schema.playbooks)
      .where(and(eq(schema.playbooks.orgId, orgId), eq(schema.playbooks.isDefault, true)))
      .orderBy(asc(schema.playbooks.createdAt))
      .limit(1);

    return defaultPlaybook?.id ?? null;
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

  // NOTE: Flat per-minute billing (getCallUsageCost, getCallUsageType,
  // calculateBillableMinutes, debitCallUsage) has been removed.
  // Credits are now debited per-LLM-call in the engine/support-engine/ai-call/mock-call
  // services based on actual OpenAI token usage. See model-costs.ts for the cost registry.

  async create(user: JwtPayload, dto: CreateCallDto) {
    const orgSettings = await this.getOrgSettings(user.orgId);
    const layoutPreset = dto.layoutPreset ?? (orgSettings.liveLayoutDefault as LiveLayout);
    const guidanceLevel = dto.guidanceLevel ?? GuidanceLevel.STANDARD;
    const productsMode = dto.products_mode ?? ProductsMode.ALL;
    const llmModel = this.resolveCallModel(dto.llm_model);
    const selectedProductIds = this.normalizeSelectedProductIds(dto.selected_product_ids);
    const callMode = dto.mode ?? 'OUTBOUND';
    const callType = dto.call_type ?? 'cold_outbound';
    const playbookId = await this.resolvePlaybookId(user.orgId, dto.playbookId);
    await this.creditsService.requireAvailable(user.orgId, 1);

    const contactJson: Record<string, unknown> = {};
    if (dto.practicePersonaId) contactJson.practicePersonaId = dto.practicePersonaId;
    if (dto.customPersonaPrompt) contactJson.customPersonaPrompt = dto.customPersonaPrompt;
    contactJson.llmModel = llmModel;

    const call = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.calls)
        .values({
          orgId: user.orgId,
          userId: user.sub,
          agentId: dto.agentId ?? null,
          playbookId,
          mode: callMode,
          callType,
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

    let agentOpeners: string[] = [];
    if (dto.agentId) {
      const [agentRow] = await this.db
        .select({ openers: schema.agents.openers })
        .from(schema.agents)
        .where(and(eq(schema.agents.id, dto.agentId), eq(schema.agents.orgId, user.orgId)))
        .limit(1);
      agentOpeners = Array.isArray(agentRow?.openers) ? (agentRow.openers as string[]).filter((o) => typeof o === 'string' && o.trim().length > 0) : [];
    }

    let opener: string;
    if (dto.customOpener?.trim()) {
      opener = dto.customOpener.trim();
    } else if (agentOpeners.length > 0) {
      opener = agentOpeners[0]!;
    } else {
      opener = await this.generatePreparedOpener(
        user.orgId,
        call.id,
        callType,
        dto.notes ?? null,
        productsMode,
        llmModel,
      );
    }

    const [followupSeed, withOpener] = await Promise.all([
      this.generateFollowupSeed(user.orgId, call.id, productsMode, llmModel),
      this.db
        .update(schema.calls)
        .set({ preparedOpenerText: opener, preparedOpenerGeneratedAt: new Date() })
        .where(eq(schema.calls.id, call.id))
        .returning()
        .then((rows) => rows[0]),
    ]);

    if (followupSeed) {
      await this.db
        .update(schema.calls)
        .set({ preparedFollowupSeed: followupSeed })
        .where(eq(schema.calls.id, call.id));
    }

    return this.hydrateCall(user.orgId, withOpener ?? call);
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
      if (dto.outcome !== undefined) patch.outcome = dto.outcome;
      if (dto.deal_value !== undefined) patch.dealValue = dto.deal_value;
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
    if (call.endedAt) return call;

    const endedAt = new Date();

    const [updated] = await this.db
      .update(schema.calls)
      .set({ status: 'COMPLETED', endedAt })
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
    const [existing] = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.twilioCallSid, callSid))
      .limit(1);

    if (!existing) return null;

    const [updated] = await this.db
      .update(schema.calls)
      .set({ status, ...extra })
      .where(eq(schema.calls.twilioCallSid, callSid))
      .returning();

    if (!updated) return null;

    return updated;
  }

  async setStatusImmediate(callId: string, status: string) {
    await this.db
      .update(schema.calls)
      .set({ status })
      .where(eq(schema.calls.id, callId));
  }
}

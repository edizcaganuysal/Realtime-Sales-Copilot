import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AgentScope, AgentStatus } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { LlmService } from '../calls/llm.service';
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly llm: LlmService,
    private readonly creditsService: CreditsService,
  ) {}

  async list(user: JwtPayload) {
    return this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, user.orgId), eq(schema.agents.ownerUserId, user.sub)))
      .orderBy(desc(schema.agents.createdAt));
  }

  async create(user: JwtPayload, dto: CreateAgentDto) {
    const openers = this.normalizeOpeners(dto.openers);
    const [agent] = await this.db
      .insert(schema.agents)
      .values({
        orgId: user.orgId,
        ownerUserId: user.sub,
        scope: AgentScope.PERSONAL,
        status: AgentStatus.APPROVED,
        name: dto.name.trim(),
        prompt: dto.prompt.trim(),
        useDefaultTemplate: dto.useDefaultTemplate ?? true,
        promptDelta: dto.promptDelta?.trim() ?? dto.prompt.trim(),
        fullPromptOverride:
          dto.fullPromptOverride === null
            ? null
            : (dto.fullPromptOverride?.trim() || null),
        configJson: dto.configJson ?? {},
        openers,
      })
      .returning();
    return agent;
  }

  async update(user: JwtPayload, agentId: string, dto: UpdateAgentDto) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.ownerUserId !== user.sub) {
      throw new ForbiddenException('Not authorized to edit this agent');
    }

    const updatePayload: Partial<typeof schema.agents.$inferInsert> = {
      scope: AgentScope.PERSONAL,
      status: AgentStatus.APPROVED,
    };
    if (dto.name !== undefined) updatePayload.name = dto.name.trim();
    if (dto.prompt !== undefined) updatePayload.prompt = dto.prompt.trim();
    if (dto.configJson !== undefined) updatePayload.configJson = dto.configJson;
    if (dto.useDefaultTemplate !== undefined) {
      updatePayload.useDefaultTemplate = dto.useDefaultTemplate;
    }
    if (dto.promptDelta !== undefined) {
      updatePayload.promptDelta = dto.promptDelta.trim();
    }
    if (dto.fullPromptOverride !== undefined) {
      updatePayload.fullPromptOverride =
        dto.fullPromptOverride === null ? null : dto.fullPromptOverride.trim();
    }
    if (dto.openers !== undefined) {
      updatePayload.openers = this.normalizeOpeners(dto.openers);
    }

    const [updated] = await this.db
      .update(schema.agents)
      .set(updatePayload)
      .where(eq(schema.agents.id, agentId))
      .returning();
    return updated;
  }

  async remove(user: JwtPayload, agentId: string) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.ownerUserId !== user.sub) {
      throw new ForbiddenException('Not authorized to delete this agent');
    }

    const [deleted] = await this.db
      .delete(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .returning({ id: schema.agents.id });

    return deleted ?? { id: agentId };
  }

  async draftOpeners(user: JwtPayload, agentId: string) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');

    const [contextRow] = await this.db
      .select({
        companyName: schema.salesContext.companyName,
        whatWeSell: schema.salesContext.whatWeSell,
      })
      .from(schema.salesContext)
      .where(eq(schema.salesContext.orgId, user.orgId))
      .limit(1);

    const companyName = contextRow?.companyName?.trim() || 'our company';
    const whatWeSell = contextRow?.whatWeSell?.trim() || 'our solution';
    const agentContext = (agent.useDefaultTemplate ? agent.promptDelta : agent.fullPromptOverride) || agent.prompt;

    const DETERMINISTIC_FALLBACK = [
      `Hi, quick question—are you the right person to talk about improving your sales process?`,
      `Hi, this is ${companyName}—is now a bad time, or do you have 30 seconds?`,
      `Hi, quick intro: we help teams like yours with ${whatWeSell}—worth a minute?`,
    ];

    if (!this.llm.available) {
      return { openers: DETERMINISTIC_FALLBACK };
    }

    try {
      const system = 'You are a sales coach. Generate concise, speakable opening lines for cold calls. Output a valid JSON array of strings only. No markdown, no labels.';
      const user_prompt =
        `Company: ${companyName}\n` +
        `What we sell: ${whatWeSell}\n` +
        `Agent focus: ${agentContext.slice(0, 300)}\n` +
        `Generate exactly 5 distinct 1-sentence openers (max 18 words each) that start with "Hi" and end with a question. Return a JSON array of 5 strings.`;
      const openersResult = await this.llm.chatFast(system, user_prompt);
      void this.creditsService.debitForAiUsage(
        user.orgId, openersResult.model, openersResult.promptTokens, openersResult.completionTokens,
        'USAGE_LLM_AGENT_OPENERS', {},
      );
      const parsed = this.llm.parseJson<string[]>(openersResult.text, []);
      const openers = Array.isArray(parsed)
        ? parsed
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter((item) => item.length > 0)
            .slice(0, 5)
        : [];
      return { openers: openers.length > 0 ? openers : DETERMINISTIC_FALLBACK };
    } catch {
      return { openers: DETERMINISTIC_FALLBACK };
    }
  }

  async generateStrategyForOrg(user: JwtPayload) {
    return this.buildStrategy(user.orgId);
  }

  async generateStrategy(user: JwtPayload, agentId: string) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');

    return this.buildStrategy(user.orgId);
  }

  private async buildStrategy(orgId: string) {
    const [contextRow, productRows] = await Promise.all([
      this.db
        .select({
          companyName: schema.salesContext.companyName,
          whatWeSell: schema.salesContext.whatWeSell,
          targetCustomer: schema.salesContext.targetCustomer,
          targetRoles: schema.salesContext.targetRoles,
          industries: schema.salesContext.industries,
          globalValueProps: schema.salesContext.globalValueProps,
          proofPoints: schema.salesContext.proofPoints,
          caseStudies: schema.salesContext.caseStudies,
          buyingTriggers: schema.salesContext.buyingTriggers,
        })
        .from(schema.salesContext)
        .where(eq(schema.salesContext.orgId, orgId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select({ name: schema.products.name, elevatorPitch: schema.products.elevatorPitch })
        .from(schema.products)
        .where(eq(schema.products.orgId, orgId)),
    ]);

    const toList = (val: unknown): string[] =>
      Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [];

    const companyName = contextRow?.companyName?.trim() || '';
    const whatWeSell = contextRow?.whatWeSell?.trim() || '';
    const targetCustomer = contextRow?.targetCustomer?.trim() || '';
    const valueProps = toList(contextRow?.globalValueProps).slice(0, 5).join('; ');
    const proofPoints = toList(contextRow?.proofPoints).slice(0, 4).join('; ');
    const buyingTriggers = toList(contextRow?.buyingTriggers).slice(0, 4).join('; ');
    const industries = toList(contextRow?.industries).slice(0, 4).join(', ');
    const productSummary = productRows
      .map((p) => `${p.name}${p.elevatorPitch ? ': ' + p.elevatorPitch : ''}`)
      .join('. ');

    const FALLBACK_STRATEGY =
      `Focus on consultative discovery first: ask about the prospect's current situation and challenges before introducing features. ` +
      `Keep suggestions concise (1-2 sentences). Always move toward a concrete next step after handling an objection. ` +
      `Use specific proof points when available. Avoid generic empathy openers.`;

    if (!this.llm.available) {
      return { strategy: FALLBACK_STRATEGY };
    }

    try {
      const system =
        'You are an expert B2B sales coach. Write copilot strategy instructions that tell an AI sales assistant exactly how to behave during sales calls for this company. ' +
        'Output plain text only — 4 to 8 sentences. No markdown, no bullet points, no headers. Be specific about tone, discovery approach, objection handling, and what to emphasize.';
      const userPrompt =
        (companyName ? `Company: ${companyName}\n` : '') +
        (whatWeSell ? `What we sell: ${whatWeSell}\n` : '') +
        (productSummary ? `Products/services: ${productSummary}\n` : '') +
        (targetCustomer ? `Target customer: ${targetCustomer}\n` : '') +
        (industries ? `Industries: ${industries}\n` : '') +
        (valueProps ? `Key value props: ${valueProps}\n` : '') +
        (proofPoints ? `Proof points: ${proofPoints}\n` : '') +
        (buyingTriggers ? `Typical buying triggers: ${buyingTriggers}\n` : '') +
        `\nWrite a sales copilot strategy (4-8 sentences) that specifies: the recommended tone (consultative/direct/challenger), ` +
        `what discovery questions to prioritize, how to handle objections specific to this product and industry, ` +
        `which value props to lead with, and when to push for a next step. Make it specific to this company — not generic advice.`;
      const strategyResult = await this.llm.chatFast(system, userPrompt);
      void this.creditsService.debitForAiUsage(
        orgId, strategyResult.model, strategyResult.promptTokens, strategyResult.completionTokens,
        'USAGE_LLM_AGENT_STRATEGY', {},
      );
      const strategy = strategyResult.text?.trim() || FALLBACK_STRATEGY;
      return { strategy };
    } catch {
      return { strategy: FALLBACK_STRATEGY };
    }
  }

  private normalizeOpeners(openers: string[] | undefined): string[] {
    if (!Array.isArray(openers)) return [];
    return openers
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
      .slice(0, 10);
  }
}

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

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly llm: LlmService,
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
      const raw = await this.llm.chatFast(system, user_prompt);
      const parsed = this.llm.parseJson<string[]>(raw, []);
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

  private normalizeOpeners(openers: string[] | undefined): string[] {
    if (!Array.isArray(openers)) return [];
    return openers
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
      .slice(0, 10);
  }
}

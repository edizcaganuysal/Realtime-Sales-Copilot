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

@Injectable()
export class AgentsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(user: JwtPayload) {
    return this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, user.orgId), eq(schema.agents.ownerUserId, user.sub)))
      .orderBy(desc(schema.agents.createdAt));
  }

  async create(user: JwtPayload, dto: CreateAgentDto) {
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
}

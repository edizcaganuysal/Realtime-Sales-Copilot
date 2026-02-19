import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, or } from 'drizzle-orm';
import { AgentScope, AgentStatus, Role } from '@live-sales-coach/shared';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Injectable()
export class AgentsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  private async getOrgSettings(orgId: string) {
    const [settings] = await this.db
      .select()
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId))
      .limit(1);
    return settings;
  }

  async list(user: JwtPayload, scope?: AgentScope, status?: AgentStatus) {
    if (user.role === Role.REP && !scope) {
      return this.db
        .select()
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.orgId, user.orgId),
            or(
              eq(schema.agents.ownerUserId, user.sub),
              and(
                eq(schema.agents.scope, AgentScope.ORG),
                eq(schema.agents.status, AgentStatus.APPROVED),
              ),
            ),
          ),
        )
        .orderBy(desc(schema.agents.createdAt));
    }

    const conditions = [eq(schema.agents.orgId, user.orgId)];

    if (scope === AgentScope.PERSONAL) {
      conditions.push(eq(schema.agents.scope, AgentScope.PERSONAL));
      conditions.push(eq(schema.agents.ownerUserId, user.sub));
    } else if (scope === AgentScope.ORG) {
      conditions.push(eq(schema.agents.scope, AgentScope.ORG));
      if (user.role === Role.REP) {
        conditions.push(eq(schema.agents.status, AgentStatus.APPROVED));
      }
    }

    if (status) conditions.push(eq(schema.agents.status, status));

    return this.db
      .select()
      .from(schema.agents)
      .where(and(...conditions))
      .orderBy(desc(schema.agents.createdAt));
  }

  async create(user: JwtPayload, dto: CreateAgentDto) {
    const orgSettings = await this.getOrgSettings(user.orgId);

    if (user.role === Role.REP && !orgSettings.allowRepAgentCreation) {
      throw new ForbiddenException('Reps are not allowed to create agents in this org');
    }

    const scope =
      user.role === Role.REP ? AgentScope.PERSONAL : (dto.scope ?? AgentScope.PERSONAL);

    const [agent] = await this.db
      .insert(schema.agents)
      .values({
        orgId: user.orgId,
        ownerUserId: user.sub,
        scope,
        name: dto.name,
        prompt: dto.prompt,
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

    const privileged = user.role === Role.ADMIN || user.role === Role.MANAGER;

    if (!privileged && agent.ownerUserId !== user.sub) {
      throw new ForbiddenException('Not authorized to edit this agent');
    }

    if (!privileged && ![AgentStatus.DRAFT, AgentStatus.REJECTED].includes(agent.status as AgentStatus)) {
      throw new BadRequestException('Only DRAFT or REJECTED agents can be edited');
    }

    if (!privileged && dto.scope && dto.scope !== agent.scope) {
      throw new ForbiddenException('Only admins/managers can change agent scope');
    }

    const updatePayload: Partial<typeof schema.agents.$inferInsert> = {};
    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.prompt !== undefined) updatePayload.prompt = dto.prompt;
    if (dto.configJson !== undefined) updatePayload.configJson = dto.configJson;
    if (dto.scope !== undefined && privileged) updatePayload.scope = dto.scope;
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

  async submit(user: JwtPayload, agentId: string) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');

    if (agent.ownerUserId !== user.sub && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Not authorized');
    }

    if (![AgentStatus.DRAFT, AgentStatus.REJECTED].includes(agent.status as AgentStatus)) {
      throw new BadRequestException('Agent is not in a submittable state');
    }

    const orgSettings = await this.getOrgSettings(user.orgId);
    const autoApprove =
      !orgSettings.requiresAgentApproval && agent.scope === AgentScope.PERSONAL;
    const newStatus = autoApprove ? AgentStatus.APPROVED : AgentStatus.PENDING_APPROVAL;

    const [updated] = await this.db
      .update(schema.agents)
      .set({ status: newStatus })
      .where(eq(schema.agents.id, agentId))
      .returning();
    return updated;
  }

  async approve(user: JwtPayload, agentId: string) {
    return this.reviewAgent(user, agentId, AgentStatus.APPROVED);
  }

  async reject(user: JwtPayload, agentId: string) {
    return this.reviewAgent(user, agentId, AgentStatus.REJECTED);
  }

  async remove(user: JwtPayload, agentId: string) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');

    const privileged = user.role === Role.ADMIN || user.role === Role.MANAGER;
    if (!privileged && agent.ownerUserId !== user.sub) {
      throw new ForbiddenException('Not authorized to delete this agent');
    }

    if (!privileged && agent.status === AgentStatus.APPROVED) {
      throw new BadRequestException('Approved agents can only be deleted by managers/admins');
    }

    const [deleted] = await this.db
      .delete(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .returning({ id: schema.agents.id });

    return deleted ?? { id: agentId };
  }

  private async reviewAgent(
    user: JwtPayload,
    agentId: string,
    newStatus: AgentStatus.APPROVED | AgentStatus.REJECTED,
  ) {
    const [agent] = await this.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, user.orgId)))
      .limit(1);

    if (!agent) throw new NotFoundException('Agent not found');
    if (user.role !== Role.ADMIN && user.role !== Role.MANAGER) {
      throw new ForbiddenException('Only managers/admins can review agents');
    }

    if (newStatus === AgentStatus.APPROVED && agent.status === AgentStatus.APPROVED) {
      return agent;
    }
    if (newStatus === AgentStatus.REJECTED && agent.status === AgentStatus.REJECTED) {
      return agent;
    }

    const [updated] = await this.db
      .update(schema.agents)
      .set({ status: newStatus })
      .where(eq(schema.agents.id, agentId))
      .returning();
    return updated;
  }
}

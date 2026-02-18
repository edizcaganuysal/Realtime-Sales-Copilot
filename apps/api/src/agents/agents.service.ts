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

    if (agent.ownerUserId !== user.sub && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Not authorized to edit this agent');
    }

    if (![AgentStatus.DRAFT, AgentStatus.REJECTED].includes(agent.status as AgentStatus)) {
      throw new BadRequestException('Only DRAFT or REJECTED agents can be edited');
    }

    const [updated] = await this.db
      .update(schema.agents)
      .set(dto)
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
    if (agent.status !== AgentStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Agent is not pending approval');
    }

    const orgSettings = await this.getOrgSettings(user.orgId);
    const canReview =
      orgSettings.publisherPolicy === 'ADMIN_ONLY'
        ? user.role === Role.ADMIN
        : user.role === Role.ADMIN || user.role === Role.MANAGER;

    if (!canReview) {
      throw new ForbiddenException('Publisher policy does not allow you to approve agents');
    }

    const [updated] = await this.db
      .update(schema.agents)
      .set({ status: newStatus })
      .where(eq(schema.agents.id, agentId))
      .returning();
    return updated;
  }
}

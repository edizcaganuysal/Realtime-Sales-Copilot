import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/create-integration.dto';
import {
  CreateActionDefinitionDto,
  UpdateActionDefinitionDto,
} from './dto/create-action-definition.dto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /* ── Integrations ─────────────────────────────────────────────────────── */

  async listIntegrations(orgId: string) {
    return this.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.orgId, orgId));
  }

  async createIntegration(orgId: string, dto: CreateIntegrationDto) {
    const [row] = await this.db
      .insert(schema.integrations)
      .values({
        orgId,
        type: dto.type,
        name: dto.name,
        configJson: dto.configJson ?? {},
      })
      .returning();
    return row;
  }

  async updateIntegration(orgId: string, id: string, dto: UpdateIntegrationDto) {
    const [existing] = await this.db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.id, id), eq(schema.integrations.orgId, orgId)))
      .limit(1);
    if (!existing) throw new NotFoundException('Integration not found');

    const patch: Partial<typeof schema.integrations.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.configJson !== undefined) patch.configJson = dto.configJson;
    if (dto.status !== undefined) patch.status = dto.status;

    const [updated] = await this.db
      .update(schema.integrations)
      .set(patch)
      .where(eq(schema.integrations.id, id))
      .returning();
    return updated;
  }

  async deleteIntegration(orgId: string, id: string) {
    const [existing] = await this.db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.id, id), eq(schema.integrations.orgId, orgId)))
      .limit(1);
    if (!existing) throw new NotFoundException('Integration not found');

    await this.db.delete(schema.integrations).where(eq(schema.integrations.id, id));
    return { deleted: true };
  }

  /* ── Action Definitions ───────────────────────────────────────────────── */

  async listActionDefinitions(orgId: string) {
    return this.db
      .select()
      .from(schema.actionDefinitions)
      .where(eq(schema.actionDefinitions.orgId, orgId));
  }

  async createActionDefinition(orgId: string, dto: CreateActionDefinitionDto) {
    // Verify integration belongs to org
    const [integration] = await this.db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.id, dto.integrationId),
          eq(schema.integrations.orgId, orgId),
        ),
      )
      .limit(1);
    if (!integration) throw new NotFoundException('Integration not found');

    const [row] = await this.db
      .insert(schema.actionDefinitions)
      .values({
        orgId,
        integrationId: dto.integrationId,
        name: dto.name,
        description: dto.description,
        triggerPhrases: dto.triggerPhrases ?? [],
        inputSchema: dto.inputSchema,
        executionConfig: dto.executionConfig,
        requiresApproval: dto.requiresApproval ?? true,
        riskLevel: (dto.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH') ?? 'LOW',
      })
      .returning();
    return row;
  }

  async updateActionDefinition(orgId: string, id: string, dto: UpdateActionDefinitionDto) {
    const [existing] = await this.db
      .select()
      .from(schema.actionDefinitions)
      .where(
        and(eq(schema.actionDefinitions.id, id), eq(schema.actionDefinitions.orgId, orgId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException('Action definition not found');

    const patch: Partial<typeof schema.actionDefinitions.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.triggerPhrases !== undefined) patch.triggerPhrases = dto.triggerPhrases;
    if (dto.inputSchema !== undefined) patch.inputSchema = dto.inputSchema;
    if (dto.executionConfig !== undefined) patch.executionConfig = dto.executionConfig;
    if (dto.requiresApproval !== undefined) patch.requiresApproval = dto.requiresApproval;
    if (dto.riskLevel !== undefined)
      patch.riskLevel = dto.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH';
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    const [updated] = await this.db
      .update(schema.actionDefinitions)
      .set(patch)
      .where(eq(schema.actionDefinitions.id, id))
      .returning();
    return updated;
  }

  async deleteActionDefinition(orgId: string, id: string) {
    const [existing] = await this.db
      .select()
      .from(schema.actionDefinitions)
      .where(
        and(eq(schema.actionDefinitions.id, id), eq(schema.actionDefinitions.orgId, orgId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException('Action definition not found');

    await this.db
      .delete(schema.actionDefinitions)
      .where(eq(schema.actionDefinitions.id, id));
    return { deleted: true };
  }

  async getActiveDefinitionsForOrg(orgId: string) {
    return this.db
      .select()
      .from(schema.actionDefinitions)
      .where(
        and(
          eq(schema.actionDefinitions.orgId, orgId),
          eq(schema.actionDefinitions.isActive, true),
        ),
      );
  }
}

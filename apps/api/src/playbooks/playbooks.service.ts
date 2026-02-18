import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreatePlaybookDto } from './dto/create-playbook.dto';
import { UpdatePlaybookDto } from './dto/update-playbook.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

@Injectable()
export class PlaybooksService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  list(orgId: string) {
    return this.db
      .select()
      .from(schema.playbooks)
      .where(eq(schema.playbooks.orgId, orgId))
      .orderBy(asc(schema.playbooks.createdAt));
  }

  async create(orgId: string, dto: CreatePlaybookDto) {
    const [playbook] = await this.db
      .insert(schema.playbooks)
      .values({ orgId, name: dto.name })
      .returning();
    return playbook;
  }

  async findOne(orgId: string, id: string) {
    const [playbook] = await this.db
      .select()
      .from(schema.playbooks)
      .where(and(eq(schema.playbooks.id, id), eq(schema.playbooks.orgId, orgId)))
      .limit(1);

    if (!playbook) throw new NotFoundException('Playbook not found');

    const stages = await this.db
      .select()
      .from(schema.playbookStages)
      .where(eq(schema.playbookStages.playbookId, id))
      .orderBy(asc(schema.playbookStages.position));

    return { ...playbook, stages };
  }

  async update(orgId: string, id: string, dto: UpdatePlaybookDto) {
    const [updated] = await this.db
      .update(schema.playbooks)
      .set(dto)
      .where(and(eq(schema.playbooks.id, id), eq(schema.playbooks.orgId, orgId)))
      .returning();
    if (!updated) throw new NotFoundException('Playbook not found');
    return updated;
  }

  async setDefault(orgId: string, id: string) {
    const [playbook] = await this.db
      .select({ id: schema.playbooks.id })
      .from(schema.playbooks)
      .where(and(eq(schema.playbooks.id, id), eq(schema.playbooks.orgId, orgId)))
      .limit(1);
    if (!playbook) throw new NotFoundException('Playbook not found');

    await this.db
      .update(schema.playbooks)
      .set({ isDefault: false })
      .where(eq(schema.playbooks.orgId, orgId));

    const [updated] = await this.db
      .update(schema.playbooks)
      .set({ isDefault: true })
      .where(eq(schema.playbooks.id, id))
      .returning();
    return updated;
  }

  async addStage(orgId: string, playbookId: string, dto: CreateStageDto) {
    const [playbook] = await this.db
      .select({ id: schema.playbooks.id })
      .from(schema.playbooks)
      .where(and(eq(schema.playbooks.id, playbookId), eq(schema.playbooks.orgId, orgId)))
      .limit(1);
    if (!playbook) throw new NotFoundException('Playbook not found');

    const [last] = await this.db
      .select({ position: schema.playbookStages.position })
      .from(schema.playbookStages)
      .where(eq(schema.playbookStages.playbookId, playbookId))
      .orderBy(desc(schema.playbookStages.position))
      .limit(1);

    const position = last ? last.position + 1 : 0;

    const [stage] = await this.db
      .insert(schema.playbookStages)
      .values({
        playbookId,
        position,
        name: dto.name,
        goals: dto.goals ?? null,
        checklistJson: dto.checklistJson ?? [],
      })
      .returning();
    return stage;
  }

  async updateStage(orgId: string, stageId: string, dto: UpdateStageDto) {
    const [existing] = await this.db
      .select({ id: schema.playbookStages.id })
      .from(schema.playbookStages)
      .innerJoin(schema.playbooks, eq(schema.playbookStages.playbookId, schema.playbooks.id))
      .where(and(eq(schema.playbookStages.id, stageId), eq(schema.playbooks.orgId, orgId)))
      .limit(1);
    if (!existing) throw new NotFoundException('Stage not found');

    const [updated] = await this.db
      .update(schema.playbookStages)
      .set(dto)
      .where(eq(schema.playbookStages.id, stageId))
      .returning();
    return updated;
  }

  async deleteStage(orgId: string, stageId: string) {
    const [stage] = await this.db
      .select({
        id: schema.playbookStages.id,
        playbookId: schema.playbookStages.playbookId,
      })
      .from(schema.playbookStages)
      .innerJoin(schema.playbooks, eq(schema.playbookStages.playbookId, schema.playbooks.id))
      .where(and(eq(schema.playbookStages.id, stageId), eq(schema.playbooks.orgId, orgId)))
      .limit(1);
    if (!stage) throw new NotFoundException('Stage not found');

    await this.db
      .delete(schema.playbookStages)
      .where(eq(schema.playbookStages.id, stageId));

    const remaining = await this.db
      .select({ id: schema.playbookStages.id })
      .from(schema.playbookStages)
      .where(eq(schema.playbookStages.playbookId, stage.playbookId))
      .orderBy(asc(schema.playbookStages.position));

    await Promise.all(
      remaining.map((s, idx) =>
        this.db
          .update(schema.playbookStages)
          .set({ position: idx })
          .where(eq(schema.playbookStages.id, s.id)),
      ),
    );
  }

  async reorderStages(orgId: string, playbookId: string, dto: ReorderStagesDto) {
    const [playbook] = await this.db
      .select({ id: schema.playbooks.id })
      .from(schema.playbooks)
      .where(and(eq(schema.playbooks.id, playbookId), eq(schema.playbooks.orgId, orgId)))
      .limit(1);
    if (!playbook) throw new NotFoundException('Playbook not found');

    await Promise.all(
      dto.ids.map((id, idx) =>
        this.db
          .update(schema.playbookStages)
          .set({ position: idx })
          .where(
            and(
              eq(schema.playbookStages.id, id),
              eq(schema.playbookStages.playbookId, playbookId),
            ),
          ),
      ),
    );

    return this.db
      .select()
      .from(schema.playbookStages)
      .where(eq(schema.playbookStages.playbookId, playbookId))
      .orderBy(asc(schema.playbookStages.position));
  }
}

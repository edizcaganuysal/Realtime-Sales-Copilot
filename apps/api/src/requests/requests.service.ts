import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateCustomAgentRequestDto } from './dto/create-custom-agent-request.dto';
import { CreateFineTuneRequestDto } from './dto/create-fine-tune-request.dto';

type SalesRequestRow = {
  id: string;
  created_at: Date;
};

type SalesRequestListRow = {
  id: string;
  org_id: string;
  type: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  created_at: Date;
};

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  private sanitizeString(value: string | undefined, max = 2000): string {
    return (value ?? '').trim().slice(0, max);
  }

  private sanitizeArray(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
      .slice(0, 30);
  }

  private async getRequesterProfile(user: JwtPayload) {
    const [[org], [requester]] = await Promise.all([
      this.db
        .select({ name: schema.orgs.name })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, user.orgId))
        .limit(1),
      this.db
        .select({ name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(and(eq(schema.users.id, user.sub), eq(schema.users.orgId, user.orgId)))
        .limit(1),
    ]);

    return {
      company: org?.name ?? '',
      name: requester?.name ?? user.email,
      email: requester?.email ?? user.email,
    };
  }

  async createCustomAgentRequest(user: JwtPayload, dto: CreateCustomAgentRequestDto) {
    const requester = await this.getRequesterProfile(user);
    const useCase = this.sanitizeString(dto.use_case, 120);
    const notes = this.sanitizeString(dto.notes, 2000);
    const message = [useCase ? `Use case: ${useCase}` : '', notes]
      .filter((value) => value.length > 0)
      .join('\n\n')
      .slice(0, 2200);

    try {
      const result = await this.db.execute<SalesRequestRow>(sql`
        insert into public.sales_requests (org_id, type, name, email, company, role, notes)
        values (
          ${user.orgId},
          ${'custom_agent_build'},
          ${requester.name},
          ${requester.email.toLowerCase()},
          ${requester.company},
          ${user.role},
          ${message}
        )
        returning id, created_at
      `);

      const row = result.rows[0] ?? null;
      return {
        ok: true,
        id: row?.id ?? null,
        createdAt: row?.created_at ?? null,
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01') {
        this.logger.error('sales_requests table missing. Run supabase/sql/001_sales_requests.sql or supabase/sql/004_requests.sql');
        throw new InternalServerErrorException('Request storage is not ready yet. Please try again shortly.');
      }
      this.logger.error(`Failed to store custom agent request: ${(error as Error).message}`);
      throw new InternalServerErrorException('Unable to submit request right now.');
    }
  }

  async createFineTuneRequest(user: JwtPayload, dto: CreateFineTuneRequestDto) {
    const dataSources = this.sanitizeArray(dto.data_sources);
    const complianceNotes = this.sanitizeString(dto.compliance_notes, 2000) || null;
    const notes = this.sanitizeString(dto.notes, 3000) || null;

    try {
      const [row] = await this.db
        .insert(schema.fineTuneRequests)
        .values({
          orgId: user.orgId,
          requestedByUserId: user.sub,
          dataSources,
          complianceNotes,
          notes,
          status: 'new',
        })
        .returning();

      return {
        ok: true,
        id: row.id,
        createdAt: row.createdAt,
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01') {
        this.logger.error('fine_tune_requests table missing. Run supabase/sql/004_requests.sql');
        throw new InternalServerErrorException('Request storage is not ready yet. Please try again shortly.');
      }
      this.logger.error(`Failed to store fine-tune request: ${(error as Error).message}`);
      throw new InternalServerErrorException('Unable to submit request right now.');
    }
  }

  async listAdminRequests(orgId: string, status?: string) {
    let customRows: SalesRequestListRow[] = [];
    try {
      const customResult = await this.db.execute<SalesRequestListRow>(sql`
        select id, org_id, type, name, email, company, role, notes, created_at
        from public.sales_requests
        where org_id = ${orgId}
          and (type = ${'custom_agent_build'} or type = ${'custom_agent'})
        order by created_at desc
        limit 200
      `);
      customRows = customResult.rows;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01') {
        this.logger.error('sales_requests table missing. Run supabase/sql/004_requests.sql');
      } else {
        throw error;
      }
    }

    let fineTuneRows: Array<{
      id: string;
      orgId: string;
      status: string;
      notes: string | null;
      complianceNotes: string | null;
      dataSources: unknown;
      createdAt: Date;
      requestedByUserId: string;
    }> = [];

    try {
      fineTuneRows = await this.db
        .select({
          id: schema.fineTuneRequests.id,
          orgId: schema.fineTuneRequests.orgId,
          status: schema.fineTuneRequests.status,
          notes: schema.fineTuneRequests.notes,
          complianceNotes: schema.fineTuneRequests.complianceNotes,
          dataSources: schema.fineTuneRequests.dataSources,
          createdAt: schema.fineTuneRequests.createdAt,
          requestedByUserId: schema.fineTuneRequests.requestedByUserId,
        })
        .from(schema.fineTuneRequests)
        .where(eq(schema.fineTuneRequests.orgId, orgId))
        .orderBy(desc(schema.fineTuneRequests.createdAt))
        .limit(200);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01') {
        this.logger.error('fine_tune_requests table missing. Run supabase/sql/004_requests.sql');
      } else {
        throw error;
      }
    }

    const customMapped = customRows.map((row) => ({
      id: row.id,
      requestType: 'CUSTOM_AGENT' as const,
      status: 'new',
      title: 'Custom agent build',
      requesterName: row.name ?? null,
      requesterEmail: row.email ?? null,
      notes: row.notes ?? null,
      metadata: {
        type: row.type ?? 'custom_agent_build',
        role: row.role ?? null,
        company: row.company ?? null,
      },
      createdAt: row.created_at,
    }));

    const fineTuneMapped = fineTuneRows.map((row) => ({
      id: row.id,
      requestType: 'FINE_TUNE' as const,
      status: row.status ?? 'new',
      title: 'Fine-tuning request',
      requesterName: null,
      requesterEmail: null,
      notes: row.notes ?? null,
      metadata: {
        requested_by_user_id: row.requestedByUserId,
        data_sources: row.dataSources,
        compliance_notes: row.complianceNotes,
      },
      createdAt: row.createdAt,
    }));

    const merged = [...customMapped, ...fineTuneMapped].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    if (status && status.trim().length > 0) {
      const target = status.trim().toLowerCase();
      return merged.filter((item) => item.status.toLowerCase() === target);
    }

    return merged;
  }
}

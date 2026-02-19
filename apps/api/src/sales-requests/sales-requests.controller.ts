import {
  Body,
  Controller,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import { CreateSalesRequestDto } from './dto/create-sales-request.dto';

type InsertedRow = {
  id: string;
  created_at: Date;
};

@Controller('sales-requests')
export class SalesRequestsController {
  private readonly logger = new Logger(SalesRequestsController.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Post()
  async create(@Body() dto: CreateSalesRequestDto) {
    const type = (dto.type?.trim() || 'general').slice(0, 80);
    const name = dto.name.trim();
    const email = dto.email.trim().toLowerCase();
    const company = dto.company.trim();
    const role = dto.role.trim();
    const notes = dto.notes?.trim() ?? '';

    try {
      const result = await this.db.execute<InsertedRow>(sql`
        insert into public.sales_requests (org_id, type, name, email, company, role, notes)
        values (${null}, ${type}, ${name}, ${email}, ${company}, ${role}, ${notes})
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
      const message = (error as Error).message;
      if (code === '42P01') {
        this.logger.error('sales_requests table missing. Run supabase/sql/001_sales_requests.sql');
        throw new InternalServerErrorException('Demo request storage is not ready yet. Please try again shortly.');
      }
      this.logger.error(`Failed to store demo request: ${message}`);
      throw new InternalServerErrorException('Unable to submit demo request right now.');
    }
  }
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreateCreditRequestDto } from './dto/create-credit-request.dto';

@Injectable()
export class BillingService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async createCreditRequest(orgId: string, userId: string, dto: CreateCreditRequestDto) {
    const [created] = await this.db
      .insert(schema.creditPurchaseRequests)
      .values({
        orgId,
        requestedByUserId: userId,
        package: dto.package.trim(),
        credits: Math.max(1, Math.floor(dto.credits)),
        notes: dto.notes?.trim() || null,
        status: 'new',
      })
      .returning();

    return created;
  }

  listCreditRequests(orgId: string) {
    return this.db
      .select()
      .from(schema.creditPurchaseRequests)
      .where(eq(schema.creditPurchaseRequests.orgId, orgId))
      .orderBy(desc(schema.creditPurchaseRequests.createdAt));
  }

  async approveCreditRequest(orgId: string, id: string) {
    const [updated] = await this.db
      .update(schema.creditPurchaseRequests)
      .set({ status: 'approved' })
      .where(
        and(
          eq(schema.creditPurchaseRequests.id, id),
          eq(schema.creditPurchaseRequests.orgId, orgId),
        ),
      )
      .returning();

    if (!updated) {
      throw new NotFoundException('Credit request not found');
    }

    return updated;
  }
}

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';

@Injectable()
export class CreditsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async requireAndDebit(
    orgId: string,
    amount: number,
    type: string,
    metadata: Record<string, unknown> = {},
  ) {
    const debitAmount = Math.max(0, Math.floor(amount));
    if (debitAmount <= 0) {
      return {
        balanceAfter: null,
        debited: 0,
      };
    }

    return this.db.transaction(async (tx) => {
      const [subscription] = await tx
        .select()
        .from(schema.orgSubscription)
        .where(eq(schema.orgSubscription.orgId, orgId))
        .limit(1);

      const balance = subscription?.creditsBalance ?? 0;
      if (!subscription || balance < debitAmount) {
        throw new HttpException('Not enough credits', HttpStatus.PAYMENT_REQUIRED);
      }

      const nextBalance = balance - debitAmount;

      await tx
        .update(schema.orgSubscription)
        .set({
          creditsBalance: nextBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.orgSubscription.orgId, orgId));

      await tx.insert(schema.creditLedger).values({
        orgId,
        type,
        amount: -debitAmount,
        balanceAfter: nextBalance,
        metadataJson: metadata,
      });

      return {
        balanceAfter: nextBalance,
        debited: debitAmount,
      };
    });
  }
}

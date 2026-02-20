import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { creditsFromTokens, getTokensPerCredit } from '../config/credit-costs';

@Injectable()
export class CreditsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async requireAvailable(orgId: string, minimum = 1) {
    const needed = Math.max(1, Math.floor(minimum));
    const [subscription] = await this.db
      .select()
      .from(schema.orgSubscription)
      .where(eq(schema.orgSubscription.orgId, orgId))
      .limit(1);

    const balance = subscription?.creditsBalance ?? 0;
    if (!subscription || balance < needed) {
      throw new HttpException('Not enough credits', HttpStatus.PAYMENT_REQUIRED);
    }

    return {
      balance,
    };
  }

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

  async requireAndDebitByTokens(
    orgId: string,
    tokenCount: number,
    type: string,
    metadata: Record<string, unknown> = {},
  ) {
    const tokens = Math.max(0, Math.floor(tokenCount));
    const debitAmount = creditsFromTokens(tokens);
    if (debitAmount <= 0) {
      return {
        balanceAfter: null,
        debited: 0,
        tokens,
        creditsPerTokenUnit: getTokensPerCredit(),
      };
    }

    const result = await this.requireAndDebit(orgId, debitAmount, type, {
      ...metadata,
      token_count: tokens,
      tokens_per_credit: getTokensPerCredit(),
    });

    return {
      ...result,
      tokens,
      creditsPerTokenUnit: getTokensPerCredit(),
    };
  }

  async debitUpToAvailable(
    orgId: string,
    amount: number,
    type: string,
    metadata: Record<string, unknown> = {},
  ) {
    const requested = Math.max(0, Math.floor(amount));
    if (requested <= 0) {
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
      const debitAmount = Math.min(balance, requested);
      if (!subscription || debitAmount <= 0) {
        return {
          balanceAfter: balance,
          debited: 0,
        };
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
        metadataJson: {
          ...metadata,
          requested_credits: requested,
          debited_credits: debitAmount,
        },
      });

      return {
        balanceAfter: nextBalance,
        debited: debitAmount,
      };
    });
  }
}

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import {
  calculateCostCredits,
  calculateRealtimeAudioCostCredits,
  USD_PER_CREDIT,
} from '../config/model-costs';

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

  // ─── Cost-Based AI Billing ──────────────────────────────────────────────────

  /**
   * Debit credits for a text-based LLM call using actual token usage.
   *
   * This is the primary method for billing AI operations. It:
   * 1. Calculates exact USD cost from model pricing × token counts
   * 2. Converts to credits (10,000 credits = $1.00)
   * 3. Debits from org balance (soft — never fails mid-operation)
   * 4. Logs full cost metadata to the credit ledger
   *
   * Uses debitUpToAvailable (soft debit) so real-time operations
   * never hard-fail due to insufficient credits.
   */
  async debitForAiUsage(
    orgId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    ledgerType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ debited: number; costUsd: number }> {
    const credits = calculateCostCredits(model, promptTokens, completionTokens);
    if (credits <= 0) return { debited: 0, costUsd: 0 };
    const costUsd = credits * USD_PER_CREDIT;
    const result = await this.debitUpToAvailable(orgId, credits, ledgerType, {
      ...metadata,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_usd: costUsd,
    });
    return { debited: result.debited, costUsd };
  }

  /**
   * Debit credits for Realtime API audio tokens.
   * Audio tokens are ~17x more expensive than text tokens.
   * Tracked separately for pricing analysis.
   */
  async debitForRealtimeAudio(
    orgId: string,
    model: string,
    audioInputTokens: number,
    audioOutputTokens: number,
    ledgerType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ debited: number; costUsd: number }> {
    const credits = calculateRealtimeAudioCostCredits(model, audioInputTokens, audioOutputTokens);
    if (credits <= 0) return { debited: 0, costUsd: 0 };
    const costUsd = credits * USD_PER_CREDIT;
    const result = await this.debitUpToAvailable(orgId, credits, ledgerType, {
      ...metadata,
      model,
      audio_input_tokens: audioInputTokens,
      audio_output_tokens: audioOutputTokens,
      cost_usd: costUsd,
    });
    return { debited: result.debited, costUsd };
  }
}

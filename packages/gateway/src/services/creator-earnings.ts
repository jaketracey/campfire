import { z } from 'zod';
import { env } from '../env.js';
import {
  getCreatorEarningsRepository,
  type TokenSpendFeature,
} from '../repositories/index.js';
import type { UUID } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

export const RecordTokenSpendInputSchema = z.object({
  tokenTransactionId: z.string().uuid(),
  spenderUserId: z.string().uuid(),
  creatorUserId: z.string().uuid(),
  companionId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  feature: z.enum(['gift', 'voice_call', 'video', 'other']),
  tokensSpent: z.number().int().positive(),
  metadata: z.record(z.unknown()).optional(),
});

export type RecordTokenSpendInput = z.infer<typeof RecordTokenSpendInputSchema>;

export interface RecordTokenSpendResult {
  recorded: boolean;
  skippedReason?: 'self_spend';
  grossCents?: number;
  platformFeeCents?: number;
  netCents?: number;
}

function computeEarnings(tokensSpent: number): { grossCents: number; platformFeeCents: number; netCents: number } {
  const tokenValueCents = env.CREATOR_TOKEN_VALUE_CENTS;
  const platformFeeBps = env.CREATOR_PLATFORM_FEE_BPS;

  const grossCents = tokensSpent * tokenValueCents;
  const platformFeeCents = Math.round((grossCents * platformFeeBps) / 10_000);
  const netCents = Math.max(0, grossCents - platformFeeCents);

  return { grossCents, platformFeeCents, netCents };
}

export class CreatorEarningsService {
  private repo = getCreatorEarningsRepository();

  async recordTokenSpend(
    input: RecordTokenSpendInput,
    tx?: TransactionContext
  ): Promise<RecordTokenSpendResult> {
    const validated = RecordTokenSpendInputSchema.parse(input);

    if (validated.spenderUserId === validated.creatorUserId) {
      return { recorded: false, skippedReason: 'self_spend' };
    }

    const { grossCents, platformFeeCents, netCents } = computeEarnings(validated.tokensSpent);

    await this.repo.upsertAttribution({
      token_transaction_id: validated.tokenTransactionId as UUID,
      spender_user_id: validated.spenderUserId as UUID,
      creator_user_id: validated.creatorUserId as UUID,
      companion_id: validated.companionId as UUID,
      session_id: validated.sessionId ?? null,
      feature: validated.feature as TokenSpendFeature,
      tokens_spent: validated.tokensSpent,
      metadata: validated.metadata,
    }, tx);

    await this.repo.upsertEarning({
      token_transaction_id: validated.tokenTransactionId as UUID,
      creator_user_id: validated.creatorUserId as UUID,
      companion_id: validated.companionId as UUID,
      spender_user_id: validated.spenderUserId as UUID,
      feature: validated.feature as TokenSpendFeature,
      tokens_spent: validated.tokensSpent,
      gross_cents: grossCents,
      platform_fee_cents: platformFeeCents,
      net_cents: netCents,
    }, tx);

    return { recorded: true, grossCents, platformFeeCents, netCents };
  }

  async getSummaryForCreator(creatorUserId: string, tx?: TransactionContext) {
    return this.repo.getSummaryForCreator(creatorUserId as UUID, tx);
  }
}

let creatorEarningsService: CreatorEarningsService | null = null;
export function getCreatorEarningsService(): CreatorEarningsService {
  creatorEarningsService ??= new CreatorEarningsService();
  return creatorEarningsService;
}


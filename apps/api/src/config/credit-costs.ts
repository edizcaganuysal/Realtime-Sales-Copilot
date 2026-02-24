/**
 * DEPRECATED — This file is a backward-compatible shim.
 * All new code should import directly from './model-costs'.
 *
 * The old flat-rate system (120 credits/min, 100 tokens = 1 credit) is replaced
 * by exact cost-based billing. See model-costs.ts for the new system.
 */
export {
  calculateCostCredits,
  calculateRealtimeAudioCostCredits,
  estimateCreditsPerMinute,
  estimateRealtimeCreditsPerMinute,
  getModelCost,
  getAllModelCosts,
  USD_PER_CREDIT,
} from './model-costs';

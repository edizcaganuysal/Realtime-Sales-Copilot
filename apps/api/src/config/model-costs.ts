/**
 * ┌──────────────────────────────────────────────────────────────┐
 * │  CREDIT SYSTEM — COST-BASED BILLING                          │
 * │                                                               │
 * │  10,000 credits = $1.00 of actual OpenAI cost                 │
 * │  1 credit = $0.0001 USD                                       │
 * │                                                               │
 * │  TO ADD A NEW MODEL: add one entry to MODEL_COSTS below.      │
 * │  Everything else (debit, estimation, UI display) auto-updates. │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Conversion formula:
 *   costUsd = promptTokens × inputPerToken + completionTokens × outputPerToken
 *   credits = Math.ceil(costUsd / USD_PER_CREDIT)
 *
 * Example (gpt-5-mini, 500 prompt + 200 completion):
 *   costUsd = 500 × 0.00000025 + 200 × 0.000002 = 0.000525
 *   credits = Math.ceil(0.000525 / 0.0001) = 6
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ModelCost = {
  /** USD per single input/prompt token */
  inputPerToken: number;
  /** USD per single output/completion token */
  outputPerToken: number;
  /** Human-readable name for UI display */
  displayName: string;
  /** Whether this model supports the Realtime API (audio) */
  isRealtime?: boolean;
  /** USD per single audio input token (Realtime API only) */
  realtimeAudioInputPerToken?: number;
  /** USD per single audio output token (Realtime API only) */
  realtimeAudioOutputPerToken?: number;
};

// ─── Pricing Registry ───────────────────────────────────────────────────────────
// Source: https://platform.openai.com/docs/pricing
// All values are USD per single token (= listed price per 1M ÷ 1,000,000)

const MODEL_COSTS: Record<string, ModelCost> = {
  'gpt-5': {
    inputPerToken: 1.25e-6,
    outputPerToken: 10e-6,
    displayName: 'GPT-5',
  },
  'gpt-5-mini': {
    inputPerToken: 0.25e-6,
    outputPerToken: 2e-6,
    displayName: 'GPT-5 Mini',
  },
  'gpt-5-nano': {
    inputPerToken: 0.05e-6,
    outputPerToken: 0.4e-6,
    displayName: 'GPT-5 Nano',
  },
  'gpt-4o': {
    inputPerToken: 2.5e-6,
    outputPerToken: 10e-6,
    displayName: 'GPT-4o',
  },
  'gpt-4o-mini': {
    inputPerToken: 0.15e-6,
    outputPerToken: 0.6e-6,
    displayName: 'GPT-4o Mini',
  },
  'gpt-4.1': {
    inputPerToken: 2e-6,
    outputPerToken: 8e-6,
    displayName: 'GPT-4.1',
  },
  'gpt-4.1-mini': {
    inputPerToken: 0.4e-6,
    outputPerToken: 1.6e-6,
    displayName: 'GPT-4.1 Mini',
  },
  'gpt-4.1-nano': {
    inputPerToken: 0.1e-6,
    outputPerToken: 0.4e-6,
    displayName: 'GPT-4.1 Nano',
  },
  'gpt-4o-mini-realtime-preview': {
    inputPerToken: 0.6e-6,
    outputPerToken: 2.4e-6,
    displayName: 'GPT-4o Mini Realtime',
    isRealtime: true,
    realtimeAudioInputPerToken: 10e-6,
    realtimeAudioOutputPerToken: 20e-6,
  },
  'gpt-4o-realtime-preview': {
    inputPerToken: 5e-6,
    outputPerToken: 20e-6,
    displayName: 'GPT-4o Realtime',
    isRealtime: true,
    realtimeAudioInputPerToken: 40e-6,
    realtimeAudioOutputPerToken: 80e-6,
  },
};

// ─── Constants ──────────────────────────────────────────────────────────────────

/** 10,000 credits = $1.00 */
export const USD_PER_CREDIT = 0.0001;

// ─── Lookup ─────────────────────────────────────────────────────────────────────

export function getModelCost(model: string): ModelCost | undefined {
  return MODEL_COSTS[model];
}

export function getAllModelCosts(): Record<string, ModelCost> {
  return { ...MODEL_COSTS };
}

// ─── Cost Calculation ───────────────────────────────────────────────────────────

/**
 * Calculate the credit cost for a text-based LLM call.
 *
 * @param model   - OpenAI model name (e.g. 'gpt-5-mini')
 * @param promptTokens     - Number of input/prompt tokens (from response.usage)
 * @param completionTokens - Number of output/completion tokens (from response.usage)
 * @returns Number of credits to debit (always >= 0, rounded up)
 *
 * If the model is unknown, falls back to gpt-4o pricing (the most expensive
 * common model) to avoid under-billing.
 */
export function calculateCostCredits(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const cost = MODEL_COSTS[model] ?? MODEL_COSTS['gpt-4o']!;
  const prompt = Math.max(0, Math.floor(promptTokens));
  const completion = Math.max(0, Math.floor(completionTokens));
  const costUsd = prompt * cost.inputPerToken + completion * cost.outputPerToken;
  if (costUsd <= 0) return 0;
  return Math.ceil(costUsd / USD_PER_CREDIT);
}

/**
 * Calculate the credit cost for Realtime API audio tokens.
 * Audio tokens are significantly more expensive than text tokens.
 *
 * @param model        - Realtime model name (e.g. 'gpt-4o-mini-realtime-preview')
 * @param inputTokens  - Audio input tokens
 * @param outputTokens - Audio output tokens
 * @returns Number of credits to debit (always >= 0, rounded up)
 */
export function calculateRealtimeAudioCostCredits(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const cost = MODEL_COSTS[model];
  if (!cost?.isRealtime || !cost.realtimeAudioInputPerToken || !cost.realtimeAudioOutputPerToken) {
    // Not a realtime model — fall back to text pricing
    return calculateCostCredits(model, inputTokens, outputTokens);
  }
  const input = Math.max(0, Math.floor(inputTokens));
  const output = Math.max(0, Math.floor(outputTokens));
  const costUsd = input * cost.realtimeAudioInputPerToken + output * cost.realtimeAudioOutputPerToken;
  if (costUsd <= 0) return 0;
  return Math.ceil(costUsd / USD_PER_CREDIT);
}

// ─── Estimation (for UI display) ────────────────────────────────────────────────

/**
 * Estimate credits consumed per minute of active copilot use.
 *
 * Based on observed averages:
 *   - ~800 prompt tokens per LLM tick (system prompt + transcript + context)
 *   - ~150 completion tokens per LLM tick (JSON response)
 *   - ~4 ticks per minute during active conversation
 *
 * Total per minute: ~3,200 prompt tokens + ~600 completion tokens
 *
 * This is a rough guide — actual cost varies by conversation complexity,
 * transcript length, and RAG context size. The UI shows "~X credits/min".
 */
const AVG_PROMPT_TOKENS_PER_MIN = 3200;
const AVG_COMPLETION_TOKENS_PER_MIN = 600;

export function estimateCreditsPerMinute(model: string): number {
  return calculateCostCredits(model, AVG_PROMPT_TOKENS_PER_MIN, AVG_COMPLETION_TOKENS_PER_MIN);
}

/**
 * Estimate credits consumed per minute of Realtime API use (AI Caller / Mock Call).
 *
 * Realtime sessions produce both text and audio tokens. Estimates:
 *   - Text: ~1,000 input + ~200 output tokens per minute
 *   - Audio: ~6,000 input + ~4,000 output tokens per minute (at 8kHz G.711)
 */
const AVG_REALTIME_TEXT_INPUT_PER_MIN = 1000;
const AVG_REALTIME_TEXT_OUTPUT_PER_MIN = 200;
const AVG_REALTIME_AUDIO_INPUT_PER_MIN = 6000;
const AVG_REALTIME_AUDIO_OUTPUT_PER_MIN = 4000;

export function estimateRealtimeCreditsPerMinute(model: string): number {
  const textCredits = calculateCostCredits(
    model,
    AVG_REALTIME_TEXT_INPUT_PER_MIN,
    AVG_REALTIME_TEXT_OUTPUT_PER_MIN,
  );
  const audioCredits = calculateRealtimeAudioCostCredits(
    model,
    AVG_REALTIME_AUDIO_INPUT_PER_MIN,
    AVG_REALTIME_AUDIO_OUTPUT_PER_MIN,
  );
  return textCredits + audioCredits;
}

function readPositiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

const TOKENS_PER_CREDIT = readPositiveInt(
  process.env['CREDITS_TOKENS_PER_CREDIT'],
  100,
);

export const CREDIT_COSTS = {
  CALL_REAL_PER_MIN: readPositiveInt(process.env['CREDITS_CALL_REAL_PER_MIN'], 120),
  CALL_PRACTICE_PER_MIN: readPositiveInt(
    process.env['CREDITS_CALL_PRACTICE_PER_MIN'],
    60,
  ),
} as const;

export function getCreditCost(key: keyof typeof CREDIT_COSTS) {
  return CREDIT_COSTS[key];
}

export function getTokensPerCredit() {
  return TOKENS_PER_CREDIT;
}

export function creditsFromTokens(tokens: number) {
  const normalized = Math.max(0, Math.floor(tokens));
  if (normalized <= 0) return 0;
  return Math.ceil(normalized / TOKENS_PER_CREDIT);
}

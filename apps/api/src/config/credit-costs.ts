export const CREDIT_COSTS = {
  IMPORT_WEBSITE: 250,
  IMPORT_PDF: 180,
  CALL_REAL_PER_MIN: 120,
  CALL_PRACTICE_PER_MIN: 60,
} as const;

export function getCreditCost(key: keyof typeof CREDIT_COSTS) {
  return CREDIT_COSTS[key];
}

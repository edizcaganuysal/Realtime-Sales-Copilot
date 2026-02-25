/**
 * Feature flags — read from env vars.
 * All flags default to false (off) for safe rollout.
 * Change = redeploy. No runtime config needed yet.
 */

function isEnabled(envVar: string): boolean {
  const val = process.env[envVar]?.trim().toLowerCase();
  return val === 'true' || val === '1';
}

/** Toggle vector RAG (pgvector) vs keyword RAG for context retrieval */
export const VECTOR_RAG_ENABLED = () => isEnabled('VECTOR_RAG_ENABLED');

/** Toggle new output schema keys (say/intent/reason) vs old (primary/moment/move_type) */
export const NEW_OUTPUT_SCHEMA = () => isEnabled('NEW_OUTPUT_SCHEMA');

/** Toggle Engine-driven AI Caller vs direct Realtime conversation */
export const ENGINE_AS_AI_CALLER_BRAIN = () => isEnabled('ENGINE_AS_AI_CALLER_BRAIN');

/** Toggle Engine-driven Mock Call vs direct Realtime persona */
export const ENGINE_AS_MOCK_BRAIN = () => isEnabled('ENGINE_AS_MOCK_BRAIN');

/** Use separate TTS instead of Realtime text injection for AI Caller */
export const AI_CALLER_TTS_FALLBACK = () => isEnabled('AI_CALLER_TTS_FALLBACK');

/** Route to fine-tuned model vs base model */
export const FINE_TUNED_MODEL_ENABLED = () => isEnabled('FINE_TUNED_MODEL_ENABLED');

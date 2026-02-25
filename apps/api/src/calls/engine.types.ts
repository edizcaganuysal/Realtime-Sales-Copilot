/**
 * Unified Copilot Engine — Input / Output Contracts
 *
 * Every call mode (OUTBOUND, MOCK, AI_CALLER) MUST use these exact schemas.
 * The Engine is the single brain; modes are I/O wrappers only.
 *
 * All schemas use .strict() — unknown fields are rejected, not silently stripped.
 */

import { z } from 'zod';

// ─── Input Schema ────────────────────────────────────────────────────────────

export const CompanyBriefSchema = z
  .object({
    companyName: z.string(),
    whatWeSell: z.string(),
    targetCustomer: z.string(),
  })
  .strict();

export const RagChunkSchema = z
  .object({
    field: z.string(),
    text: z.string(),
    score: z.number(),
  })
  .strict();

export const TranscriptTurnSchema = z
  .object({
    speaker: z.enum(['REP', 'PROSPECT']),
    text: z.string(),
  })
  .strict();

export const CoachMemorySchema = z
  .object({
    used_value_props: z.array(z.string()),
    used_differentiators: z.array(z.string()),
    used_objection_responses: z.array(z.string()),
    questions_asked: z.array(z.string()),
    last_5_primary_suggestions: z.array(z.string()),
  })
  .strict();

export const EngineInputSchema = z
  .object({
    orgId: z.string().uuid(),
    callId: z.string().uuid(),
    callMode: z.enum(['OUTBOUND', 'MOCK', 'AI_CALLER']),
    callType: z.string(),
    guidanceLevel: z.enum(['MINIMAL', 'STANDARD', 'GUIDED']),

    companyBrief: CompanyBriefSchema,

    ragChunks: z.array(RagChunkSchema).max(8),

    agentPromptDelta: z.string().default(''),
    strategy: z.string().default(''),

    currentStage: z.string(),
    stageChecklist: z.array(z.string()).default([]),

    transcriptWindow: z.array(TranscriptTurnSchema).max(15),
    prospectLastUtterance: z.string(),

    objectionType: z.string().nullable(),
    detectedEntities: z.array(z.string()).default([]),
    intent: z.string().nullable(),

    coachMemory: CoachMemorySchema,

    notes: z.string().nullable().default(null),
    suggestionCount: z.union([z.literal(1), z.literal(3)]).default(3),
  })
  .strict();

export type EngineInput = z.infer<typeof EngineInputSchema>;

// ─── Output Schema ───────────────────────────────────────────────────────────

export const UsedUpdatesSchema = z
  .object({
    value_props_used: z.array(z.string()),
    differentiators_used: z.array(z.string()),
    objection_responses_used: z.array(z.string()),
    questions_asked: z.array(z.string()),
  })
  .strict();

export const ContextToastSchema = z
  .object({
    title: z.string(),
    bullets: z.array(z.string()),
  })
  .strict();

export const EngineResponseSchema = z
  .object({
    say: z.string().min(1),
    intent: z.string(),
    reason: z.string(),
    nudges: z.array(z.string()).max(3),
    context_toast: ContextToastSchema.nullable().default(null),
    ask: z.array(z.string()).nullable().default(null),
    used_updates: UsedUpdatesSchema,
  })
  .strict();

export type EngineResponse = z.infer<typeof EngineResponseSchema>;

// ─── Safe Fallback ───────────────────────────────────────────────────────────
// tick() NEVER throws — this is returned on any unrecoverable failure.

export const SAFE_FALLBACK_RESPONSE: EngineResponse = {
  say: "Could you tell me more about what you're looking for?",
  intent: 'clarify',
  reason: 'Discovery',
  nudges: ['Ask about goals', 'Listen actively'],
  context_toast: null,
  ask: null,
  used_updates: {
    value_props_used: [],
    differentiators_used: [],
    objection_responses_used: [],
    questions_asked: [],
  },
};

// ─── Coach Memory Helpers ────────────────────────────────────────────────────

export type CoachMemory = z.infer<typeof CoachMemorySchema>;

/** Merge engine response updates into existing memory. Append-only — never loses data. */
export function mergeMemoryUpdates(
  existing: CoachMemory,
  updates: EngineResponse['used_updates'],
  latestSay: string,
): CoachMemory {
  const dedupe = (arr: string[]) => [...new Set(arr)];
  return {
    used_value_props: dedupe([...existing.used_value_props, ...updates.value_props_used]),
    used_differentiators: dedupe([...existing.used_differentiators, ...updates.differentiators_used]),
    used_objection_responses: dedupe([
      ...existing.used_objection_responses,
      ...updates.objection_responses_used,
    ]),
    questions_asked: dedupe([...existing.questions_asked, ...updates.questions_asked]),
    last_5_primary_suggestions: [
      ...existing.last_5_primary_suggestions,
      latestSay,
    ].slice(-5),
  };
}

/** Empty coach memory for session start. */
export function emptyCoachMemory(): CoachMemory {
  return {
    used_value_props: [],
    used_differentiators: [],
    used_objection_responses: [],
    questions_asked: [],
    last_5_primary_suggestions: [],
  };
}

// ─── Per-Turn Tracing ────────────────────────────────────────────────────────

export interface TurnTrace {
  callId: string;
  turnIndex: number;
  sttTimeMs: number;
  embedTimeMs: number;
  ragTimeMs: number;
  ragChunkCount: number;
  ragFallback: boolean;
  llmTimeMs: number;
  schemaRetry: boolean;
  hallucinationDetected: boolean;
  totalTimeMs: number;
  outcome: 'ok' | 'ok_after_retry' | 'fallback' | 'error' | 'invalid_input';
}

// ─── OpenAI Structured Output JSON Schema ────────────────────────────────────
// Used with response_format: { type: 'json_schema', json_schema: { ... } }
// This forces the model to return valid JSON matching our schema at the API level.

export const ENGINE_RESPONSE_JSON_SCHEMA = {
  name: 'engine_response',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      say: { type: 'string' as const, description: 'Exact speakable words the rep should say next (1-2 sentences).' },
      intent: {
        type: 'string' as const,
        enum: ['clarify', 'value_map', 'next_step_close', 'empathize', 'discovery'],
        description: 'Move type for this suggestion.',
      },
      reason: { type: 'string' as const, description: '2-4 word moment label.' },
      nudges: {
        type: 'array' as const,
        items: { type: 'string' as const },
        maxItems: 3,
        description: 'Action chips, <=6 words each.',
      },
      context_toast: {
        anyOf: [
          {
            type: 'object' as const,
            properties: {
              title: { type: 'string' as const },
              bullets: { type: 'array' as const, items: { type: 'string' as const } },
            },
            required: ['title', 'bullets'] as const,
            additionalProperties: false,
          },
          { type: 'null' as const },
        ],
        description: 'Optional context card.',
      },
      ask: {
        anyOf: [
          { type: 'array' as const, items: { type: 'string' as const } },
          { type: 'null' as const },
        ],
        description: 'Optional follow-up questions.',
      },
      used_updates: {
        type: 'object' as const,
        properties: {
          value_props_used: { type: 'array' as const, items: { type: 'string' as const } },
          differentiators_used: { type: 'array' as const, items: { type: 'string' as const } },
          objection_responses_used: { type: 'array' as const, items: { type: 'string' as const } },
          questions_asked: { type: 'array' as const, items: { type: 'string' as const } },
        },
        required: ['value_props_used', 'differentiators_used', 'objection_responses_used', 'questions_asked'] as const,
        additionalProperties: false,
        description: 'Memory tracking — what was used in this turn.',
      },
    },
    required: ['say', 'intent', 'reason', 'nudges', 'context_toast', 'ask', 'used_updates'] as const,
    additionalProperties: false,
  },
} as const;

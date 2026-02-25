/**
 * Contract tests for the Unified Copilot Engine schemas.
 *
 * These tests verify:
 * 1. EngineInput strict schema validation (rejects extra fields)
 * 2. EngineResponse strict schema validation
 * 3. SAFE_FALLBACK_RESPONSE passes its own schema
 * 4. mergeMemoryUpdates is append-only (never loses data)
 * 5. callMode does NOT affect Engine pipeline (Single Brain Guarantee)
 *
 * ALL tests are deterministic — no real LLM calls.
 */

import {
  EngineInputSchema,
  EngineResponseSchema,
  SAFE_FALLBACK_RESPONSE,
  CoachMemorySchema,
  mergeMemoryUpdates,
  emptyCoachMemory,
  ENGINE_RESPONSE_JSON_SCHEMA,
} from './engine.types';
import type { EngineInput, EngineResponse, CoachMemory } from './engine.types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function buildValidInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    orgId: '00000000-0000-0000-0000-000000000001',
    callId: '00000000-0000-0000-0000-000000000002',
    callMode: 'OUTBOUND',
    callType: 'cold_outbound',
    guidanceLevel: 'STANDARD',
    companyBrief: {
      companyName: 'Acme Corp',
      whatWeSell: 'Cloud infrastructure monitoring for DevOps teams.',
      targetCustomer: 'VP Engineering at mid-market SaaS companies.',
    },
    ragChunks: [
      { field: 'proofPoints', text: 'Reduced downtime by 40% for TechCo.', score: 0.87 },
      { field: 'valueProps', text: 'Real-time alerts with 99.9% uptime.', score: 0.82 },
    ],
    agentPromptDelta: '',
    strategy: 'Lead with discovery — understand challenges before pitching.',
    currentStage: 'Discovery',
    stageChecklist: ['Ask about current monitoring tools', 'Identify main pain points'],
    transcriptWindow: [
      { speaker: 'REP', text: 'Hi, I noticed you recently migrated to AWS.' },
      { speaker: 'PROSPECT', text: 'Yeah, we did. We are still figuring out monitoring.' },
    ],
    prospectLastUtterance: 'Yeah, we did. We are still figuring out monitoring.',
    objectionType: null,
    detectedEntities: ['AWS'],
    intent: 'soft_interest',
    coachMemory: emptyCoachMemory(),
    notes: null,
    suggestionCount: 3,
    ...overrides,
  };
}

function buildValidResponse(overrides: Partial<EngineResponse> = {}): EngineResponse {
  return {
    say: 'What specific monitoring gaps are you running into with AWS?',
    intent: 'clarify',
    reason: 'Discovery probe',
    nudges: ['Ask about alerts', 'Explore pain'],
    context_toast: null,
    ask: null,
    used_updates: {
      value_props_used: [],
      differentiators_used: [],
      objection_responses_used: [],
      questions_asked: ['monitoring gaps'],
    },
    ...overrides,
  };
}

// ─── EngineInput Schema Tests ────────────────────────────────────────────────

describe('EngineInputSchema', () => {
  it('accepts a valid input', () => {
    const result = EngineInputSchema.safeParse(buildValidInput());
    expect(result.success).toBe(true);
  });

  it('accepts all three callMode values', () => {
    for (const mode of ['OUTBOUND', 'MOCK', 'AI_CALLER'] as const) {
      const result = EngineInputSchema.safeParse(buildValidInput({ callMode: mode }));
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown callMode', () => {
    const result = EngineInputSchema.safeParse(
      buildValidInput({ callMode: 'SUPPORT' as any }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects extra fields at root (.strict())', () => {
    const input = { ...buildValidInput(), unexpectedField: 'oops' };
    const result = EngineInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('rejects extra fields in companyBrief (.strict())', () => {
    const input = buildValidInput();
    (input.companyBrief as any).extraField = 'nope';
    const result = EngineInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects extra fields in coachMemory (.strict())', () => {
    const input = buildValidInput();
    (input.coachMemory as any).secret = true;
    const result = EngineInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects extra fields in transcriptWindow items (.strict())', () => {
    const input = buildValidInput({
      transcriptWindow: [{ speaker: 'REP', text: 'hi', extra: true } as any],
    });
    const result = EngineInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects extra fields in ragChunks items (.strict())', () => {
    const input = buildValidInput({
      ragChunks: [{ field: 'f', text: 't', score: 1, bonus: true } as any],
    });
    const result = EngineInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects more than 8 ragChunks', () => {
    const chunks = Array.from({ length: 9 }, (_, i) => ({
      field: `f${i}`,
      text: `text ${i}`,
      score: 0.5,
    }));
    const result = EngineInputSchema.safeParse(buildValidInput({ ragChunks: chunks }));
    expect(result.success).toBe(false);
  });

  it('rejects more than 15 transcriptWindow items', () => {
    const turns = Array.from({ length: 16 }, (_, i) => ({
      speaker: i % 2 === 0 ? ('REP' as const) : ('PROSPECT' as const),
      text: `turn ${i}`,
    }));
    const result = EngineInputSchema.safeParse(buildValidInput({ transcriptWindow: turns }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for orgId', () => {
    const result = EngineInputSchema.safeParse(buildValidInput({ orgId: 'not-a-uuid' }));
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const minimal = {
      orgId: '00000000-0000-0000-0000-000000000001',
      callId: '00000000-0000-0000-0000-000000000002',
      callMode: 'OUTBOUND',
      callType: 'cold_outbound',
      guidanceLevel: 'STANDARD',
      companyBrief: {
        companyName: 'Acme',
        whatWeSell: 'Widgets',
        targetCustomer: 'Anyone',
      },
      ragChunks: [],
      currentStage: 'Opening',
      transcriptWindow: [],
      prospectLastUtterance: 'Hello',
      objectionType: null,
      intent: null,
      coachMemory: emptyCoachMemory(),
    };

    const result = EngineInputSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentPromptDelta).toBe('');
      expect(result.data.strategy).toBe('');
      expect(result.data.stageChecklist).toEqual([]);
      expect(result.data.detectedEntities).toEqual([]);
      expect(result.data.notes).toBeNull();
      expect(result.data.suggestionCount).toBe(3);
    }
  });

  it('rejects completely invalid input', () => {
    const result = EngineInputSchema.safeParse({ garbage: true });
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = EngineInputSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects undefined input', () => {
    const result = EngineInputSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

// ─── EngineResponse Schema Tests ─────────────────────────────────────────────

describe('EngineResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = EngineResponseSchema.safeParse(buildValidResponse());
    expect(result.success).toBe(true);
  });

  it('rejects empty say', () => {
    const result = EngineResponseSchema.safeParse(buildValidResponse({ say: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects extra fields at root (.strict())', () => {
    const response = { ...buildValidResponse(), bonus: 42 };
    const result = EngineResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it('rejects extra fields in used_updates (.strict())', () => {
    const response = buildValidResponse();
    (response.used_updates as any).secret = true;
    const result = EngineResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it('rejects extra fields in context_toast (.strict())', () => {
    const response = buildValidResponse({
      context_toast: { title: 'T', bullets: ['b'], extra: true } as any,
    });
    const result = EngineResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it('rejects more than 3 nudges', () => {
    const result = EngineResponseSchema.safeParse(
      buildValidResponse({ nudges: ['a', 'b', 'c', 'd'] }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts null context_toast and ask', () => {
    const result = EngineResponseSchema.safeParse(
      buildValidResponse({ context_toast: null, ask: null }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts context_toast with title and bullets', () => {
    const result = EngineResponseSchema.safeParse(
      buildValidResponse({ context_toast: { title: 'Tip', bullets: ['do this'] } }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { say, ...incomplete } = buildValidResponse();
    const result = EngineResponseSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

// ─── SAFE_FALLBACK_RESPONSE Tests ────────────────────────────────────────────

describe('SAFE_FALLBACK_RESPONSE', () => {
  it('passes its own schema validation', () => {
    const result = EngineResponseSchema.safeParse(SAFE_FALLBACK_RESPONSE);
    expect(result.success).toBe(true);
  });

  it('has non-empty say', () => {
    expect(SAFE_FALLBACK_RESPONSE.say.length).toBeGreaterThan(0);
  });

  it('has empty used_updates (no false claims)', () => {
    expect(SAFE_FALLBACK_RESPONSE.used_updates.value_props_used).toHaveLength(0);
    expect(SAFE_FALLBACK_RESPONSE.used_updates.differentiators_used).toHaveLength(0);
    expect(SAFE_FALLBACK_RESPONSE.used_updates.objection_responses_used).toHaveLength(0);
    expect(SAFE_FALLBACK_RESPONSE.used_updates.questions_asked).toHaveLength(0);
  });
});

// ─── CoachMemory Append-Only Tests ───────────────────────────────────────────

describe('mergeMemoryUpdates (append-only guarantee)', () => {
  it('appends new items without losing existing ones', () => {
    const existing: CoachMemory = {
      used_value_props: ['fast'],
      used_differentiators: ['secure'],
      used_objection_responses: [],
      questions_asked: ['timeline?'],
      last_5_primary_suggestions: ['First suggestion'],
    };

    const updates = {
      value_props_used: ['scalable'],
      differentiators_used: [],
      objection_responses_used: ['pricing handled'],
      questions_asked: ['budget?'],
    };

    const merged = mergeMemoryUpdates(existing, updates, 'Second suggestion');

    expect(merged.used_value_props).toEqual(['fast', 'scalable']);
    expect(merged.used_differentiators).toEqual(['secure']);
    expect(merged.used_objection_responses).toEqual(['pricing handled']);
    expect(merged.questions_asked).toEqual(['timeline?', 'budget?']);
    expect(merged.last_5_primary_suggestions).toEqual(['First suggestion', 'Second suggestion']);
  });

  it('deduplicates repeated entries', () => {
    const existing: CoachMemory = {
      used_value_props: ['fast'],
      used_differentiators: [],
      used_objection_responses: [],
      questions_asked: [],
      last_5_primary_suggestions: [],
    };

    const updates = {
      value_props_used: ['fast', 'fast', 'new'],
      differentiators_used: [],
      objection_responses_used: [],
      questions_asked: [],
    };

    const merged = mergeMemoryUpdates(existing, updates, 'say');
    expect(merged.used_value_props).toEqual(['fast', 'new']);
  });

  it('caps last_5_primary_suggestions at 5', () => {
    const existing: CoachMemory = {
      used_value_props: [],
      used_differentiators: [],
      used_objection_responses: [],
      questions_asked: [],
      last_5_primary_suggestions: ['a', 'b', 'c', 'd', 'e'],
    };

    const updates = {
      value_props_used: [],
      differentiators_used: [],
      objection_responses_used: [],
      questions_asked: [],
    };

    const merged = mergeMemoryUpdates(existing, updates, 'f');
    expect(merged.last_5_primary_suggestions).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(merged.last_5_primary_suggestions).toHaveLength(5);
  });

  it('never returns fewer items than the existing memory', () => {
    const existing: CoachMemory = {
      used_value_props: ['a', 'b', 'c'],
      used_differentiators: ['x'],
      used_objection_responses: ['y'],
      questions_asked: ['q1', 'q2'],
      last_5_primary_suggestions: ['s1'],
    };

    const emptyUpdates = {
      value_props_used: [],
      differentiators_used: [],
      objection_responses_used: [],
      questions_asked: [],
    };

    const merged = mergeMemoryUpdates(existing, emptyUpdates, 's2');

    expect(merged.used_value_props.length).toBeGreaterThanOrEqual(existing.used_value_props.length);
    expect(merged.used_differentiators.length).toBeGreaterThanOrEqual(existing.used_differentiators.length);
    expect(merged.used_objection_responses.length).toBeGreaterThanOrEqual(existing.used_objection_responses.length);
    expect(merged.questions_asked.length).toBeGreaterThanOrEqual(existing.questions_asked.length);
  });
});

// ─── emptyCoachMemory Tests ──────────────────────────────────────────────────

describe('emptyCoachMemory', () => {
  it('passes CoachMemorySchema validation', () => {
    const result = CoachMemorySchema.safeParse(emptyCoachMemory());
    expect(result.success).toBe(true);
  });

  it('has all empty arrays', () => {
    const m = emptyCoachMemory();
    expect(m.used_value_props).toHaveLength(0);
    expect(m.used_differentiators).toHaveLength(0);
    expect(m.used_objection_responses).toHaveLength(0);
    expect(m.questions_asked).toHaveLength(0);
    expect(m.last_5_primary_suggestions).toHaveLength(0);
  });
});

// ─── JSON Schema Tests (for OpenAI structured output) ────────────────────────

describe('ENGINE_RESPONSE_JSON_SCHEMA', () => {
  it('has all required fields matching EngineResponseSchema', () => {
    const requiredFields = ENGINE_RESPONSE_JSON_SCHEMA.schema.required;
    expect(requiredFields).toContain('say');
    expect(requiredFields).toContain('intent');
    expect(requiredFields).toContain('reason');
    expect(requiredFields).toContain('nudges');
    expect(requiredFields).toContain('context_toast');
    expect(requiredFields).toContain('ask');
    expect(requiredFields).toContain('used_updates');
  });

  it('disallows additional properties', () => {
    expect(ENGINE_RESPONSE_JSON_SCHEMA.schema.additionalProperties).toBe(false);
  });

  it('has strict mode enabled', () => {
    expect(ENGINE_RESPONSE_JSON_SCHEMA.strict).toBe(true);
  });
});

// ─── Cross-Mode Pipeline Invariant ───────────────────────────────────────────

describe('Single Brain Guarantee — cross-mode invariant', () => {
  it('EngineInput is structurally identical across all modes (only callMode differs)', () => {
    const base = buildValidInput();

    const outboundInput = EngineInputSchema.parse({ ...base, callMode: 'OUTBOUND' });
    const mockInput = EngineInputSchema.parse({ ...base, callMode: 'MOCK' });
    const aiCallerInput = EngineInputSchema.parse({ ...base, callMode: 'AI_CALLER' });

    // Same structure, same fields — only callMode differs
    expect(Object.keys(outboundInput).sort()).toEqual(Object.keys(mockInput).sort());
    expect(Object.keys(mockInput).sort()).toEqual(Object.keys(aiCallerInput).sort());

    // callMode is the only difference
    const { callMode: _a, ...outboundRest } = outboundInput;
    const { callMode: _b, ...mockRest } = mockInput;
    const { callMode: _c, ...aiCallerRest } = aiCallerInput;
    expect(outboundRest).toEqual(mockRest);
    expect(mockRest).toEqual(aiCallerRest);
  });
});

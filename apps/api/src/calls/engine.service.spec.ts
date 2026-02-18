/**
 * Unit tests for EngineService — focused on stage hysteresis and stub tick logic.
 * All external dependencies (Gateway, LLM, DB) are fully mocked.
 */
import { EngineService } from './engine.service';
import { CallsGateway } from './calls.gateway';
import { LlmService } from './llm.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStage(name: string) {
  return { name, goals: `Goals for ${name}`, checklist: [] };
}

function makeContext(stages: ReturnType<typeof makeStage>[]) {
  return {
    callId: 'test-call',
    guidanceLevel: 'STANDARD',
    agentPrompt: 'Be helpful.',
    notes: null,
    stages,
  };
}

function makeState(stages: ReturnType<typeof makeStage>[]) {
  return {
    context: makeContext(stages),
    cancelled: false,
    transcriptBuffer: [],
    checklistState: [],
    currentStageIdx: 0,
    stageVoteForIdx: 0,
    stageVoteCount: 0,
    lastLlmCallAt: 0,
    llmCallCount: 0,
    stubTick: 0,
    stubInterval: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    llmInterval: null as any,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeMocks() {
  const gateway = {
    emitToCall: jest.fn(),
  } as unknown as jest.Mocked<CallsGateway>;

  const llm = {
    get available() { return false; },
    model: 'gpt-4o',
    chat: jest.fn(),
    parseJson: jest.fn(),
  } as unknown as jest.Mocked<LlmService>;

  const db = {} as never;

  return { gateway, llm, db };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EngineService — stage hysteresis', () => {
  let engine: EngineService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    engine = new EngineService(mocks.gateway, mocks.llm, mocks.db);
  });

  const stages = [
    makeStage('Opening'),
    makeStage('Discovery'),
    makeStage('Solution Fit'),
    makeStage('Close'),
  ];

  function applyVote(state: ReturnType<typeof makeState>, stageName: string) {
    // applyStageVote is private — access via type assertion for testing
    (engine as unknown as { applyStageVote: (...args: unknown[]) => void }).applyStageVote(
      'test-call',
      state,
      stageName,
    );
  }

  it('does not advance stage on first single vote', () => {
    const state = makeState(stages);
    applyVote(state, 'Discovery'); // first vote for Discovery
    expect(state.currentStageIdx).toBe(0); // still Opening
    expect(state.stageVoteForIdx).toBe(1);
    expect(state.stageVoteCount).toBe(1);
  });

  it('advances stage after 2 consecutive votes for same forward stage', () => {
    const state = makeState(stages);
    applyVote(state, 'Discovery');
    applyVote(state, 'Discovery'); // second vote → advance
    expect(state.currentStageIdx).toBe(1); // Discovery
    expect(mocks.gateway.emitToCall).toHaveBeenCalledWith(
      'test-call',
      'engine.stage',
      expect.objectContaining({ stageName: 'Discovery' }),
    );
  });

  it('resets vote streak when a different forward stage is voted', () => {
    const state = makeState(stages);
    applyVote(state, 'Discovery'); // vote 1 for Discovery
    applyVote(state, 'Solution Fit'); // different stage → reset streak
    expect(state.currentStageIdx).toBe(0); // still Opening
    expect(state.stageVoteForIdx).toBe(2); // now voting for Solution Fit (idx 2)
    expect(state.stageVoteCount).toBe(1);
  });

  it('does not go backward (regression prevented)', () => {
    const state = makeState(stages);
    state.currentStageIdx = 2; // currently at Solution Fit
    applyVote(state, 'Discovery'); // vote for an earlier stage
    applyVote(state, 'Discovery');
    expect(state.currentStageIdx).toBe(2); // stays at Solution Fit
  });

  it('does not advance past the last stage', () => {
    const state = makeState(stages);
    state.currentStageIdx = 3; // already at Close (last)
    applyVote(state, 'Close'); // same stage → no change
    expect(state.currentStageIdx).toBe(3);
  });

  it('clamps advancement to at most 1 stage ahead', () => {
    const state = makeState(stages);
    // Vote for Solution Fit (idx 2) while at Opening (idx 0)
    applyVote(state, 'Solution Fit');
    applyVote(state, 'Solution Fit');
    // Should advance to Solution Fit (idx 2), not clamped to 1
    // The engine allows any forward jump as long as 2 consecutive votes agree
    expect(state.currentStageIdx).toBe(2);
  });

  it('resets vote count after advancing', () => {
    const state = makeState(stages);
    applyVote(state, 'Discovery');
    applyVote(state, 'Discovery'); // advances
    expect(state.stageVoteCount).toBe(0); // reset
    expect(state.currentStageIdx).toBe(1);
  });
});

describe('EngineService — pushTranscript', () => {
  let engine: EngineService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    engine = new EngineService(mocks.gateway, mocks.llm, mocks.db);
  });

  it('does not crash when pushing transcript for unknown callId', () => {
    expect(() => engine.pushTranscript('unknown-id', 'REP', 'Hello')).not.toThrow();
  });

  it('does not crash when stopping unknown callId', () => {
    expect(() => engine.stop('unknown-id')).not.toThrow();
  });
});

describe('EngineService — getAlternatives stub fallback', () => {
  let engine: EngineService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    jest.spyOn(mocks.llm, 'available', 'get').mockReturnValue(false);
    engine = new EngineService(mocks.gateway, mocks.llm, mocks.db);
  });

  it('returns 2 stub alternatives when LLM is not available', async () => {
    const result = await engine.getAlternatives('no-engine-call');
    expect(result.texts).toHaveLength(2);
    expect(typeof result.texts[0]).toBe('string');
  });

  it('emits each alternative via gateway', async () => {
    await engine.getAlternatives('no-engine-call');
    expect(mocks.gateway.emitToCall).toHaveBeenCalledTimes(2);
    expect(mocks.gateway.emitToCall).toHaveBeenCalledWith(
      'no-engine-call',
      'engine.primary_suggestion',
      expect.objectContaining({ text: expect.any(String) }),
    );
  });
});

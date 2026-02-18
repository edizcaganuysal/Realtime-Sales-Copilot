import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsGateway } from './calls.gateway';
import { LlmService } from './llm.service';

// ─── Types ────────────────────────────────────────────────────────────────────

type StageInfo = {
  name: string;
  goals: string | null;
  checklist: string[];
};

type CallContext = {
  callId: string;
  guidanceLevel: string;
  agentPrompt: string;
  notes: string | null;
  stages: StageInfo[];
};

type TurnLine = { speaker: string; text: string };

type EngineState = {
  context: CallContext | null;
  cancelled: boolean;
  transcriptBuffer: TurnLine[];
  checklistState: Array<{ label: string; done: boolean }>;
  currentStageIdx: number;
  stageVoteForIdx: number;
  stageVoteCount: number;
  lastLlmCallAt: number;
  llmCallCount: number;
  stubTick: number;
  stubInterval: ReturnType<typeof setInterval> | null;
  llmInterval: ReturnType<typeof setInterval>;
};

// ─── Stubs / constants ────────────────────────────────────────────────────────

const FALLBACK_STAGES: StageInfo[] = [
  { name: 'Opening', goals: 'Greet and build rapport', checklist: [] },
  { name: 'Discovery', goals: 'Understand needs and pain points', checklist: [] },
  { name: 'Solution Fit', goals: 'Present relevant capabilities', checklist: [] },
  { name: 'Objection Handling', goals: 'Address concerns and resistance', checklist: [] },
  { name: 'Close', goals: 'Confirm next steps and commitment', checklist: [] },
];

const ALLOWED_NUDGES = [
  'ASK_QUESTION',
  'ADDRESS_OBJECTION',
  'TOO_MUCH_TALKING',
  'MISSING_NEXT_STEP',
  'SOFTEN_TONE',
  'SLOW_DOWN',
  'CONFIRM_UNDERSTANDING',
];

const STUB_SUGGESTIONS = [
  "Let's start by understanding your current setup.",
  'What outcomes matter most to your team this quarter?',
  "I hear you — many customers felt the same way at first.",
  'Would a short pilot make sense before full commitment?',
  "Let's nail down a follow-up with your technical lead.",
];

const STUB_NUDGES = [
  'ASK_QUESTION',
  'CONFIRM_UNDERSTANDING',
  'TOO_MUCH_TALKING',
  'ADDRESS_OBJECTION',
];

const STUB_TRANSCRIPT_REP = [
  "Tell me about your current process.",
  'What are your main challenges today?',
  'How does this solution sound to you?',
  'Would you be open to a short demo?',
];
const STUB_TRANSCRIPT_PROSPECT = [
  'We use a mostly manual workflow.',
  "We're concerned about the price.",
  'That sounds interesting.',
  'Let me check with my team.',
];

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EngineService implements OnModuleDestroy {
  private readonly logger = new Logger(EngineService.name);
  private engines = new Map<string, EngineState>();

  constructor(
    private readonly gateway: CallsGateway,
    private readonly llm: LlmService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  onModuleDestroy() {
    for (const [callId] of this.engines) {
      this.stop(callId);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Start the engine for a call.
   * stubTranscript=true → also emit fake transcript lines (dev/demo mode).
   * Suggestions, nudges, checklist are always emitted (LLM or stub).
   */
  start(callId: string, stubTranscript = true) {
    if (this.engines.has(callId)) return;

    const state: EngineState = {
      context: null,
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
      llmInterval: null as unknown as ReturnType<typeof setInterval>,
    };

    this.engines.set(callId, state);

    // Load call context asynchronously (first LLM tick waits for it)
    this.loadContext(callId, state).catch((err: Error) =>
      this.logger.error(`Engine context load failed (${callId}): ${err.message}`),
    );

    // Stub transcript: 2-second interval for fake lines
    if (stubTranscript) {
      state.stubInterval = setInterval(() => this.emitStubTranscript(callId, state), 2000);
    }

    // LLM / engine tick: every 10 seconds
    state.llmInterval = setInterval(() => {
      this.runEngineTick(callId, state).catch((err: Error) =>
        this.logger.error(`Engine tick error (${callId}): ${err.message}`),
      );
    }, 10_000);

    this.logger.log(`Engine started — call ${callId}, stubTranscript=${stubTranscript}`);
  }

  /**
   * Push a final transcript line into the engine buffer.
   * Called by MediaStreamService when Deepgram returns a final result.
   * Triggers an LLM tick if ≥6 s have elapsed since the last one.
   */
  pushTranscript(callId: string, speaker: string, text: string) {
    const state = this.engines.get(callId);
    if (!state) return;

    state.transcriptBuffer.push({ speaker, text });
    if (state.transcriptBuffer.length > 25) state.transcriptBuffer.shift();

    const now = Date.now();
    if (now - state.lastLlmCallAt > 6_000) {
      this.runEngineTick(callId, state).catch((err: Error) =>
        this.logger.error(`Engine tick (transcript-triggered) error (${callId}): ${err.message}`),
      );
    }
  }

  /**
   * Stop the engine and clean up intervals.
   */
  stop(callId: string) {
    const state = this.engines.get(callId);
    if (!state) return;
    state.cancelled = true;
    if (state.stubInterval) clearInterval(state.stubInterval);
    clearInterval(state.llmInterval);
    this.engines.delete(callId);
    this.logger.log(`Engine stopped — call ${callId}`);
  }

  /**
   * Generate 2 alternative suggestions on demand (POST /calls/:id/suggestions/more).
   * Emits them via socket and returns the texts.
   */
  async getAlternatives(callId: string): Promise<{ texts: string[] }> {
    const state = this.engines.get(callId);

    const stubAlts = [
      'Could you tell me more about your current process?',
      'What would success look like for you in six months?',
    ];

    if (!this.llm.available || !state?.context) {
      stubAlts.forEach((text) =>
        this.gateway.emitToCall(callId, 'engine.primary_suggestion', { text, tsMs: Date.now() }),
      );
      return { texts: stubAlts };
    }

    const { context } = state;
    const currentStage = context.stages[state.currentStageIdx] ?? context.stages[0];
    const recentTurns = state.transcriptBuffer
      .slice(-10)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');

    const systemPrompt = this.buildSystemPrompt(context, currentStage!);
    const userPrompt =
      (recentTurns ? `Transcript:\n${recentTurns}\n\n` : '') +
      'Generate exactly 2 alternative suggestions the REP could say next. ' +
      'Respond with JSON only: {"alternatives": ["suggestion 1", "suggestion 2"]}';

    try {
      const raw = await this.llm.chat(systemPrompt, userPrompt);
      const parsed = this.llm.parseJson<{ alternatives?: string[] }>(raw, {});
      const texts = (parsed.alternatives ?? stubAlts).slice(0, 2);
      texts.forEach((text) =>
        this.gateway.emitToCall(callId, 'engine.primary_suggestion', { text, tsMs: Date.now() }),
      );
      return { texts };
    } catch (err) {
      this.logger.error(`getAlternatives LLM error (${callId}): ${(err as Error).message}`);
      return { texts: stubAlts };
    }
  }

  /**
   * Run post-call analysis: load transcript from DB, generate summary + coaching,
   * persist to call_summaries. Called after the call ends (fire-and-forget).
   */
  async runPostCall(callId: string, notes: string | null, playbookId: string | null) {
    this.logger.log(`Post-call analysis starting for call ${callId}`);

    // Fetch final transcript lines from DB
    const rows = await this.db
      .select()
      .from(schema.callTranscript)
      .where(
        and(eq(schema.callTranscript.callId, callId), eq(schema.callTranscript.isFinal, true)),
      )
      .orderBy(asc(schema.callTranscript.tsMs));

    const transcript = rows.map((r) => ({ speaker: r.speaker, text: r.text }));

    // Load checklist items from playbook for results scoring
    let checklistItems: string[] = [];
    if (playbookId) {
      const stages = await this.db
        .select()
        .from(schema.playbookStages)
        .where(eq(schema.playbookStages.playbookId, playbookId))
        .orderBy(asc(schema.playbookStages.position));
      checklistItems = stages.flatMap((s) =>
        Array.isArray(s.checklistJson) ? (s.checklistJson as string[]) : [],
      );
    }

    const result = await this.buildPostCallResult(callId, transcript, checklistItems, notes);

    await this.db
      .insert(schema.callSummaries)
      .values({
        callId,
        summaryJson: result.summaryJson,
        coachingJson: result.coachingJson,
        checklistResultsJson: result.checklistResultsJson,
      })
      .onConflictDoUpdate({
        target: schema.callSummaries.callId,
        set: {
          summaryJson: result.summaryJson,
          coachingJson: result.coachingJson,
          checklistResultsJson: result.checklistResultsJson,
        },
      });

    this.logger.log(`Post-call analysis stored for call ${callId}`);
  }

  // ── Private: context loading ────────────────────────────────────────────────

  private async loadContext(callId: string, state: EngineState) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, callId))
      .limit(1);

    if (!call || state.cancelled) return;

    // Agent prompt
    let agentPrompt =
      "Be helpful, professional, and focused on understanding the prospect's needs.";
    if (call.agentId) {
      const [agent] = await this.db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, call.agentId))
        .limit(1);
      if (agent) agentPrompt = agent.prompt;
    }

    // Playbook stages — call's playbook → org default → FALLBACK_STAGES
    let stages: StageInfo[] = FALLBACK_STAGES;
    const pbId = call.playbookId ?? (await this.fetchDefaultPlaybookId(call.orgId));

    if (pbId) {
      const dbStages = await this.db
        .select()
        .from(schema.playbookStages)
        .where(eq(schema.playbookStages.playbookId, pbId))
        .orderBy(asc(schema.playbookStages.position));

      if (dbStages.length > 0) {
        stages = dbStages.map((s) => ({
          name: s.name,
          goals: s.goals ?? null,
          checklist: Array.isArray(s.checklistJson) ? (s.checklistJson as string[]) : [],
        }));
      }
    }

    if (state.cancelled) return;

    state.context = {
      callId,
      guidanceLevel: call.guidanceLevel,
      agentPrompt,
      notes: call.notes ?? null,
      stages,
    };

    // Init checklist from first stage
    const firstChecklist = stages[0]?.checklist ?? [];
    if (firstChecklist.length) {
      state.checklistState = firstChecklist.map((label) => ({ label, done: false }));
    }

    // Emit initial stage
    this.gateway.emitToCall(callId, 'engine.stage', {
      stageIdx: 0,
      stageName: stages[0]?.name ?? 'Opening',
    });

    this.logger.log(
      `Engine context loaded — call ${callId}, ${stages.length} stages, guidance: ${call.guidanceLevel}`,
    );
  }

  private async fetchDefaultPlaybookId(orgId: string): Promise<string | null> {
    const [pb] = await this.db
      .select()
      .from(schema.playbooks)
      .where(and(eq(schema.playbooks.orgId, orgId), eq(schema.playbooks.isDefault, true)))
      .limit(1);
    return pb?.id ?? null;
  }

  // ── Private: engine tick ────────────────────────────────────────────────────

  private async runEngineTick(callId: string, state: EngineState) {
    if (!state.context || state.cancelled) return;

    state.lastLlmCallAt = Date.now();
    state.llmCallCount++;

    if (this.llm.available && state.transcriptBuffer.length > 0) {
      await this.runLlmTick(callId, state);
    } else {
      this.runStubTick(callId, state);
    }
  }

  private async runLlmTick(callId: string, state: EngineState) {
    const context = state.context;
    if (!context) return;
    const currentStage = context.stages[state.currentStageIdx] ?? context.stages[0];
    if (!currentStage) return;

    const stageList = context.stages
      .map((s, i) => `${i + 1}. ${s.name}${s.goals ? ` — ${s.goals}` : ''}`)
      .join('\n');

    const checklistItems = state.checklistState.map((i) => i.label);

    const recentTurns = state.transcriptBuffer
      .slice(-15)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');

    const systemPrompt = this.buildSystemPrompt(context, currentStage, stageList, checklistItems);
    const userPrompt = `Transcript:\n${recentTurns}\n\nProvide the JSON coaching output now.`;

    try {
      const raw = await this.llm.chat(systemPrompt, userPrompt);
      this.logger.debug(`LLM tick (${callId}): ${raw.slice(0, 180)}`);

      const parsed = this.llm.parseJson<{
        stage?: string;
        suggestion?: string;
        nudges?: string[];
        checklistUpdates?: Record<string, boolean>;
      }>(raw, {});

      this.applyStageVote(callId, state, parsed.stage);

      if (parsed.suggestion?.trim()) {
        this.gateway.emitToCall(callId, 'engine.primary_suggestion', {
          text: parsed.suggestion.trim(),
          tsMs: Date.now(),
        });
      }

      const nudges = (parsed.nudges ?? []).filter((n) => ALLOWED_NUDGES.includes(n)).slice(0, 3);
      this.gateway.emitToCall(callId, 'engine.nudges', { nudges });

      if (context.guidanceLevel === 'GUIDED' && parsed.checklistUpdates) {
        state.checklistState = state.checklistState.map((item) =>
          parsed.checklistUpdates![item.label] !== undefined
            ? { ...item, done: parsed.checklistUpdates![item.label] }
            : item,
        );
        this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
      }
    } catch (err) {
      this.logger.error(`LLM tick error (${callId}): ${(err as Error).message}`);
      this.runStubTick(callId, state);
    }
  }

  private runStubTick(callId: string, state: EngineState) {
    const n = state.llmCallCount;
    const context = state.context;
    const guidanceLevel = context?.guidanceLevel ?? 'STANDARD';
    const stages = context?.stages ?? FALLBACK_STAGES;

    // Advance stage every 4 stub ticks
    if (n % 4 === 0 && n > 0 && state.currentStageIdx < stages.length - 1) {
      state.currentStageIdx++;
      const stageName = stages[state.currentStageIdx]?.name ?? '';
      this.gateway.emitToCall(callId, 'engine.stage', {
        stageIdx: state.currentStageIdx,
        stageName,
      });
    }

    this.gateway.emitToCall(callId, 'engine.primary_suggestion', {
      text: STUB_SUGGESTIONS[n % STUB_SUGGESTIONS.length],
      tsMs: Date.now(),
    });

    if (guidanceLevel !== 'MINIMAL') {
      this.gateway.emitToCall(callId, 'engine.nudges', {
        nudges: [STUB_NUDGES[n % STUB_NUDGES.length]],
      });
    } else {
      this.gateway.emitToCall(callId, 'engine.nudges', { nudges: [] });
    }

    if (guidanceLevel === 'GUIDED' && state.checklistState.length > 0) {
      const doneCount = Math.min(Math.floor(n / 2), state.checklistState.length);
      state.checklistState = state.checklistState.map((item, i) => ({
        ...item,
        done: i < doneCount,
      }));
      this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
    }
  }

  private emitStubTranscript(callId: string, state: EngineState) {
    state.stubTick++;
    const t = state.stubTick;

    if (t % 2 === 1) {
      this.gateway.emitToCall(callId, 'transcript.partial', {
        speaker: t % 6 < 3 ? 'REP' : 'PROSPECT',
        text: `Speaking…`,
        tsMs: Date.now(),
      });
    }

    if (t % 5 === 0) {
      const isRep = t % 10 < 5;
      const speaker = isRep ? 'REP' : 'PROSPECT';
      const lines = isRep ? STUB_TRANSCRIPT_REP : STUB_TRANSCRIPT_PROSPECT;
      const text = lines[Math.floor(t / 5) % lines.length]!;

      state.transcriptBuffer.push({ speaker, text });
      if (state.transcriptBuffer.length > 25) state.transcriptBuffer.shift();

      this.gateway.emitToCall(callId, 'transcript.final', {
        speaker,
        text,
        tsMs: Date.now(),
        isFinal: true,
      });
    }
  }

  // ── Private: stage hysteresis ───────────────────────────────────────────────

  private applyStageVote(callId: string, state: EngineState, votedStageName?: string) {
    if (!votedStageName || !state.context) return;

    const stages = state.context.stages;
    const votedIdx = stages.findIndex((s) => s.name === votedStageName);
    if (votedIdx <= state.currentStageIdx) {
      // No regression — reset vote streak
      state.stageVoteCount = 0;
      return;
    }

    // New forward vote
    if (votedIdx === state.stageVoteForIdx) {
      state.stageVoteCount++;
    } else {
      state.stageVoteForIdx = votedIdx;
      state.stageVoteCount = 1;
    }

    // Advance only after 2 consecutive votes for the same stage
    if (state.stageVoteCount >= 2) {
      state.currentStageIdx = Math.min(votedIdx, stages.length - 1);
      state.stageVoteCount = 0;

      const newStage = stages[state.currentStageIdx]!;
      this.gateway.emitToCall(callId, 'engine.stage', {
        stageIdx: state.currentStageIdx,
        stageName: newStage.name,
      });

      // Update checklist for new stage
      if (newStage.checklist.length) {
        state.checklistState = newStage.checklist.map((label) => ({ label, done: false }));
      }

      this.logger.log(`Stage → "${newStage.name}" for call ${callId}`);
    }
  }

  // ── Private: post-call ──────────────────────────────────────────────────────

  private async buildPostCallResult(
    callId: string,
    transcript: TurnLine[],
    checklistItems: string[],
    notes: string | null,
  ) {
    const repLines = transcript.filter((t) => t.speaker === 'REP').length;
    const total = transcript.length || 1;
    const talkRatio = {
      rep: Math.round((repLines / total) * 100) / 100,
      prospect: Math.round(((total - repLines) / total) * 100) / 100,
    };
    const questionCount = transcript.filter(
      (t) => t.speaker === 'REP' && t.text.includes('?'),
    ).length;

    // Stub checklist results (LLM will override if available)
    const checklistResultsJson: Record<string, boolean> = {};
    checklistItems.forEach((label) => {
      checklistResultsJson[label] = false;
    });

    if (!this.llm.available || transcript.length < 3) {
      return {
        summaryJson: {
          summary:
            transcript.length < 3
              ? 'Call was too short to generate a meaningful summary.'
              : 'Call completed. Set LLM_PROVIDER=openai + LLM_API_KEY for AI coaching.',
          keyMoments: [],
        },
        coachingJson: { talkRatio, questionCount, strengths: [], improvements: [], score: null },
        checklistResultsJson,
      };
    }

    const transcriptText = transcript
      .slice(-60)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');

    const checklistSection =
      checklistItems.length > 0
        ? `\n\nAlso fill "checklistResults" — an object mapping each of these items to true/false based on the transcript: ${checklistItems.join(', ')}`
        : '';

    const systemPrompt =
      `You are a sales coaching analyst. Review this completed call transcript and provide structured feedback.\n` +
      `Call notes: ${notes ?? 'None'}\n` +
      `Talk ratio — REP: ${Math.round(talkRatio.rep * 100)}%, PROSPECT: ${Math.round(talkRatio.prospect * 100)}%. Questions asked by REP: ${questionCount}.\n` +
      `Respond with ONLY valid JSON: ` +
      `{"summary":"string","keyMoments":["string"],"coaching":{"strengths":["string"],"improvements":["string"],"score":number},"checklistResults":{}}${checklistSection}`;

    const userPrompt = `Transcript:\n${transcriptText}`;

    try {
      const raw = await this.llm.chat(systemPrompt, userPrompt);
      const parsed = this.llm.parseJson<{
        summary?: string;
        keyMoments?: string[];
        coaching?: { strengths?: string[]; improvements?: string[]; score?: number };
        checklistResults?: Record<string, boolean>;
      }>(raw, {});

      // Merge LLM checklist results
      if (parsed.checklistResults) {
        Object.assign(checklistResultsJson, parsed.checklistResults);
      }

      return {
        summaryJson: {
          summary: parsed.summary ?? '',
          keyMoments: parsed.keyMoments ?? [],
        },
        coachingJson: {
          talkRatio,
          questionCount,
          strengths: parsed.coaching?.strengths ?? [],
          improvements: parsed.coaching?.improvements ?? [],
          score: parsed.coaching?.score ?? null,
        },
        checklistResultsJson,
      };
    } catch (err) {
      this.logger.error(`Post-call LLM error (${callId}): ${(err as Error).message}`);
      return {
        summaryJson: { summary: 'Post-call analysis failed.', keyMoments: [] },
        coachingJson: { talkRatio, questionCount, strengths: [], improvements: [], score: null },
        checklistResultsJson,
      };
    }
  }

  // ── Private: prompt builder ─────────────────────────────────────────────────

  private buildSystemPrompt(
    context: CallContext,
    currentStage: StageInfo,
    stageList?: string,
    checklistItems?: string[],
  ): string {
    const stages = context.stages;
    const list =
      stageList ??
      stages.map((s, i) => `${i + 1}. ${s.name}${s.goals ? ` — ${s.goals}` : ''}`).join('\n');

    let nudgeRule: string;
    if (context.guidanceLevel === 'MINIMAL') {
      nudgeRule = '- "nudges": always empty array []\n';
    } else if (context.guidanceLevel === 'GUIDED') {
      nudgeRule = '- "nudges": 1–3 items from the allowed list\n';
    } else {
      nudgeRule = '- "nudges": 0–2 items from the allowed list\n';
    }

    const checklistRule =
      context.guidanceLevel === 'GUIDED' && checklistItems?.length
        ? `- "checklistUpdates": object mapping these items to true if completed: ${checklistItems.join(', ')}\n`
        : '- "checklistUpdates": empty object {}\n';

    return (
      `You are a real-time AI sales coach assisting a sales rep on a live call.\n\n` +
      `Agent persona: ${context.agentPrompt}\n\n` +
      `Playbook stages (advance only, never go back):\n${list}\n\n` +
      `Currently at stage: "${currentStage.name}"\n` +
      `Call notes: ${context.notes ?? 'None'}\n` +
      `Guidance level: ${context.guidanceLevel}\n\n` +
      `Respond with ONLY a JSON object (no markdown). Rules:\n` +
      `- "stage": current stage name — one of the listed stages, only advance forward\n` +
      `- "suggestion": one sentence the REP should say next (max 15 words, natural, no filler)\n` +
      nudgeRule +
      `  Allowed nudges: ASK_QUESTION, ADDRESS_OBJECTION, TOO_MUCH_TALKING, MISSING_NEXT_STEP, SOFTEN_TONE, SLOW_DOWN, CONFIRM_UNDERSTANDING\n` +
      checklistRule +
      `\nExample: {"stage":"Discovery","suggestion":"What does your current process look like?","nudges":["ASK_QUESTION"],"checklistUpdates":{}}`
    );
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { ProductsMode } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsGateway } from './calls.gateway';
import { LlmService } from './llm.service';
import { PROFESSIONAL_SALES_CALL_AGENT_PROMPT } from './professional-sales-agent.prompt';
import { EMPTY_COMPANY_PROFILE_DEFAULTS } from '../org/company-profile.defaults';

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
  companyProfile: CompanyProfile;
  productContext: ProductContext;
};

type CompanyProfile = typeof EMPTY_COMPANY_PROFILE_DEFAULTS;

type TurnLine = { speaker: string; text: string; tsMs: number };

type ProductContext = {
  mode: ProductsMode;
  names: string[];
  summary: string;
  snippets: string[];
};

type ProductRecord = {
  id: string;
  name: string;
  elevatorPitch: string | null;
  valueProps: unknown;
  differentiators: unknown;
  pricingRules: unknown;
  dontSay: unknown;
  faqs: unknown;
  objections: unknown;
};

type CallStats = {
  repTurns: number;
  prospectTurns: number;
  repQuestions: number;
  repWords: number;
  prospectWords: number;
  objectionDetected: string | null;
  sentiment: 'positive' | 'neutral' | 'negative';
  talkRatioRep: number;
};

type EngineTickPayload = {
  suggestions: string[];
  nudges: string[];
  cards: string[];
  objection: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  checklistUpdates: Record<string, boolean>;
};

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
  llmInFlight: boolean;
  avgLlmLatencyMs: number;
  suggestionCountTarget: 1 | 3;
  stats: CallStats;
  prospectSpeaking: boolean;
  pendingTickPayload: EngineTickPayload | null;
  stubTick: number;
  stubInterval: ReturnType<typeof setInterval> | null;
  llmInterval: ReturnType<typeof setInterval> | null;
};

type RagSnippet = {
  field: keyof CompanyProfile;
  text: string;
  score: number;
};

// ─── Stubs / constants ────────────────────────────────────────────────────────

const FALLBACK_STAGES: StageInfo[] = [
  {
    name: 'Opening',
    goals: 'Introduce, get permission, and set context quickly.',
    checklist: [
      'Introduce yourself and company',
      'Confirm now is a good time',
      'State purpose with one concrete value point',
      'Ask one opening discovery question',
    ],
  },
  {
    name: 'Discovery',
    goals: 'Understand current process, pain, impact, and timeline.',
    checklist: [
      'Ask how they handle listing media today',
      'Identify the biggest friction in their current workflow',
      'Quantify impact of delays or inconsistency',
      'Confirm timeline for the next listing',
      'Clarify who else is involved in decisions',
    ],
  },
  {
    name: 'Value Framing',
    goals: 'Map the offer directly to the discovered pain.',
    checklist: [
      'Recap their pain in their own words',
      'Tie one service to one stated pain',
      'Share one numeric proof point',
      'Confirm the proposed approach is relevant',
    ],
  },
  {
    name: 'Objection Handling',
    goals: 'Resolve blockers with evidence, not pressure.',
    checklist: [
      'Acknowledge objection without arguing',
      'Ask one clarifying question',
      'Respond with specific evidence',
      'Confirm if the concern is addressed',
    ],
  },
  {
    name: 'Next Step',
    goals: 'Secure a clear, low-friction next action.',
    checklist: [
      'Propose one concrete next step',
      'Offer two scheduling options',
      'Confirm owner and timeline',
      'Confirm follow-up channel',
    ],
  },
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

const FIELD_LABELS: Record<keyof CompanyProfile, string> = {
  companyName: 'Company',
  productName: 'Product',
  productSummary: 'Product Summary',
  idealCustomerProfile: 'Ideal Customer',
  valueProposition: 'Value Proposition',
  differentiators: 'Differentiators',
  proofPoints: 'Proof Points',
  repTalkingPoints: 'Rep Talking Points',
  discoveryGuidance: 'Discovery Guidance',
  qualificationGuidance: 'Qualification Guidance',
  objectionHandling: 'Objection Handling',
  competitorGuidance: 'Competitor Guidance',
  pricingGuidance: 'Pricing Guidance',
  implementationGuidance: 'Implementation Guidance',
  faq: 'FAQ',
  doNotSay: 'Do Not Say',
};

const FIELD_BOOSTS_BY_OBJECTION: Record<string, Array<keyof CompanyProfile>> = {
  BUDGET: ['pricingGuidance', 'proofPoints', 'valueProposition', 'objectionHandling'],
  COMPETITOR: ['competitorGuidance', 'differentiators', 'proofPoints', 'objectionHandling'],
  TIMING: ['implementationGuidance', 'valueProposition', 'qualificationGuidance', 'objectionHandling'],
  NO_NEED: ['discoveryGuidance', 'valueProposition', 'proofPoints', 'objectionHandling'],
  AUTHORITY: ['qualificationGuidance', 'discoveryGuidance', 'objectionHandling'],
};

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'is',
  'are',
  'to',
  'of',
  'for',
  'with',
  'on',
  'in',
  'at',
  'this',
  'that',
  'it',
  'we',
  'you',
  'they',
  'our',
  'their',
  'be',
  'as',
  'if',
  'by',
  'from',
  'can',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'would',
  'should',
  'could',
  'not',
  'no',
  'yes',
  'about',
  'just',
  'very',
  'really',
]);

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
      llmInFlight: false,
      avgLlmLatencyMs: 0,
      suggestionCountTarget: 1,
      stats: {
        repTurns: 0,
        prospectTurns: 0,
        repQuestions: 0,
        repWords: 0,
        prospectWords: 0,
        objectionDetected: null,
        sentiment: 'neutral',
        talkRatioRep: 50,
      },
      prospectSpeaking: false,
      pendingTickPayload: null,
      stubTick: 0,
      stubInterval: null,
      llmInterval: null,
    };

    this.engines.set(callId, state);

    // Load context + emit opening suggestions
    this.loadContext(callId, state).catch((err: Error) =>
      this.logger.error(`Engine context load failed (${callId}): ${err.message}`),
    );

    // Stub transcript for dev mode
    if (stubTranscript) {
      state.stubInterval = setInterval(() => this.emitStubTranscript(callId, state), 2000);
    }

    // Fallback interval — only fires if no transcript-triggered ticks happen
    state.llmInterval = setInterval(() => {
      if (!state.llmInFlight && Date.now() - state.lastLlmCallAt > 15_000) {
        this.runEngineTick(callId, state).catch((err: Error) =>
          this.logger.error(`Engine tick error (${callId}): ${err.message}`),
        );
      }
    }, 15_000);

    this.logger.log(`Engine started — call ${callId}, stubTranscript=${stubTranscript}`);
  }

  async refreshContext(callId: string) {
    const state = this.engines.get(callId);
    if (!state || state.cancelled || !state.context) return;
    await this.refreshDynamicContext(callId, state, true);
  }

  /**
   * Push a final transcript line. Triggers LLM immediately when PROSPECT finishes.
   * When PROSPECT starts talking, signals UI to dim suggestions.
   */
  pushTranscript(callId: string, speaker: string, text: string) {
    const state = this.engines.get(callId);
    if (!state) return;

    const tsMs = Date.now();
    state.transcriptBuffer.push({ speaker, text, tsMs });
    if (state.transcriptBuffer.length > 30) state.transcriptBuffer.shift();

    // Update live stats
    if (speaker === 'REP') {
      state.stats.repTurns++;
      state.stats.repWords += this.countWords(text);
      if (text.includes('?')) state.stats.repQuestions++;
    } else {
      state.stats.prospectTurns++;
      state.stats.prospectWords += this.countWords(text);
      // Detect objections
      const lower = text.toLowerCase();
      if (lower.includes('expensive') || lower.includes('budget') || lower.includes('cost') || lower.includes('price')) {
        state.stats.objectionDetected = 'BUDGET';
      } else if (lower.includes('competitor') || lower.includes('already using') || lower.includes('other solution')) {
        state.stats.objectionDetected = 'COMPETITOR';
      } else if (lower.includes('not now') || lower.includes('timing') || lower.includes('later') || lower.includes('next quarter')) {
        state.stats.objectionDetected = 'TIMING';
      } else if (lower.includes('not interested') || lower.includes("don't need") || lower.includes('no need')) {
        state.stats.objectionDetected = 'NO_NEED';
      } else if (lower.includes('check with') || lower.includes('talk to my') || lower.includes('decision maker')) {
        state.stats.objectionDetected = 'AUTHORITY';
      }
      // Detect sentiment
      if (lower.includes('interested') || lower.includes('sounds good') || lower.includes('like that') || lower.includes('tell me more')) {
        state.stats.sentiment = 'positive';
      } else if (lower.includes('not sure') || lower.includes("don't think") || lower.includes('concerned') || lower.includes('worried')) {
        state.stats.sentiment = 'negative';
      }
    }

    // Update talk ratio based on words, not turn count
    const totalWords = state.stats.repWords + state.stats.prospectWords;
    state.stats.talkRatioRep =
      totalWords > 0 ? Math.round((state.stats.repWords / totalWords) * 100) : 50;

    // Emit live stats
    this.gateway.emitToCall(callId, 'engine.stats', { stats: state.stats });

    // Deterministic checklist completion from turn content.
    this.maybeMarkChecklistFromTurn(callId, state, speaker, text);

    // When PROSPECT finishes a turn → trigger suggestions immediately
    if (speaker === 'PROSPECT') {
      state.prospectSpeaking = false;
      this.gateway.emitToCall(callId, 'engine.prospect_speaking', { speaking: false });

      // If we precomputed suggestions while listening, release them instantly now.
      if (state.pendingTickPayload) {
        this.emitTickPayload(callId, state, state.pendingTickPayload);
        state.pendingTickPayload = null;
        // Do not immediately trigger another tick for the same prospect turn.
        return;
      }

      const msSinceLastLlm = Date.now() - state.lastLlmCallAt;
      if (msSinceLastLlm < 500) {
        return;
      }

      // Trigger LLM immediately — no debounce for prospect finish
      if (!state.llmInFlight) {
        this.runEngineTick(callId, state).catch((err: Error) =>
          this.logger.error(`Engine tick (prospect-finish) error (${callId}): ${err.message}`),
        );
      }
    }
  }

  /**
   * Signal that a speaker started talking (partial transcript).
   * Used to dim/hide suggestions while prospect is speaking.
   */
  signalSpeaking(callId: string, speaker: string) {
    const state = this.engines.get(callId);
    if (!state) return;
    if (speaker === 'PROSPECT' && !state.prospectSpeaking) {
      state.prospectSpeaking = true;
      this.gateway.emitToCall(callId, 'engine.prospect_speaking', { speaking: true });
    }
  }

  stop(callId: string) {
    const state = this.engines.get(callId);
    if (!state) return;
    state.cancelled = true;
    if (state.stubInterval) clearInterval(state.stubInterval);
    if (state.llmInterval) clearInterval(state.llmInterval);
    this.engines.delete(callId);
    this.logger.log(`Engine stopped — call ${callId}`);
  }

  async getAlternatives(callId: string): Promise<{ texts: string[] }> {
    const state = this.engines.get(callId);
    const desiredCount: 1 | 3 = 1;
    const fallbackFromState =
      state?.context
        ? this.buildStageFallbackSuggestions(
            state.context.companyProfile,
            state.context.productContext,
            state.context.stages[state.currentStageIdx]?.name ?? 'Opening',
            state.stats.objectionDetected,
          ).slice(0, desiredCount)
        : null;
    const stubAlts = (fallbackFromState ?? [
      'Is now a bad time, or do you have 90 seconds for context?',
    ]).slice(0, desiredCount);

    if (!this.llm.available || !state?.context) {
      this.gateway.emitToCall(callId, 'engine.suggestions', {
        suggestions: stubAlts,
        tsMs: Date.now(),
      });
      return { texts: stubAlts };
    }

    const { context } = state;
    const currentStage = context.stages[state.currentStageIdx] ?? context.stages[0];
    const stageList = context.stages
      .map((s, i) => `${i + 1}. ${s.name}${s.goals ? ` — ${s.goals}` : ''}`)
      .join('\n');
    const recentTurns = state.transcriptBuffer
      .slice(-10)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');
    const lastProspectLine =
      [...state.transcriptBuffer].reverse().find((t) => t.speaker === 'PROSPECT')?.text ?? '';
    const ragSnippets = this.retrieveCompanySnippets(
      context.companyProfile,
      recentTurns,
      state.stats.objectionDetected,
    );

    const systemPrompt = this.buildSystemPrompt(
      context,
      currentStage!,
      stageList,
      [],
      ragSnippets,
      desiredCount,
    );
    const userPrompt =
      (recentTurns ? `Transcript:\n${recentTurns}\n\n` : '') +
      (lastProspectLine ? `Last prospect line (answer this first): ${lastProspectLine}\n\n` : '') +
      `Generate exactly ${desiredCount} alternative things the REP could say next. Each should be different in approach. ` +
      `Respond with JSON only: {"suggestions": [${desiredCount === 1 ? '"option 1"' : '"option 1", "option 2", "option 3"'}]}`;

    try {
      const raw = await this.llm.chatFast(systemPrompt, userPrompt);
      const parsed = this.llm.parseJson<{ suggestions?: string[] }>(raw, {});
      const texts = this.normalizeSuggestions(
        parsed.suggestions ?? [],
        context.companyProfile,
        context.productContext,
        currentStage?.name ?? 'Opening',
        state.stats.objectionDetected,
        desiredCount,
        lastProspectLine,
      );
      this.gateway.emitToCall(callId, 'engine.suggestions', {
        suggestions: texts,
        tsMs: Date.now(),
      });
      return { texts };
    } catch (err) {
      this.logger.error(`getAlternatives LLM error (${callId}): ${(err as Error).message}`);
      this.gateway.emitToCall(callId, 'engine.suggestions', {
        suggestions: stubAlts,
        tsMs: Date.now(),
      });
      return { texts: stubAlts };
    }
  }

  async promptDebug(
    orgId: string,
    input: {
      transcript: string;
      agentId?: string;
      products_mode?: 'ALL' | 'SELECTED';
      selected_product_ids?: string[];
      guidance_level?: 'MINIMAL' | 'STANDARD' | 'GUIDED';
      notes?: string;
    },
  ) {
    const transcript = input.transcript.trim();
    if (!transcript) {
      return {
        output: {
          primarySuggestion: '',
          suggestions: [],
          nudges: [],
          cards: [],
          objection: null,
          sentiment: 'neutral',
        },
        systemPrompt: '',
        userPrompt: '',
        llmAvailable: this.llm.available,
      };
    }

    const mode =
      input.products_mode === ProductsMode.SELECTED
        ? ProductsMode.SELECTED
        : ProductsMode.ALL;
    const selectedIds = Array.isArray(input.selected_product_ids)
      ? Array.from(
          new Set(
            input.selected_product_ids
              .map((id) => (typeof id === 'string' ? id.trim() : ''))
              .filter((id) => id.length > 0),
          ),
        )
      : [];

    const [companyProfile, productContext, agentPrompt] = await Promise.all([
      this.fetchCompanyProfile(orgId),
      this.fetchProductContextForDebug(orgId, mode, selectedIds),
      this.resolveDebugAgentPrompt(orgId, input.agentId),
    ]);

    const context: CallContext = {
      callId: 'prompt-debug',
      guidanceLevel: input.guidance_level ?? 'STANDARD',
      agentPrompt,
      notes: input.notes ?? null,
      stages: FALLBACK_STAGES,
      companyProfile,
      productContext,
    };
    const currentStage = FALLBACK_STAGES[1] ?? FALLBACK_STAGES[0]!;
    const stageList = FALLBACK_STAGES.map(
      (s, i) => `${i + 1}. ${s.name}${s.goals ? ` — ${s.goals}` : ''}`,
    ).join('\n');
    const ragSnippets = this.retrieveCompanySnippets(companyProfile, transcript, null);
    const systemPrompt = this.buildSystemPrompt(
      context,
      currentStage,
      stageList,
      currentStage.checklist,
      ragSnippets,
      1,
    );
    const lastProspectLine = this.extractLastProspectLine(transcript);
    const userPrompt =
      `Transcript:\n${transcript}\n\n` +
      (lastProspectLine
        ? `IMPORTANT — The prospect just said: "${lastProspectLine}"\nRespond directly.\n\n`
        : '') +
      'Provide the JSON coaching output now.';

    if (!this.llm.available) {
      const fallback = this.normalizeSuggestions(
        [],
        companyProfile,
        productContext,
        currentStage.name,
        null,
        1,
        lastProspectLine,
      );
      return {
        llmAvailable: false,
        systemPrompt,
        userPrompt,
        output: {
          primarySuggestion: fallback[0] ?? '',
          suggestions: fallback,
          nudges: [],
          cards: this.buildOpeningContextCards(companyProfile, productContext),
          objection: null,
          sentiment: 'neutral',
        },
      };
    }

    try {
      const raw = await this.llm.chatFast(systemPrompt, userPrompt);
      const parsed = this.llm.parseJson<{
        suggestions?: string[];
        suggestion?: string;
        nudges?: string[];
        objection?: string | null;
        sentiment?: 'positive' | 'neutral' | 'negative';
        supportingData?: string[];
      }>(raw, {});
      const suggestions = this.normalizeSuggestions(
        parsed.suggestions ?? (parsed.suggestion ? [parsed.suggestion] : []),
        companyProfile,
        productContext,
        currentStage.name,
        parsed.objection ?? null,
        1,
        lastProspectLine,
      );
      const nudges = (parsed.nudges ?? [])
        .filter((item) => ALLOWED_NUDGES.includes(item))
        .slice(0, 3);
      const cards = (parsed.supportingData ?? [])
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 4);
      const fallbackCards = this.buildOpeningContextCards(companyProfile, productContext);

      return {
        llmAvailable: true,
        systemPrompt,
        userPrompt,
        raw,
        output: {
          primarySuggestion: suggestions[0] ?? '',
          suggestions,
          nudges,
          cards: cards.length > 0 ? cards : fallbackCards,
          objection: parsed.objection ?? null,
          sentiment:
            parsed.sentiment === 'positive' ||
            parsed.sentiment === 'negative' ||
            parsed.sentiment === 'neutral'
              ? parsed.sentiment
              : 'neutral',
        },
      };
    } catch (error) {
      const fallback = this.normalizeSuggestions(
        [],
        companyProfile,
        productContext,
        currentStage.name,
        null,
        1,
        lastProspectLine,
      );
      return {
        llmAvailable: false,
        systemPrompt,
        userPrompt,
        error: error instanceof Error ? error.message : 'Prompt debug failed',
        output: {
          primarySuggestion: fallback[0] ?? '',
          suggestions: fallback,
          nudges: [],
          cards: this.buildOpeningContextCards(companyProfile, productContext),
          objection: null,
          sentiment: 'neutral',
        },
      };
    }
  }

  async runPostCall(callId: string, notes: string | null, _playbookId: string | null) {
    this.logger.log(`Post-call analysis starting for call ${callId}`);

    const rows = await this.db
      .select()
      .from(schema.callTranscript)
      .where(
        and(eq(schema.callTranscript.callId, callId), eq(schema.callTranscript.isFinal, true)),
      )
      .orderBy(asc(schema.callTranscript.tsMs));

    const transcript = rows.map((r) => ({ speaker: r.speaker, text: r.text, tsMs: r.tsMs }));

    const checklistItems = FALLBACK_STAGES.flatMap((s) => s.checklist);

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
    const call = await this.refreshDynamicContext(callId, state, false);
    if (!call || state.cancelled || !state.context) return;

    const stages: StageInfo[] = state.context.stages;
    const companyProfile = state.context.companyProfile;
    const productContext = state.context.productContext;

    const firstChecklist = stages[0]?.checklist ?? [];
    if (firstChecklist.length) {
      state.checklistState = firstChecklist.map((label) => ({ label, done: false }));
      this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
    }

    // Emit initial stage
    this.gateway.emitToCall(callId, 'engine.stage', {
      stageIdx: 0,
      stageName: stages[0]?.name ?? 'Opening',
    });

    // Emit opening suggestions immediately + delayed re-emit to handle race condition
    // (browser may not have joined the socket room yet)
    const openingSuggestions = this.buildOpeningSuggestions(companyProfile, productContext);
    const openingCards = this.buildOpeningContextCards(companyProfile, productContext);
    const emitOpening = () => {
      if (state.cancelled || state.transcriptBuffer.length > 0) return;
      this.gateway.emitToCall(callId, 'engine.suggestions', {
        suggestions: openingSuggestions,
        tsMs: Date.now(),
      });
      this.gateway.emitToCall(callId, 'engine.context_cards', {
        cards: openingCards,
        objection: null,
      });
      this.gateway.emitToCall(callId, 'engine.stats', { stats: state.stats });
    };
    emitOpening();
    // Re-emit after 500ms and 1500ms to catch late-joining clients
    setTimeout(emitOpening, 500);
    setTimeout(emitOpening, 1500);

    this.logger.log(
      `Engine context loaded — call ${callId}, ${stages.length} stages, guidance: ${call.guidanceLevel}`,
    );
  }

  private async refreshDynamicContext(
    callId: string,
    state: EngineState,
    emitContextCards: boolean,
  ) {
    const [call] = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, callId))
      .limit(1);

    if (!call || state.cancelled) return null;

    let agentPrompt = state.context?.agentPrompt ?? PROFESSIONAL_SALES_CALL_AGENT_PROMPT;
    if (call.agentId) {
      const [agent] = await this.db
        .select({ prompt: schema.agents.prompt })
        .from(schema.agents)
        .where(eq(schema.agents.id, call.agentId))
        .limit(1);
      if (agent?.prompt) {
        agentPrompt = agent.prompt;
      }
    }

    const [companyProfile, productContext] = await Promise.all([
      this.fetchCompanyProfile(call.orgId),
      this.fetchProductContext(call.orgId, call.id, call.productsMode),
    ]);

    if (state.cancelled) return null;

    state.context = {
      callId,
      guidanceLevel: call.guidanceLevel,
      agentPrompt,
      notes: call.notes ?? null,
      stages: state.context?.stages ?? FALLBACK_STAGES,
      companyProfile,
      productContext,
    };

    if (emitContextCards) {
      this.gateway.emitToCall(callId, 'engine.context_cards', {
        cards: this.buildOpeningContextCards(companyProfile, productContext),
        objection: state.stats.objectionDetected,
      });
    }

    return call;
  }

  private parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
      .slice(0, 40);
  }

  private valueToOneLine(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      return value
        .map((entry) => this.valueToOneLine(entry))
        .filter((entry) => entry.length > 0)
        .join('; ');
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => `${key}: ${this.valueToOneLine(entry)}`)
        .filter((entry) => entry.length > 0)
        .join('; ');
    }
    return '';
  }

  private compactText(text: string, max = 180): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1).trimEnd()}...`;
  }

  private buildProductSummary(mode: ProductsMode, products: ProductRecord[]): string {
    if (products.length === 0) {
      return 'No product records are configured for this org.';
    }

    const names = products.map((product) => product.name).slice(0, 8);
    const namesText =
      products.length > names.length
        ? `${names.join(', ')} +${products.length - names.length} more`
        : names.join(', ');
    const topProps = products
      .flatMap((product) =>
        this.parseStringArray(product.valueProps)
          .slice(0, 2)
          .map((prop) => `${product.name}: ${prop}`),
      )
      .slice(0, 4)
      .join(' | ');
    const scope = mode === ProductsMode.SELECTED ? 'Selected products' : 'All products';
    if (!topProps) return `${scope}: ${namesText}.`;
    return `${scope}: ${namesText}. Key value points: ${this.compactText(topProps, 280)}`;
  }

  private buildProductSnippets(mode: ProductsMode, products: ProductRecord[]): string[] {
    if (products.length === 0) {
      return ['No product-specific content is available. Use company profile context only.'];
    }

    const scoped = products.slice(0, mode === ProductsMode.SELECTED ? 6 : 8);
    const snippets: string[] = [];

    for (const product of scoped) {
      if (product.elevatorPitch?.trim()) {
        snippets.push(`${product.name} pitch: ${this.compactText(product.elevatorPitch, 180)}`);
      }

      const valueProps = this.parseStringArray(product.valueProps).slice(0, 3);
      if (valueProps.length > 0) {
        snippets.push(`${product.name} value props: ${this.compactText(valueProps.join('; '), 200)}`);
      }

      const differentiators = this.parseStringArray(product.differentiators).slice(0, 2);
      if (differentiators.length > 0) {
        snippets.push(
          `${product.name} differentiators: ${this.compactText(differentiators.join('; '), 200)}`,
        );
      }

      const pricing = this.valueToOneLine(product.pricingRules);
      if (pricing.length > 0) {
        snippets.push(`${product.name} pricing rules: ${this.compactText(pricing, 200)}`);
      }

      const faqs = this.toProductFaqSnippets(product.faqs, product.name);
      snippets.push(...faqs);

      const objections = this.toProductObjectionSnippets(product.objections, product.name);
      snippets.push(...objections);

      const dontSay = this.parseStringArray(product.dontSay).slice(0, 2);
      if (dontSay.length > 0) {
        snippets.push(`${product.name} do-not-say: ${this.compactText(dontSay.join('; '), 180)}`);
      }
    }

    return snippets.slice(0, 18);
  }

  private toProductFaqSnippets(value: unknown, productName: string): string[] {
    if (!Array.isArray(value)) return [];
    const snippets: string[] = [];
    for (const entry of value.slice(0, 4)) {
      if (typeof entry === 'string') {
        const cleaned = entry.trim();
        if (cleaned.length > 0) snippets.push(`${productName} FAQ: ${this.compactText(cleaned, 180)}`);
        continue;
      }
      if (entry && typeof entry === 'object') {
        const row = entry as Record<string, unknown>;
        const question = this.valueToOneLine(row.question ?? row.q ?? '');
        const answer = this.valueToOneLine(row.answer ?? row.a ?? '');
        const line = [question ? `Q: ${question}` : '', answer ? `A: ${answer}` : '']
          .filter((part) => part.length > 0)
          .join(' ');
        if (line.length > 0) snippets.push(`${productName} FAQ: ${this.compactText(line, 180)}`);
      }
    }
    return snippets;
  }

  private toProductObjectionSnippets(value: unknown, productName: string): string[] {
    if (!Array.isArray(value)) return [];
    const snippets: string[] = [];
    for (const entry of value.slice(0, 4)) {
      if (typeof entry === 'string') {
        const cleaned = entry.trim();
        if (cleaned.length > 0) snippets.push(`${productName} objection: ${this.compactText(cleaned, 180)}`);
        continue;
      }
      if (entry && typeof entry === 'object') {
        const row = entry as Record<string, unknown>;
        const objection = this.valueToOneLine(row.objection ?? row.type ?? row.label ?? '');
        const response = this.valueToOneLine(row.response ?? row.answer ?? row.guidance ?? '');
        const line = [objection ? `Objection: ${objection}` : '', response ? `Response: ${response}` : '']
          .filter((part) => part.length > 0)
          .join(' ');
        if (line.length > 0) {
          snippets.push(`${productName} objection handling: ${this.compactText(line, 190)}`);
        }
      }
    }
    return snippets;
  }

  private async fetchOrgProducts(orgId: string): Promise<ProductRecord[]> {
    return this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        elevatorPitch: schema.products.elevatorPitch,
        valueProps: schema.products.valueProps,
        differentiators: schema.products.differentiators,
        pricingRules: schema.products.pricingRules,
        dontSay: schema.products.dontSay,
        faqs: schema.products.faqs,
        objections: schema.products.objections,
      })
      .from(schema.products)
      .where(eq(schema.products.orgId, orgId))
      .orderBy(asc(schema.products.name));
  }

  private async fetchSelectedProducts(orgId: string, callId: string): Promise<ProductRecord[]> {
    return this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        elevatorPitch: schema.products.elevatorPitch,
        valueProps: schema.products.valueProps,
        differentiators: schema.products.differentiators,
        pricingRules: schema.products.pricingRules,
        dontSay: schema.products.dontSay,
        faqs: schema.products.faqs,
        objections: schema.products.objections,
      })
      .from(schema.callProducts)
      .innerJoin(schema.products, eq(schema.callProducts.productId, schema.products.id))
      .where(and(eq(schema.callProducts.callId, callId), eq(schema.products.orgId, orgId)))
      .orderBy(asc(schema.products.name));
  }

  private async fetchProductContext(
    orgId: string,
    callId: string,
    productsModeRaw: string | null | undefined,
  ): Promise<ProductContext> {
    const productsMode =
      productsModeRaw === ProductsMode.SELECTED ? ProductsMode.SELECTED : ProductsMode.ALL;

    const [allProducts, selectedProducts] = await Promise.all([
      this.fetchOrgProducts(orgId),
      productsMode === ProductsMode.SELECTED
        ? this.fetchSelectedProducts(orgId, callId)
        : Promise.resolve([]),
    ]);

    const baselineProducts =
      productsMode === ProductsMode.SELECTED && selectedProducts.length > 0
        ? selectedProducts
        : allProducts;

    return {
      mode: productsMode,
      names: baselineProducts.map((product) => product.name),
      summary: this.buildProductSummary(productsMode, baselineProducts),
      snippets: this.buildProductSnippets(productsMode, baselineProducts),
    };
  }

  private async fetchProductContextForDebug(
    orgId: string,
    mode: ProductsMode,
    selectedProductIds: string[],
  ): Promise<ProductContext> {
    const allProducts = await this.fetchOrgProducts(orgId);
    const selectedSet = new Set(selectedProductIds);
    const selectedProducts =
      mode === ProductsMode.SELECTED
        ? allProducts.filter((product) => selectedSet.has(product.id))
        : [];

    const baselineProducts =
      mode === ProductsMode.SELECTED && selectedProducts.length > 0
        ? selectedProducts
        : allProducts;

    return {
      mode,
      names: baselineProducts.map((product) => product.name),
      summary: this.buildProductSummary(mode, baselineProducts),
      snippets: this.buildProductSnippets(mode, baselineProducts),
    };
  }

  private async resolveDebugAgentPrompt(orgId: string, agentId?: string) {
    if (!agentId) return PROFESSIONAL_SALES_CALL_AGENT_PROMPT;
    const [agent] = await this.db
      .select({ prompt: schema.agents.prompt })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, orgId)))
      .limit(1);
    return agent?.prompt?.trim() ? agent.prompt : PROFESSIONAL_SALES_CALL_AGENT_PROMPT;
  }

  private extractLastProspectLine(transcript: string) {
    const lines = transcript
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!;
      const match = line.match(
        /^(prospect|customer|buyer|client|lead)\s*:\s*(.+)$/i,
      );
      if (match?.[2]) {
        return match[2].trim();
      }
    }
    return lines[lines.length - 1] ?? '';
  }

  private async fetchCompanyProfile(orgId: string): Promise<CompanyProfile> {
    const [profile] = await this.db
      .select()
      .from(schema.orgCompanyProfiles)
      .where(eq(schema.orgCompanyProfiles.orgId, orgId))
      .limit(1);

    if (!profile) {
      return { ...EMPTY_COMPANY_PROFILE_DEFAULTS };
    }

    return {
      companyName: profile.companyName,
      productName: profile.productName,
      productSummary: profile.productSummary,
      idealCustomerProfile: profile.idealCustomerProfile,
      valueProposition: profile.valueProposition,
      differentiators: profile.differentiators,
      proofPoints: profile.proofPoints,
      repTalkingPoints: profile.repTalkingPoints,
      discoveryGuidance: profile.discoveryGuidance,
      qualificationGuidance: profile.qualificationGuidance,
      objectionHandling: profile.objectionHandling,
      competitorGuidance: profile.competitorGuidance,
      pricingGuidance: profile.pricingGuidance,
      implementationGuidance: profile.implementationGuidance,
      faq: profile.faq,
      doNotSay: profile.doNotSay,
    };
  }

  // ── Private: engine tick ────────────────────────────────────────────────────

  private async runEngineTick(callId: string, state: EngineState) {
    if (!state.context || state.cancelled || state.llmInFlight) return;
    if (state.transcriptBuffer.length === 0) return;

    state.llmInFlight = true;
    state.lastLlmCallAt = Date.now();
    state.llmCallCount++;

    try {
      if (this.llm.available && state.transcriptBuffer.length > 0) {
        await this.runLlmTick(callId, state);
      } else if (!state.prospectSpeaking) {
        this.runStubTick(callId, state);
      }
    } finally {
      state.llmInFlight = false;
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
    const ragSnippets = this.retrieveCompanySnippets(
      context.companyProfile,
      recentTurns,
      state.stats.objectionDetected,
    );
    const stageForPrompt = context.stages[state.currentStageIdx] ?? currentStage;
    const desiredCount: 1 | 3 = 1;
    const systemPrompt = this.buildSystemPrompt(
      context,
      stageForPrompt,
      stageList,
      checklistItems,
      ragSnippets,
      desiredCount,
    );
    const lastProspectLine =
      [...state.transcriptBuffer].reverse().find((t) => t.speaker === 'PROSPECT')?.text ?? '';
    const isQuestion = lastProspectLine.includes('?');
    const userPrompt =
      `Transcript:\n${recentTurns}\n\n` +
      (lastProspectLine
        ? `IMPORTANT — The prospect just said: "${lastProspectLine}"\n` +
          (isQuestion
            ? `This is a DIRECT QUESTION. Your suggestion MUST answer this question specifically using data from the company context above. Do NOT give an unrelated statistic or pivot away.\n\n`
            : `Respond directly to what they said. Do NOT give an unrelated statistic.\n\n`)
        : '') +
      `Provide the JSON coaching output now.`;

    try {
      const llmStartedAt = Date.now();
      const raw = await this.llm.chatFast(systemPrompt, userPrompt);
      const llmLatency = Date.now() - llmStartedAt;
      state.avgLlmLatencyMs =
        state.avgLlmLatencyMs === 0
          ? llmLatency
          : Math.round(state.avgLlmLatencyMs * 0.7 + llmLatency * 0.3);
      state.suggestionCountTarget = 1;
      this.logger.debug(`LLM tick (${callId}): ${raw.slice(0, 180)}`);

      const parsed = this.llm.parseJson<{
        stage?: string;
        suggestions?: string[];
        suggestion?: string;
        nudges?: string[];
        objection?: string;
        sentiment?: string;
        supportingData?: string[];
        checklistUpdates?: Record<string, boolean>;
      }>(raw, {});

      void parsed.stage;

      const suggestions = parsed.suggestions ?? (parsed.suggestion ? [parsed.suggestion] : []);
      const normalizedSuggestions = this.normalizeSuggestions(
        suggestions,
        context.companyProfile,
        context.productContext,
        stageForPrompt.name,
        parsed.objection ?? state.stats.objectionDetected,
        desiredCount,
        lastProspectLine,
      );
      const nudges = (parsed.nudges ?? []).filter((n) => ALLOWED_NUDGES.includes(n)).slice(0, 3);
      const supportingData = (parsed.supportingData ?? [])
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .slice(0, 4);
      const fallbackData = ragSnippets
        .slice(0, 4)
        .map((s) => `${FIELD_LABELS[s.field]}: ${s.text}`);
      const productFallback = context.productContext.snippets.slice(0, 3);
      const cardsFromContext = supportingData.length > 0 ? supportingData : fallbackData;
      const cards = [...cardsFromContext, ...productFallback].slice(0, 4);
      const tickPayload: EngineTickPayload = {
        suggestions: normalizedSuggestions,
        nudges,
        cards,
        objection: parsed.objection ?? state.stats.objectionDetected ?? null,
        sentiment:
          parsed.sentiment === 'positive' ||
          parsed.sentiment === 'negative' ||
          parsed.sentiment === 'neutral'
            ? parsed.sentiment
            : null,
        checklistUpdates: parsed.checklistUpdates ?? {},
      };

      if (state.prospectSpeaking) {
        state.pendingTickPayload = tickPayload;
        return;
      }

      this.emitTickPayload(callId, state, tickPayload);
    } catch (err) {
      this.logger.error(`LLM tick error (${callId}): ${(err as Error).message}`);
      this.runStubTick(callId, state);
    }
  }

  private emitTickPayload(callId: string, state: EngineState, payload: EngineTickPayload) {
    this.gateway.emitToCall(callId, 'engine.suggestions', {
      suggestions: payload.suggestions,
      tsMs: Date.now(),
    });

    if (payload.suggestions[0]) {
      this.gateway.emitToCall(callId, 'engine.primary_suggestion', {
        text: payload.suggestions[0],
        tsMs: Date.now(),
      });
    }

    this.gateway.emitToCall(callId, 'engine.nudges', { nudges: payload.nudges });
    this.gateway.emitToCall(callId, 'engine.context_cards', {
      cards: payload.cards,
      objection: payload.objection,
    });

    if (payload.objection) state.stats.objectionDetected = payload.objection;
    if (payload.sentiment) state.stats.sentiment = payload.sentiment;
    this.gateway.emitToCall(callId, 'engine.stats', { stats: state.stats });

    this.applyChecklistUpdates(callId, state, payload.checklistUpdates);
    this.gateway.emitToCall(callId, 'engine.prospect_speaking', { speaking: false });
  }

  private applyChecklistUpdates(
    callId: string,
    state: EngineState,
    rawUpdates: Record<string, boolean>,
  ) {
    if (state.checklistState.length === 0) return;
    const updates = new Map<string, boolean>();

    for (const [key, value] of Object.entries(rawUpdates ?? {})) {
      updates.set(this.normalizeChecklistLabel(key), value);
    }

    let changed = false;
    state.checklistState = state.checklistState.map((item) => {
      const norm = this.normalizeChecklistLabel(item.label);
      let next: boolean | undefined = updates.get(norm);
      if (next === undefined) {
        for (const [k, v] of updates.entries()) {
          if (k.includes(norm) || norm.includes(k)) {
            next = v;
            break;
          }
        }
      }
      if (next !== true || item.done) return item;
      changed = true;
      return { ...item, done: true };
    });

    if (changed) {
      this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
      this.advanceStageIfChecklistCompleted(callId, state);
    }
  }

  private maybeMarkChecklistFromTurn(
    callId: string,
    state: EngineState,
    speaker: string,
    text: string,
  ) {
    if (state.checklistState.length === 0) return;

    let changed = false;
    state.checklistState = state.checklistState.map((item) => {
      if (item.done) return item;
      if (!this.didTurnCompleteChecklistItem(item.label, speaker, text)) return item;
      changed = true;
      return { ...item, done: true };
    });

    if (changed) {
      this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
      this.advanceStageIfChecklistCompleted(callId, state);
    }
  }

  private didTurnCompleteChecklistItem(label: string, speaker: string, text: string): boolean {
    if (speaker !== 'REP') return false;
    const l = label.toLowerCase();
    const isQuestion = text.includes('?');

    if (l.includes('introduce')) {
      return /(?:this is|i'm|i am|from\s+[a-z])/i.test(text);
    }
    if (l.includes('confirm') && l.includes('time')) {
      return /bad time|good time|do you have|got a minute|quick minute|awful time/i.test(text);
    }
    if (l.includes('permission') || l.includes('mind if')) {
      return /mind if|can i ask|okay if i|is it okay/i.test(text);
    }
    if (l.includes('purpose') || l.includes('reason')) {
      return /quick context|calling because|reason for my call|we help/i.test(text);
    }
    if (l.includes('current') || l.includes('today') || l.includes('process') || l.includes('tool')) {
      return isQuestion && /(current|today|how are you|what do you use|process|workflow)/i.test(text);
    }
    if (l.includes('friction') || l.includes('pain') || l.includes('challenge')) {
      return isQuestion && /(pain|frustrat|challenge|break|hardest|issue)/i.test(text);
    }
    if (l.includes('quantify') || l.includes('impact') || l.includes('cost')) {
      return isQuestion && /(how many|what does that cost|missed|impact|time|revenue|ctr|showing)/i.test(text);
    }
    if (l.includes('timeline')) {
      return isQuestion && /(when|this week|this month|this quarter|next listing|timeline)/i.test(text);
    }
    if (l.includes('decision') || l.includes('stakeholder') || l.includes('who else')) {
      return isQuestion && /(who else|decision|besides you|team involved|approv)/i.test(text);
    }
    if (l.includes('budget')) {
      return isQuestion && /(budget|spend|cost|price)/i.test(text);
    }
    if (l.includes('recap')) {
      return /so it sounds like|quick recap|what i'm hearing|you mentioned/i.test(text);
    }
    if (l.includes('service') || l.includes('feature') || l.includes('proof') || l.includes('numeric')) {
      return /\d/.test(text) || /(drone|virtual|turnaround|rating|review|portfolio|package)/i.test(text);
    }
    if (l.includes('acknowledge objection')) {
      return /fair|understand|hear you|valid concern/i.test(text);
    }
    if (l.includes('clarifying')) {
      return isQuestion && /(is it more|which part|to clarify|when you say|what part)/i.test(text);
    }
    if (l.includes('respond with') || l.includes('evidence')) {
      return /\d/.test(text) || /(case|review|rating|on-time|portfolio|results)/i.test(text);
    }
    if (l.includes('concern is addressed')) {
      return isQuestion && /(does that address|does that help|is that fair)/i.test(text);
    }
    if (l.includes('next step') || l.includes('schedule') || l.includes('offer two')) {
      return /(book|schedule|calendar|next step|pilot|15-minute|15 minute|tomorrow|thursday|friday|later this week)/i.test(text);
    }
    if (l.includes('follow-up channel') || l.includes('follow up')) {
      return /(email|text|send over|send details|best email)/i.test(text);
    }
    if (l.includes('owner')) {
      return /(you|your team|who will|owner|point person)/i.test(text);
    }
    return false;
  }

  private normalizeChecklistLabel(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private runStubTick(callId: string, state: EngineState) {
    const n = state.llmCallCount;
    const context = state.context;
    const guidanceLevel = context?.guidanceLevel ?? 'STANDARD';
    const stages = context?.stages ?? FALLBACK_STAGES;
    const desiredCount: 1 | 3 = state.suggestionCountTarget;

    if (n % 4 === 0 && n > 0 && state.currentStageIdx < stages.length - 1) {
      state.currentStageIdx++;
      const stageName = stages[state.currentStageIdx]?.name ?? '';
      this.gateway.emitToCall(callId, 'engine.stage', {
        stageIdx: state.currentStageIdx,
        stageName,
      });
    }

    // Emit 3 stage-aware fallback suggestions
    const companyProfile = context?.companyProfile ?? EMPTY_COMPANY_PROFILE_DEFAULTS;
    const productContext = context?.productContext ?? {
      mode: ProductsMode.ALL,
      names: [companyProfile.productName],
      summary: '',
      snippets: [],
    };
    const stageName = stages[state.currentStageIdx]?.name ?? 'Opening';
    const suggestions = this.buildStageFallbackSuggestions(
      companyProfile,
      productContext,
      stageName,
      state.stats.objectionDetected,
    ).slice(0, desiredCount);
    this.gateway.emitToCall(callId, 'engine.suggestions', {
      suggestions,
      tsMs: Date.now(),
    });
    this.gateway.emitToCall(callId, 'engine.primary_suggestion', {
      text: suggestions[0],
      tsMs: Date.now(),
    });
    this.gateway.emitToCall(callId, 'engine.prospect_speaking', { speaking: false });
    this.gateway.emitToCall(callId, 'engine.context_cards', {
      cards: this.buildOpeningContextCards(companyProfile, productContext),
      objection: state.stats.objectionDetected,
    });

    if (guidanceLevel !== 'MINIMAL') {
      this.gateway.emitToCall(callId, 'engine.nudges', {
        nudges: [STUB_NUDGES[n % STUB_NUDGES.length]!],
      });
    } else {
      this.gateway.emitToCall(callId, 'engine.nudges', { nudges: [] });
    }

    if (state.checklistState.length > 0) {
      const doneCount = Math.min(Math.floor(n / 2), state.checklistState.length);
      state.checklistState = state.checklistState.map((item, i) => ({
        ...item,
        done: i < doneCount,
      }));
      this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
      this.advanceStageIfChecklistCompleted(callId, state);
    }

    this.gateway.emitToCall(callId, 'engine.stats', { stats: state.stats });
  }

  private emitStubTranscript(callId: string, state: EngineState) {
    state.stubTick++;
    const t = state.stubTick;

    if (t % 2 === 1) {
      this.gateway.emitToCall(callId, 'transcript.partial', {
        speaker: t % 6 < 3 ? 'REP' : 'PROSPECT',
        text: `Speaking...`,
        tsMs: Date.now(),
      });
    }

    if (t % 5 === 0) {
      const isRep = t % 10 < 5;
      const speaker = isRep ? 'REP' : 'PROSPECT';
      const lines = isRep ? STUB_TRANSCRIPT_REP : STUB_TRANSCRIPT_PROSPECT;
      const text = lines[Math.floor(t / 5) % lines.length]!;

      state.transcriptBuffer.push({ speaker, text, tsMs: Date.now() });
      if (state.transcriptBuffer.length > 30) state.transcriptBuffer.shift();

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
      state.stageVoteCount = 0;
      return;
    }

    if (votedIdx === state.stageVoteForIdx) {
      state.stageVoteCount++;
    } else {
      state.stageVoteForIdx = votedIdx;
      state.stageVoteCount = 1;
    }

    if (state.stageVoteCount >= 2) {
      this.moveToStage(callId, state, votedIdx);
      state.stageVoteCount = 0;
    }
  }

  private maybeAdvanceStageFromHeuristics(callId: string, state: EngineState, recentTurns: string) {
    if (!state.context) return;
    const text = recentTurns.toLowerCase();
    if (text.length === 0) return;

    const stages = state.context.stages;
    const findIdx = (re: RegExp) => stages.findIndex((s) => re.test(s.name.toLowerCase()));
    const closeIdx = findIdx(/close|next step|commit|book|proposal|agreement|follow[- ]?up/);
    const implementationIdx = findIdx(/implementation|onboard|rollout|setup|delivery/);
    const objectionIdx = findIdx(/objection|risk|concern|blocker|pricing|budget/);
    const solutionIdx = findIdx(/solution|fit|pitch|demo|value|framing/);

    let targetIdx = -1;

    if (/implement|onboard|rollout|integration|go[- ]?live|setup|delivery/.test(text)) {
      targetIdx = implementationIdx >= 0 ? implementationIdx : (closeIdx >= 0 ? closeIdx : state.currentStageIdx + 2);
    } else if (/price|pricing|budget|cost|competitor|already using|not now|timing|too expensive|locked in/.test(text)) {
      targetIdx = objectionIdx >= 0 ? objectionIdx : state.currentStageIdx + 1;
    } else if (/pilot|next week|book|calendar|schedule|proposal|quote|send details|follow up|email me/.test(text)) {
      targetIdx = closeIdx >= 0 ? closeIdx : Math.min(stages.length - 1, state.currentStageIdx + 1);
    } else if (/current process|today|how are you handling|pain|challenge/.test(text) && state.currentStageIdx === 0) {
      const discoveryIdx = findIdx(/discover|discovery/);
      targetIdx = discoveryIdx >= 0 ? discoveryIdx : state.currentStageIdx;
    } else if (/feature|service|package|turnaround|results|outcome|portfolio|proof|rating/.test(text)) {
      targetIdx = solutionIdx >= 0 ? solutionIdx : state.currentStageIdx;
    }

    if (targetIdx > state.currentStageIdx && targetIdx < stages.length) {
      this.moveToStage(callId, state, targetIdx);
    }
  }

  private moveToStage(callId: string, state: EngineState, targetIdx: number) {
    if (!state.context) return;
    const stages = state.context.stages;
    const boundedTarget = Math.min(Math.max(targetIdx, 0), stages.length - 1);
    const nextIdx = Math.min(state.currentStageIdx + 1, boundedTarget);
    if (nextIdx <= state.currentStageIdx) return;

    state.currentStageIdx = nextIdx;
    const newStage = stages[nextIdx]!;
    state.checklistState = newStage.checklist.map((label) => ({ label, done: false }));
    this.gateway.emitToCall(callId, 'engine.stage', {
      stageIdx: nextIdx,
      stageName: newStage.name,
    });
    this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
    this.logger.log(`Stage → "${newStage.name}" for call ${callId}`);
  }

  private advanceStageIfChecklistCompleted(callId: string, state: EngineState) {
    if (!state.context || state.checklistState.length === 0) return;

    const allDone = state.checklistState.every((item) => item.done);
    if (!allDone) return;

    const stages = state.context.stages;
    if (state.currentStageIdx >= stages.length - 1) return;
    this.moveToStage(callId, state, state.currentStageIdx + 1);
  }

  // ── Private: post-call ──────────────────────────────────────────────────────

  private async buildPostCallResult(
    callId: string,
    transcript: { speaker: string; text: string; tsMs: number }[],
    checklistItems: string[],
    notes: string | null,
  ) {
    const repWords = transcript
      .filter((t) => t.speaker === 'REP')
      .reduce((sum, t) => sum + this.countWords(t.text), 0);
    const prospectWords = transcript
      .filter((t) => t.speaker === 'PROSPECT')
      .reduce((sum, t) => sum + this.countWords(t.text), 0);
    const totalWords = Math.max(1, repWords + prospectWords);
    const talkRatio = {
      rep: Math.round((repWords / totalWords) * 100) / 100,
      prospect: Math.round((prospectWords / totalWords) * 100) / 100,
    };
    const questionCount = transcript.filter(
      (t) =>
        t.speaker === 'REP' &&
        (t.text.includes('?') ||
          /^(how|what|when|where|why|who|do|does|did|is|are|can|could|would|will)\b/i.test(
            t.text.trim(),
          )),
    ).length;

    const checklistResultsJson: Record<string, boolean> = {};
    checklistItems.forEach((label) => {
      checklistResultsJson[label] = transcript.some((turn) =>
        this.didTurnCompleteChecklistItem(label, turn.speaker, turn.text),
      );
    });
    const heuristic = this.buildHeuristicPostCallCoaching(
      transcript,
      checklistItems,
      checklistResultsJson,
      questionCount,
      talkRatio.rep,
    );

    if (!this.llm.available || transcript.length < 3) {
      return {
        summaryJson: {
          summary:
            transcript.length < 3
              ? 'Call was too short to generate a meaningful summary.'
              : heuristic.summary,
          keyMoments: heuristic.keyMoments,
        },
        coachingJson: {
          talkRatio,
          questionCount,
          strengths: heuristic.strengths,
          improvements: heuristic.improvements,
          score: heuristic.score,
          nextActions: heuristic.nextActions,
          nextBestLines: heuristic.nextBestLines,
          risks: heuristic.risks,
        },
        checklistResultsJson,
      };
    }

    const firstTs = transcript[0]?.tsMs ?? Date.now();
    const transcriptText = transcript
      .slice(-80)
      .map(
        (t, i) =>
          `L${i + 1} [${this.formatRelativeTimeLabel(t.tsMs, firstTs)}] ${t.speaker}: ${t.text}`,
      )
      .join('\n');

    const checklistSection =
      checklistItems.length > 0
        ? `\n\nAlso fill "checklistResults" as an object mapping each item to true/false based on transcript evidence: ${checklistItems.join(', ')}`
        : '';

    const systemPrompt =
      `You are a strict sales call QA coach. Review this completed transcript and output actionable coaching.\n` +
      `Call notes: ${notes ?? 'None'}\n` +
      `Talk ratio — REP: ${Math.round(talkRatio.rep * 100)}%, PROSPECT: ${Math.round(talkRatio.prospect * 100)}%. Questions asked by REP: ${questionCount}.\n` +
      `Heuristic baseline:\n` +
      `- Summary: ${heuristic.summary}\n` +
      `- Strengths: ${heuristic.strengths.join(' | ') || 'None'}\n` +
      `- Improvements: ${heuristic.improvements.join(' | ') || 'None'}\n` +
      `- Risks: ${heuristic.risks.join(' | ') || 'None'}\n` +
      `Rules:\n` +
      `- Be specific and evidence-based, not generic.\n` +
      `- Improvements must be concrete actions, each in one sentence.\n` +
      `- Next-best lines must sound spoken and be under 18 words.\n` +
      `- Do not invent outcomes, pricing, logos, or guarantees not present in transcript/context.\n` +
      `Respond with ONLY valid JSON: ` +
      `{"summary":"string","keyMoments":["string"],"coaching":{"strengths":["string"],"improvements":["string"],"score":number,"nextActions":["string"],"nextBestLines":["string"],"risks":["string"]},"checklistResults":{}}${checklistSection}`;

    const userPrompt = `Transcript:\n${transcriptText}`;

    try {
      const raw = await this.llm.chat(systemPrompt, userPrompt);
      const parsed = this.llm.parseJson<{
        summary?: string;
        keyMoments?: string[];
        coaching?: {
          strengths?: string[];
          improvements?: string[];
          score?: number;
          nextActions?: string[];
          nextBestLines?: string[];
          risks?: string[];
        };
        checklistResults?: Record<string, boolean>;
      }>(raw, {});

      if (parsed.checklistResults) {
        Object.assign(checklistResultsJson, parsed.checklistResults);
      }

      return {
        summaryJson: {
          summary: parsed.summary?.trim() || heuristic.summary,
          keyMoments:
            this.pickNonEmpty(parsed.keyMoments, 6).length > 0
              ? this.pickNonEmpty(parsed.keyMoments, 6)
              : heuristic.keyMoments,
        },
        coachingJson: {
          talkRatio,
          questionCount,
          strengths: this.pickNonEmpty(parsed.coaching?.strengths, 4, heuristic.strengths),
          improvements: this.pickNonEmpty(
            parsed.coaching?.improvements,
            6,
            heuristic.improvements,
          ),
          score:
            typeof parsed.coaching?.score === 'number' ? parsed.coaching.score : heuristic.score,
          nextActions: this.pickNonEmpty(parsed.coaching?.nextActions, 4, heuristic.nextActions),
          nextBestLines: this.pickNonEmpty(
            parsed.coaching?.nextBestLines,
            3,
            heuristic.nextBestLines,
          ),
          risks: this.pickNonEmpty(parsed.coaching?.risks, 4, heuristic.risks),
        },
        checklistResultsJson,
      };
    } catch (err) {
      this.logger.error(`Post-call LLM error (${callId}): ${(err as Error).message}`);
      return {
        summaryJson: { summary: heuristic.summary, keyMoments: heuristic.keyMoments },
        coachingJson: {
          talkRatio,
          questionCount,
          strengths: heuristic.strengths,
          improvements: heuristic.improvements,
          score: heuristic.score,
          nextActions: heuristic.nextActions,
          nextBestLines: heuristic.nextBestLines,
          risks: heuristic.risks,
        },
        checklistResultsJson,
      };
    }
  }

  private buildHeuristicPostCallCoaching(
    transcript: { speaker: string; text: string; tsMs: number }[],
    checklistItems: string[],
    checklistResults: Record<string, boolean>,
    questionCount: number,
    repTalkRatio: number,
  ) {
    const repLines = transcript.filter((t) => t.speaker === 'REP').map((t) => t.text);
    const prospectLines = transcript
      .filter((t) => t.speaker === 'PROSPECT')
      .map((t) => t.text);
    const repJoined = repLines.join(' ').toLowerCase();
    const prospectJoined = prospectLines.join(' ').toLowerCase();
    const lastRep = repLines[repLines.length - 1]?.toLowerCase() ?? '';

    const askedPermission = /bad time|good time|mind if|can i ask|okay if/i.test(repJoined);
    const askedCurrentProcess = /current process|how are you handling|what are you using|today/i.test(
      repJoined,
    );
    const quantifiedValue = repLines.some((line) => /\d/.test(line));
    const proposedNextStep = /book|schedule|calendar|next step|pilot|send.*details|follow up|email/i.test(
      repJoined,
    );
    const gotPositiveSignal = /(yes|sounds good|send over|interested|review the details|works)/i.test(
      prospectJoined,
    );
    const abruptEnd =
      /(^|\s)bye[.!]?$/.test(lastRep.trim()) &&
      !/(book|schedule|calendar|email|details|follow up)/i.test(lastRep);
    const invalidRatingClaim = repLines.some((line) => {
      const m = line.match(/(\d+(?:\.\d+)?)\s*out of\s*5/i);
      return !!m && Number(m[1]) > 5;
    });

    const strengths: string[] = [];
    const improvements: string[] = [];
    const nextActions: string[] = [];
    const nextBestLines: string[] = [];
    const risks: string[] = [];
    const keyMoments: string[] = [];

    if (quantifiedValue) strengths.push('Used numeric proof points instead of vague claims.');
    if (gotPositiveSignal) strengths.push('Prospect stayed engaged and asked follow-up questions.');
    if (proposedNextStep) strengths.push('A follow-up path was introduced before call end.');

    if (!askedPermission) {
      improvements.push('Open by confirming time availability before pitching.');
      nextBestLines.push('Did I catch you at a bad time, or do you have 90 seconds?');
    }
    if (!askedCurrentProcess) {
      improvements.push('Ask current workflow questions before listing capabilities.');
      nextBestLines.push('How are you handling listing media turnaround today?');
    }
    if (questionCount < 3) {
      improvements.push('Increase discovery depth with one question per turn.');
      nextBestLines.push('What usually delays your listings: scheduling, editing, or vendor coordination?');
    }
    if (!proposedNextStep || !gotPositiveSignal) {
      improvements.push('Close with a specific next step and confirm timing.');
      nextBestLines.push('Would Thursday morning or Friday afternoon be better for a 15-minute package-fit call?');
    }
    if (abruptEnd) {
      improvements.push('Do not end abruptly; confirm follow-up owner and channel first.');
      risks.push('Call ended before confirming ownership of next step.');
    }
    if (invalidRatingClaim) {
      improvements.push('Keep claims consistent and numerically accurate to avoid trust loss.');
      risks.push('Inconsistent claims can reduce credibility.');
    }
    if (repTalkRatio > 0.62) {
      improvements.push('Lower rep talk share by asking short diagnostic questions.');
      risks.push('High rep talk ratio can reduce discovery quality.');
    }
    if (!repLines.some((line) => /(price|cost|budget|package)/i.test(line)) && /price|cost|budget/.test(prospectJoined)) {
      improvements.push('When pricing is raised, answer directly then qualify scope in one short question.');
      nextActions.push('Prepare a standard pricing response tree with qualifiers: property type, size, service mix.');
    }

    const introIdx = transcript.findIndex((t) => t.speaker === 'REP');
    if (introIdx >= 0) {
      keyMoments.push(
        `L${introIdx + 1} ${this.formatRelativeTimeLabel(
          transcript[introIdx]!.tsMs,
          transcript[0]!.tsMs,
        )}: Rep opening.`,
      );
    }
    const pricingIdx = transcript.findIndex(
      (t) => t.speaker === 'PROSPECT' && /(price|cost|pricing|package)/i.test(t.text),
    );
    if (pricingIdx >= 0) {
      keyMoments.push(
        `L${pricingIdx + 1} ${this.formatRelativeTimeLabel(
          transcript[pricingIdx]!.tsMs,
          transcript[0]!.tsMs,
        )}: Prospect asked about pricing.`,
      );
    }
    const nextStepIdx = transcript.findIndex(
      (t) => t.speaker === 'REP' && /(send|book|schedule|next step|calendar|follow up)/i.test(t.text),
    );
    if (nextStepIdx >= 0) {
      keyMoments.push(
        `L${nextStepIdx + 1} ${this.formatRelativeTimeLabel(
          transcript[nextStepIdx]!.tsMs,
          transcript[0]!.tsMs,
        )}: Rep proposed follow-up action.`,
      );
    }

    if (nextActions.length === 0) {
      nextActions.push('Run one roleplay focused on permission-based opening + discovery before value pitch.');
    }
    if (!nextActions.some((x) => /pricing/i.test(x))) {
      nextActions.push('Create a 3-line pricing response that includes one qualifier and one concrete next step.');
    }
    if (!nextActions.some((x) => /close|next step|follow/i.test(x))) {
      nextActions.push('Use a two-option close in every call: two time slots, one follow-up owner.');
    }

    if (checklistItems.length > 0) {
      const doneCount = checklistItems.filter((label) => checklistResults[label]).length;
      if (doneCount / checklistItems.length < 0.45) {
        risks.push('Checklist adherence was low for this call.');
      }
    }

    let score = 5;
    if (askedPermission) score += 1;
    if (askedCurrentProcess) score += 1;
    if (quantifiedValue) score += 1;
    if (proposedNextStep) score += 1;
    if (gotPositiveSignal) score += 1;
    if (questionCount < 2) score -= 1;
    if (abruptEnd) score -= 1;
    if (invalidRatingClaim) score -= 1;
    score = Math.max(1, Math.min(10, score));

    const summary =
      `Rep communicated GTAPhotoPro value and used numeric proof, but discovery depth and close discipline were inconsistent. ` +
      `${proposedNextStep ? 'A follow-up path was introduced' : 'No firm next step was secured'}, and the next call should prioritize permission, diagnostics, and a two-option close.`;

    return {
      summary,
      keyMoments: keyMoments.slice(0, 6),
      strengths: this.pickNonEmpty(strengths, 4, [
        'Clear value proposition was presented.',
      ]),
      improvements: this.pickNonEmpty(improvements, 6, [
        'Ask more discovery questions before pitching.',
      ]),
      nextActions: this.pickNonEmpty(nextActions, 4),
      nextBestLines: this.pickNonEmpty(nextBestLines, 3),
      risks: this.pickNonEmpty(risks, 4),
      score,
    };
  }

  private formatRelativeTimeLabel(tsMs: number, baseTs: number): string {
    const deltaSec = Math.max(0, Math.floor((tsMs - baseTs) / 1000));
    const mm = Math.floor(deltaSec / 60);
    const ss = deltaSec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  private pickNonEmpty(
    values: string[] | undefined,
    limit: number,
    fallback: string[] = [],
  ): string[] {
    const cleaned = (values ?? [])
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    if (cleaned.length > 0) return cleaned.slice(0, limit);
    return fallback.slice(0, limit);
  }

  // ── Private: prompt builder ─────────────────────────────────────────────────

  private buildSystemPrompt(
    context: CallContext,
    currentStage: StageInfo,
    stageList?: string,
    checklistItems?: string[],
    ragSnippets: RagSnippet[] = [],
    suggestionCount: 1 | 3 = 3,
  ): string {
    const stages = context.stages;
    const list =
      stageList ??
      stages.map((s, i) => `${i + 1}. ${s.name}${s.goals ? ` — ${s.goals}` : ''}`).join('\n');
    const company = context.companyProfile;
    const extraAgentGuidance =
      context.agentPrompt.trim() === PROFESSIONAL_SALES_CALL_AGENT_PROMPT.trim()
        ? 'No extra custom guidance.'
        : context.agentPrompt;
    const ragSection =
      ragSnippets.length > 0
        ? ragSnippets
            .slice(0, 8)
            .map((s, i) => `${i + 1}. [${FIELD_LABELS[s.field]}] ${s.text}`)
            .join('\n')
        : 'No additional snippets retrieved.';
    const productModeLabel =
      context.productContext.mode === ProductsMode.SELECTED ? 'SELECTED' : 'ALL';
    const productNames =
      context.productContext.names.length > 0
        ? context.productContext.names.join(', ')
        : 'No products configured';
    const productSummary =
      context.productContext.summary || 'No product summary is currently available.';
    const productSnippetSection =
      context.productContext.snippets.length > 0
        ? context.productContext.snippets
            .slice(0, 12)
            .map((line, index) => `${index + 1}. ${line}`)
            .join('\n')
        : 'No product snippets available.';

    let nudgeRule: string;
    if (context.guidanceLevel === 'MINIMAL') {
      nudgeRule = '- "nudges": always empty array []\n';
    } else if (context.guidanceLevel === 'GUIDED') {
      nudgeRule = '- "nudges": 1-3 items from the allowed list\n';
    } else {
      nudgeRule = '- "nudges": 0-3 items from the allowed list\n';
    }

    const checklistRule =
      checklistItems?.length
        ? `- "checklistUpdates": object mapping these items to true if completed: ${checklistItems.join(', ')}\n`
        : '- "checklistUpdates": empty object {}\n';

    return (
      `You are a real-time AI sales coach. The rep is on a LIVE call RIGHT NOW. Speed matters.\n\n` +
      `${PROFESSIONAL_SALES_CALL_AGENT_PROMPT}\n\n` +
      `Org company context:\n` +
      `- Company: ${company.companyName}\n` +
      `- Product: ${company.productName}\n` +
      `- Product summary: ${company.productSummary}\n` +
      `- ICP: ${company.idealCustomerProfile}\n` +
      `- Differentiators:\n${company.differentiators}\n\n` +
      `Product context baseline:\n` +
      `- Mode: ${productModeLabel}\n` +
      `- Product names: ${productNames}\n` +
      `- Summary: ${productSummary}\n` +
      `- Product snippets:\n${productSnippetSection}\n\n` +
      `Retrieved context snippets for this exact moment:\n${ragSection}\n\n` +
      `Additional coach persona guidance: ${extraAgentGuidance}\n\n` +
      `Default call stages:\n${list}\n\n` +
      `Current stage: "${currentStage.name}"\n` +
      `Call notes: ${context.notes ?? 'None'}\n` +
      `Guidance: ${context.guidanceLevel}\n\n` +
      `Respond ONLY with a JSON object. Rules:\n` +
      `- "stage": current stage name\n` +
      `- "suggestions": array of EXACTLY ${suggestionCount} primary suggestion${suggestionCount === 1 ? '' : 's'} the REP should say next.\n` +
      `\n` +
      `Output contract:\n` +
      `- Return one primary suggestion in 1-2 sentences.\n` +
      `- Return up to 3 nudges.\n` +
      `- Do not hallucinate. If context lacks a fact, state uncertainty and ask a qualifier.\n\n` +
      `CRITICAL SUGGESTION RULES (follow these strictly):\n` +
      `1. READ THE LAST PROSPECT LINE CAREFULLY. Your suggestion MUST directly respond to what they said or asked.\n` +
      `2. If the prospect asked a QUESTION (pricing, features, timeline, etc.), your suggestion must ANSWER that specific question using data from context. Do NOT deflect or pivot to unrelated stats.\n` +
      `3. If the prospect asked about PRICING → give pricing info from context, then qualify scope.\n` +
      `4. If the prospect asked about FEATURES → describe the specific feature they asked about.\n` +
      `5. If the prospect raised a CONCERN → acknowledge it directly, then address it with evidence.\n` +
      `6. If the prospect made a STATEMENT → respond to its content, then ask one diagnostic question.\n` +
      `7. NEVER respond with a generic statistic when the prospect asked a specific question.\n` +
      `8. Keep each suggestion concise and practical. One main point per suggestion.\n` +
      `9. No filler intros ("Great question", "Totally fair", "Absolutely", "Thanks for sharing").\n` +
      `10. Include concrete details from context: numbers, timeframes, service names, packages.\n` +
      `11. If you lack data to answer their question, say so honestly and ask one qualifier.\n` +
      `12. Never invent pricing, guarantees, logos, or statistics not in context.\n` +
      `13. Output in English only.\n` +
      `14. Use product context baseline in every suggestion. If product mode is SELECTED, prioritize only selected products.\n` +
      `\n` +
      `- "supportingData": up to 4 concise factual bullets the rep can cite from the provided company context.\n` +
      `- "objection": if prospect raised an objection, one of: BUDGET, COMPETITOR, TIMING, NO_NEED, AUTHORITY, or null\n` +
      `- "sentiment": prospect mood — "positive", "neutral", or "negative"\n` +
      nudgeRule +
      `  Allowed: ASK_QUESTION, ADDRESS_OBJECTION, TOO_MUCH_TALKING, MISSING_NEXT_STEP, SOFTEN_TONE, SLOW_DOWN, CONFIRM_UNDERSTANDING\n` +
      checklistRule +
      `\nExample when prospect asks about pricing: {"stage":"Value Framing","suggestions":["Packages start at $X for a standard shoot; what property type are you listing?"],"supportingData":["Standard package: 1-hour interior/exterior shoot","Premium: adds drone + virtual tour"],"objection":"BUDGET","sentiment":"neutral","nudges":[],"checklistUpdates":{}}\n` +
      `Example when prospect asks about features: {"stage":"Discovery","suggestions":["We cover interior, exterior, drone, and virtual tours — which matters most for your listings?"],"supportingData":["One-vendor workflow reduces coordination by 38%"],"objection":null,"sentiment":"neutral","nudges":["ASK_QUESTION"],"checklistUpdates":{}}`
    );
  }

  private buildOpeningSuggestions(
    company: CompanyProfile,
    productContext: ProductContext,
  ): string[] {
    const numericProof =
      this
        .splitToSnippets(company.proofPoints)
        .find((line) => /\d/.test(line)) ?? '24-hour turnaround available on standard listings.';
    const productLabel =
      productContext.names[0] || company.productName || 'your service';
    const companyName = company.companyName || 'our team';
    return [
      `Hi, this is ${companyName} about ${productLabel}. Is now a bad time, or do you have 90 seconds? ${numericProof}`,
    ];
  }

  private buildOpeningContextCards(
    company: CompanyProfile,
    productContext: ProductContext,
  ): string[] {
    const proofLines = this.splitToSnippets(company.proofPoints).slice(0, 2);
    const productName = company.productName || 'Service';
    const productSummary = company.productSummary || 'No company summary added yet.';
    const icp = company.idealCustomerProfile || 'No ICP added yet.';
    return [
      `${productName}: ${productSummary}`,
      productContext.summary,
      ...proofLines,
      `ICP: ${icp}`,
    ].slice(0, 4);
  }

  private normalizeSuggestions(
    rawSuggestions: string[],
    company: CompanyProfile,
    productContext: ProductContext,
    stageName: string,
    objection: string | null,
    desiredCount: 1 | 3 = 3,
    lastProspectLine = '',
  ): string[] {
    const stageFallbacks = this.buildStageFallbackSuggestions(
      company,
      productContext,
      stageName,
      objection,
      lastProspectLine,
    );
    const unique = new Set<string>();
    const out: string[] = [];

    for (const raw of rawSuggestions) {
      const next = this.makeSuggestionSpecific(raw, company, stageFallbacks[out.length] ?? stageFallbacks[0]);
      if (!next || unique.has(next)) continue;
      unique.add(next);
      out.push(next);
      if (out.length === desiredCount) return out;
    }

    for (const fallback of stageFallbacks) {
      const next = this.makeSuggestionSpecific(fallback, company, fallback);
      if (!next || unique.has(next)) continue;
      unique.add(next);
      out.push(next);
      if (out.length === desiredCount) return out;
    }

    while (out.length < desiredCount) {
      out.push(
        this.makeSuggestionSpecific(
          'Can we book 15 minutes this week to map your next listing?',
          company,
          stageFallbacks[0] ?? '24-hour turnaround on standard listing photos.',
        ),
      );
    }

    return out.slice(0, desiredCount);
  }

  private buildStageFallbackSuggestions(
    company: CompanyProfile,
    productContext: ProductContext,
    stageName: string,
    objection: string | null,
    lastProspectLine = '',
  ): string[] {
    const stage = stageName.toLowerCase();
    const last = lastProspectLine.toLowerCase();
    const primaryProduct = productContext.names[0] || company.productName || 'your service';
    const productPitch =
      productContext.snippets[0] ??
      `${primaryProduct} for ${company.idealCustomerProfile || 'your target customers'}.`;
    const proofs = this
      .splitToSnippets(company.proofPoints)
      .filter((line) => /\d/.test(line));
    const pickProof = (fallback: string) =>
      proofs.length > 0 ? proofs[Math.floor(Math.random() * proofs.length)] ?? fallback : fallback;
    const proofA = pickProof('24-hour standard listing photo turnaround.');
    const proofB = pickProof('+31% average listing click-through uplift.');
    const proofC = pickProof('4.9/5 average client rating.');

    if (/price|pricing|cost|budget|package/.test(last)) {
      return [
        `Pricing for ${primaryProduct} depends on property type and package scope; share one listing and I can send an exact quote today.`,
      ];
    }
    if (/revision|adjust|changes|edit/.test(last)) {
      return [
        'Revision handling depends on package scope; tell me your usual change requests and I will confirm exact turnaround.',
      ];
    }
    if (/what kind|which service|services|media|what do you provide/.test(last)) {
      return [
        `For ${primaryProduct}, we cover interior, exterior, drone, virtual tours, and virtual staging with one team, reducing coordination time by about 38%.`,
      ];
    }
    if (/quality|consistent|how do you ensure/.test(last)) {
      return [
        'We use a standardized editing workflow and delivered on time on 98.2% of shoots over the last 12 months.',
      ];
    }
    if (/turnaround|how fast|delivery|deliver/.test(last)) {
      return [
        'Standard listing photos are delivered in 24 hours on 91% of shoots, which helps launch listings faster.',
      ];
    }

    if (stage.includes('opening')) {
      return [
        `Hi, this is ${company.companyName} about ${primaryProduct}. Is now a bad time, or do you have 90 seconds?`,
        `Quick context: ${proofA}`,
        `Can I ask 2 quick questions to see if ${primaryProduct} fits your listing workflow?`,
      ];
    }

    if (stage.includes('discovery')) {
      return [
        'How long does it usually take from shoot to final listing photos today?',
        'How many listings per month wait more than 48 hours for media delivery?',
        `If you fixed one issue this quarter, would it be speed, consistency, or package coverage? ${proofB}`,
      ];
    }

    if (stage.includes('solution') || stage.includes('pitch') || stage.includes('fit')) {
      return [
        `You mentioned speed and consistency; ${productPitch}`,
        `We handle outcomes with one accountable workflow; ${proofC}`,
        'Would starting with 1 pilot listing this week be a practical next step?',
      ];
    }

    if (stage.includes('objection') || objection) {
      if (objection === 'BUDGET') {
        return [
          'Is your concern per-listing price, or keeping monthly spend predictable?',
          `Most teams justify media spend when listings launch faster; ${proofB}`,
          'Would a single pilot listing help you compare cost versus response impact?',
        ];
      }
      if (objection === 'COMPETITOR') {
        return [
          'What works with your current vendor, and where do delays still happen?',
          `One-vendor workflow plus reliability matters here; ${proofA}`,
          'Would a side-by-side pilot on your next listing be fair?',
        ];
      }
      if (objection === 'TIMING') {
        return [
          'When does your next listing need media delivered?',
          `We can align to that date with 24-48 hour output; ${proofA}`,
          'Would you prefer booking the pilot now or early next week?',
        ];
      }
      return [
        'Can I clarify the main blocker before I suggest next steps?',
        `Here is the practical difference we deliver: ${proofA}`,
        'Does that address the concern enough to test one listing?',
      ];
    }

    if (stage.includes('close') || stage.includes('next step')) {
      return [
        `Based on what you shared, ${proofA}`,
        'Would a 15-minute package-fit call later this week work better than next week?',
        'Can we lock one pilot listing date now to benchmark results?',
      ];
    }

    return [
      `Quick recap: ${proofA}`,
      `Relevant benchmark: ${proofB}`,
      'Should we schedule 15 minutes this week for a concrete pilot plan?',
    ];
  }

  private makeSuggestionSpecific(
    text: string,
    _company: CompanyProfile,
    fallback: string,
  ): string {
    const tightened = this.tightenSuggestionText(text);
    const fallbackTight = this.tightenSuggestionText(fallback);
    let out = tightened.length > 0 ? tightened : fallbackTight;
    if (!this.looksEnglish(out)) {
      out = fallbackTight;
    }

    const words = out.split(/\s+/).filter(Boolean);
    if (words.length > 20) {
      out = words.slice(0, 20).join(' ');
    }
    out = out.replace(/\s+/g, ' ').trim();
    if (out.length === 0) {
      out = fallbackTight;
    }
    if (!/[.?!]$/.test(out)) {
      out += '.';
    }
    if (out.length > 0) {
      out = out.charAt(0).toUpperCase() + out.slice(1);
    }
    return out;
  }

  private retrieveCompanySnippets(
    profile: CompanyProfile,
    recentTurns: string,
    objectionDetected: string | null,
  ): RagSnippet[] {
    const docs = this.explodeProfileDocuments(profile);
    const queryTokens = this.tokenizeForRag(
      `${recentTurns}\n${objectionDetected ?? ''}\n${profile.productName}\n${profile.companyName}`,
    );
    const boostedFields = objectionDetected
      ? FIELD_BOOSTS_BY_OBJECTION[objectionDetected] ?? []
      : [];

    const scored = docs
      .map((doc) => {
        let score = 0;
        for (const token of queryTokens) {
          if (doc.text.toLowerCase().includes(token)) score += 1;
        }
        if (boostedFields.includes(doc.field)) score += 3;
        if (doc.field === 'proofPoints') score += 1;
        if (doc.field === 'differentiators') score += 1;
        return { ...doc, score };
      })
      .filter((doc) => doc.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) return scored.slice(0, 8);

    return docs
      .filter(
        (doc) =>
          doc.field === 'proofPoints' ||
          doc.field === 'differentiators' ||
          doc.field === 'valueProposition',
      )
      .slice(0, 6)
      .map((doc) => ({ ...doc, score: 1 }));
  }

  private explodeProfileDocuments(profile: CompanyProfile): Array<Omit<RagSnippet, 'score'>> {
    const fields: Array<keyof CompanyProfile> = [
      'productSummary',
      'idealCustomerProfile',
      'valueProposition',
      'differentiators',
      'proofPoints',
      'repTalkingPoints',
      'discoveryGuidance',
      'qualificationGuidance',
      'objectionHandling',
      'competitorGuidance',
      'pricingGuidance',
      'implementationGuidance',
      'faq',
      'doNotSay',
    ];

    const docs: Array<Omit<RagSnippet, 'score'>> = [];

    for (const field of fields) {
      for (const snippet of this.splitToSnippets(profile[field])) {
        docs.push({ field, text: snippet });
      }
    }

    return docs;
  }

  private splitToSnippets(text: string): string[] {
    return text
      .split('\n')
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter((line) => line.length >= 16)
      .slice(0, 80);
  }

  private countWords(text: string): number {
    const matches = text.match(/[A-Za-z0-9']+/g);
    return matches ? matches.length : 0;
  }

  private tokenizeForRag(text: string): string[] {
    return [...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((x) => x.trim())
        .filter((x) => x.length > 2 && !STOP_WORDS.has(x)),
    )].slice(0, 50);
  }

  private tightenSuggestionText(text: string): string {
    const trimmed = text.trim();
    const withoutFiller = trimmed.replace(
      /^(great question|that'?s (a )?great question|totally fair|absolutely|got it|makes sense|that makes sense|for sure|definitely|thanks for sharing|good question)[,.\s-]+/i,
      '',
    );
    const firstSentence = withoutFiller.split(/(?<=[.!?])\s+/)[0] ?? '';
    return firstSentence.replace(/\s+/g, ' ').trim();
  }

  private looksEnglish(text: string): boolean {
    if (/[ğüşöçıİĞÜŞÖÇ]/.test(text)) return false;
    const lower = text.toLowerCase();
    if (/\b(merhaba|kotu|zaman|saniye|tesekkur|evet|hayir)\b/.test(lower)) return false;
    return true;
  }
}

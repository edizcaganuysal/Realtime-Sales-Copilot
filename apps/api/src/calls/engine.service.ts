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
  callMode: string;
  callType: string;
  guidanceLevel: string;
  agentPrompt: string;
  agentUseDefaultTemplate: boolean;
  agentPromptDelta: string;
  agentFullPrompt: string | null;
  notes: string | null;
  preparedOpenerText: string | null;
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
  momentTag: string;
};

type TickReason = 'session_start' | 'prospect_final' | 'prospect_silence' | 'manual_swap' | 'fallback';

type AlternativesMode = 'SWAP' | 'MORE_OPTIONS';

type CoachMemory = {
  used_value_props: string[];
  used_differentiators: string[];
  used_objection_responses: string[];
  questions_asked: string[];
  last_5_primary_suggestions: string[];
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
  lastProspectPartialText: string;
  pendingProspectFinalSegments: string[];
  pendingProspectFinalTimer: ReturnType<typeof setTimeout> | null;
  prospectSilenceTimer: ReturnType<typeof setTimeout> | null;
  prospectUtteranceSeq: number;
  lastUpdatedUtteranceSeq: number;
  lastProspectUtteranceText: string;
  lastUpdateReason: TickReason | null;
  lastMomentTag: string;
  sessionStarted: boolean;
  recentPrimarySuggestions: string[];
  pendingTickPayload: { reason: TickReason; utteranceSeq: number; payload: EngineTickPayload } | null;
  coachMemory: CoachMemory;
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
      lastProspectPartialText: '',
      pendingProspectFinalSegments: [],
      pendingProspectFinalTimer: null,
      prospectSilenceTimer: null,
      prospectUtteranceSeq: 0,
      lastUpdatedUtteranceSeq: -1,
      lastProspectUtteranceText: '',
      lastUpdateReason: null,
      lastMomentTag: 'Opening',
      sessionStarted: false,
      recentPrimarySuggestions: [],
      pendingTickPayload: null,
      coachMemory: {
        used_value_props: [],
        used_differentiators: [],
        used_objection_responses: [],
        questions_asked: [],
        last_5_primary_suggestions: [],
      },
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
        this.runEngineTick(callId, state, { reason: 'fallback', requireTranscript: true }).catch((err: Error) =>
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

  emitSessionStart(callId: string) {
    const state = this.engines.get(callId);
    if (!state || state.cancelled) return;
    state.sessionStarted = true;
    this.gateway.emitToCall(callId, 'session_start', { tsMs: Date.now() });
    if (!state.context) return;
    this.emitInitialSuggestion(callId, state);
  }

  markPrimaryConsumed(callId: string) {
    const state = this.engines.get(callId);
    if (!state || state.cancelled) return;
    this.gateway.emitToCall(callId, 'engine.primary_consumed', { tsMs: Date.now() });
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
      this.gateway.emitToCall(callId, 'engine.primary_consumed', { tsMs: Date.now() });
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

    if (speaker === 'PROSPECT') {
      state.lastProspectUtteranceText = text;
      state.pendingProspectFinalSegments.push(text);
      this.clearSilenceTimer(state);
      this.clearFinalDebounceTimer(state);
      state.pendingProspectFinalTimer = setTimeout(() => {
        this.finalizeProspectUtterance(callId, state, 'prospect_final');
      }, 280);
    }
  }

  /**
   * Signal that a speaker started talking (partial transcript).
   * Used to dim/hide suggestions while prospect is speaking.
   */
  signalSpeaking(callId: string, speaker: string, text?: string) {
    const state = this.engines.get(callId);
    if (!state) return;
    if (speaker !== 'PROSPECT') return;

    if (text?.trim()) {
      state.lastProspectPartialText = text.trim();
    }

    if (!state.prospectSpeaking) {
      state.prospectSpeaking = true;
      this.gateway.emitToCall(callId, 'engine.prospect_speaking', { speaking: true });
    }

    this.clearSilenceTimer(state);
    state.prospectSilenceTimer = setTimeout(() => {
      this.finalizeProspectUtterance(callId, state, 'prospect_silence');
    }, 1000);
  }

  stop(callId: string) {
    const state = this.engines.get(callId);
    if (!state) return;
    state.cancelled = true;
    this.clearSilenceTimer(state);
    this.clearFinalDebounceTimer(state);
    if (state.stubInterval) clearInterval(state.stubInterval);
    if (state.llmInterval) clearInterval(state.llmInterval);
    this.engines.delete(callId);
    this.logger.log(`Engine stopped — call ${callId}`);
  }

  private clearSilenceTimer(state: EngineState) {
    if (!state.prospectSilenceTimer) return;
    clearTimeout(state.prospectSilenceTimer);
    state.prospectSilenceTimer = null;
  }

  private clearFinalDebounceTimer(state: EngineState) {
    if (!state.pendingProspectFinalTimer) return;
    clearTimeout(state.pendingProspectFinalTimer);
    state.pendingProspectFinalTimer = null;
  }

  private finalizeProspectUtterance(
    callId: string,
    state: EngineState,
    reason: 'prospect_final' | 'prospect_silence',
  ) {
    if (state.cancelled) return;

    this.clearSilenceTimer(state);
    this.clearFinalDebounceTimer(state);

    const finalText = state.pendingProspectFinalSegments.join(' ').replace(/\s+/g, ' ').trim();
    state.pendingProspectFinalSegments = [];

    const partialText = state.lastProspectPartialText.replace(/\s+/g, ' ').trim();
    if (finalText.length > 0) {
      state.lastProspectUtteranceText = finalText;
    } else if (
      reason === 'prospect_silence' &&
      partialText.length > 0 &&
      !/^speaking\.\.\.$/i.test(partialText)
    ) {
      state.lastProspectUtteranceText = partialText;
    }

    state.lastProspectPartialText = '';
    state.prospectSpeaking = false;
    this.gateway.emitToCall(callId, 'engine.prospect_speaking', { speaking: false });

    const shouldUpdate =
      state.lastProspectUtteranceText.length > 0 || state.pendingTickPayload !== null;
    if (!shouldUpdate) {
      this.gateway.emitToCall(callId, 'engine.debug', {
        reason,
        lastProspectUtterance: state.lastProspectUtteranceText,
        momentTag: state.lastMomentTag,
        suggestionUpdated: false,
      });
      return;
    }

    state.prospectUtteranceSeq += 1;
    const utteranceSeq = state.prospectUtteranceSeq;

    if (state.pendingTickPayload) {
      const pending = state.pendingTickPayload;
      state.pendingTickPayload = null;
      this.emitTickPayload(
        callId,
        state,
        pending.payload,
        pending.reason,
        pending.utteranceSeq > 0 ? pending.utteranceSeq : utteranceSeq,
      );
      return;
    }

    if (state.llmInFlight) {
      this.gateway.emitToCall(callId, 'engine.debug', {
        reason,
        lastProspectUtterance: state.lastProspectUtteranceText,
        momentTag: state.lastMomentTag,
        suggestionUpdated: false,
      });
      return;
    }

    this.runEngineTick(callId, state, { reason, requireTranscript: false, utteranceSeq }).catch(
      (err: Error) =>
        this.logger.error(`Engine tick (${reason}) error (${callId}): ${err.message}`),
    );
  }

  private emitInitialSuggestion(callId: string, state: EngineState) {
    if (!state.context) return;

    if (state.transcriptBuffer.length > 0 || state.stats.prospectTurns > 0) {
      if (!state.llmInFlight) {
        this.runEngineTick(callId, state, {
          reason: 'session_start',
          requireTranscript: false,
          utteranceSeq: state.prospectUtteranceSeq,
        }).catch((err: Error) =>
          this.logger.error(`Engine tick (session_start) error (${callId}): ${err.message}`),
        );
      }
      return;
    }

    const openingSuggestions = state.context.preparedOpenerText?.trim()
      ? [state.context.preparedOpenerText.trim()]
      : this.buildOpeningSuggestions(
          state.context.companyProfile,
          state.context.productContext,
          state.context.callMode,
          state.context.notes,
        );
    const payload: EngineTickPayload = {
      suggestions: openingSuggestions,
      nudges: ['ASK_QUESTION', 'CONFIRM_UNDERSTANDING'].slice(0, 2),
      cards: this.buildOpeningContextCards(
        state.context.companyProfile,
        state.context.productContext,
      ),
      objection: null,
      sentiment: state.stats.sentiment,
      checklistUpdates: {},
      momentTag: 'Opening',
    };
    this.emitTickPayload(callId, state, payload, 'session_start', state.prospectUtteranceSeq);
  }

  private publishManualPrimary(callId: string, state: EngineState | null, text: string) {
    if (!state) return;
    const cards = state.context
      ? this.buildOpeningContextCards(state.context.companyProfile, state.context.productContext)
      : [];
    const payload: EngineTickPayload = {
      suggestions: [text],
      nudges: [],
      cards,
      objection: state.stats.objectionDetected,
      sentiment: state.stats.sentiment,
      checklistUpdates: {},
      momentTag: state.lastMomentTag || 'Discovery',
    };
    this.emitTickPayload(callId, state, payload, 'manual_swap', state.prospectUtteranceSeq);
  }

  private computeMomentTag(
    stageName: string,
    objection: string | null,
    sentiment: string | null | undefined,
  ): string {
    if (objection === 'BUDGET') return 'Pricing objection';
    if (objection === 'COMPETITOR') return 'Competitor pressure';
    if (objection === 'TIMING') return 'Timing concern';
    if (objection === 'NO_NEED') return 'No-need objection';
    if (objection === 'AUTHORITY') return 'Decision-maker blocker';
    const stage = stageName.toLowerCase();
    if (stage.includes('opening')) return 'Opening';
    if (stage.includes('discovery')) return 'Discovery';
    if (stage.includes('objection')) return 'Objection handling';
    if (stage.includes('next step') || stage.includes('close')) return 'Next-step opportunity';
    if (sentiment === 'negative') return 'Risk signal';
    if (sentiment === 'positive') return 'Positive momentum';
    return 'Discovery';
  }

  private normalizeMomentTag(
    raw: string | undefined,
    stageName: string,
    objection: string | null,
    sentiment: string | null | undefined,
  ) {
    const cleaned = `${raw ?? ''}`.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 0) {
      return cleaned.length > 38 ? `${cleaned.slice(0, 37).trimEnd()}...` : cleaned;
    }
    return this.computeMomentTag(stageName, objection, sentiment);
  }

  private pickDistinctSuggestions(suggestions: string[], maxCount: number): string[] {
    const selected: string[] = [];
    for (const suggestion of suggestions) {
      if (
        selected.some((item) => this.areSuggestionsSimilar(item, suggestion))
      ) {
        continue;
      }
      selected.push(suggestion);
      if (selected.length >= maxCount) break;
    }
    if (selected.length > 0) return selected;
    return suggestions.slice(0, maxCount);
  }

  private normalizeNudges(raw: string[], state: EngineState): string[] {
    const cleaned = raw
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => (ALLOWED_NUDGES.includes(item) ? item : item.replace(/\s+/g, ' ')));
    const picked = Array.from(new Set(cleaned)).slice(0, 3);
    if (picked.length >= 2) return picked;
    const fallbacks = ['Ask one question', 'Confirm understanding', 'Drive next step'];
    if (state.stats.talkRatioRep > 65) {
      fallbacks.unshift('Let prospect finish');
    }
    if (state.stats.objectionDetected) {
      fallbacks.unshift('Address concern directly');
    }
    return Array.from(new Set([...picked, ...fallbacks])).slice(0, 3);
  }

  private pickNonRepeatingPrimary(
    state: EngineState,
    suggestions: string[],
    reason: TickReason,
    utteranceSeq: number,
  ): string {
    const ordered = [...suggestions];
    const fallbackCandidates =
      state.context?.stages && state.context
        ? this.buildStageFallbackSuggestions(
            state.context.companyProfile,
            state.context.productContext,
            state.context.stages[state.currentStageIdx]?.name ?? 'Opening',
            state.stats.objectionDetected,
            state.lastProspectUtteranceText,
          )
        : [];
    ordered.push(...fallbackCandidates);
    for (const candidate of ordered) {
      const isSimilar = state.recentPrimarySuggestions.some((recent) =>
        this.areSuggestionsSimilar(recent, candidate),
      );
      if (!isSimilar) return candidate;
    }
    if (reason === 'session_start' || reason === 'manual_swap') {
      return ordered[0] ?? suggestions[0] ?? '';
    }
    const jittered = `${ordered[0] ?? suggestions[0] ?? ''}`.trim();
    if (!jittered) return '';
    const variation =
      utteranceSeq % 2 === 0
        ? `${jittered} What would make that most useful for you?`
        : `Would you be open to a quick example specific to your workflow? ${jittered}`;
    return this.makeSuggestionSpecific(variation, EMPTY_COMPANY_PROFILE_DEFAULTS, jittered);
  }

  private areSuggestionsSimilar(a: string, b: string): boolean {
    const ta = new Set(this.tokenizeForRag(a).slice(0, 16));
    const tb = new Set(this.tokenizeForRag(b).slice(0, 16));
    if (ta.size === 0 || tb.size === 0) return false;
    let intersection = 0;
    for (const token of ta) {
      if (tb.has(token)) intersection += 1;
    }
    const union = ta.size + tb.size - intersection;
    if (union === 0) return false;
    return intersection / union >= 0.7;
  }

  async getAlternatives(
    callId: string,
    options?: { mode?: AlternativesMode; count?: number },
  ): Promise<{ texts: string[] }> {
    const state = this.engines.get(callId);
    const mode = options?.mode === 'MORE_OPTIONS' ? 'MORE_OPTIONS' : 'SWAP';
    const requestedCount = Number.isFinite(options?.count)
      ? Math.max(1, Math.min(2, Number(options?.count)))
      : 2;
    const desiredCount = mode === 'MORE_OPTIONS' ? requestedCount : 1;
    const fallbackFromState =
      state?.context
        ? this.buildStageFallbackSuggestions(
            state.context.companyProfile,
            state.context.productContext,
            state.context.stages[state.currentStageIdx]?.name ?? 'Opening',
            state.stats.objectionDetected,
            state.lastProspectUtteranceText,
          ).slice(0, Math.max(desiredCount, 3))
        : null;
    const stubAlts = (fallbackFromState ?? [
      'Is now a bad time, or do you have 90 seconds for context?',
    ]).slice(0, desiredCount);

    if (!this.llm.available || !state?.context) {
      if (mode === 'SWAP' && stubAlts[0]) {
        this.publishManualPrimary(callId, state ?? null, stubAlts[0]);
      }
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
      (state.lastProspectUtteranceText ||
        [...state.transcriptBuffer].reverse().find((t) => t.speaker === 'PROSPECT')?.text) ??
      '';
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
      desiredCount === 1 ? 1 : 3,
      state.recentPrimarySuggestions,
    );
    const userPrompt =
      (recentTurns ? `Transcript:\n${recentTurns}\n\n` : '') +
      (lastProspectLine ? `Last prospect line (answer this first): ${lastProspectLine}\n\n` : '') +
      `Generate exactly ${desiredCount} alternative things the REP could say next. Each must use a different approach and wording. ` +
      `Respond with JSON only: {"suggestions": [${desiredCount === 1 ? '"option 1"' : '"option 1", "option 2"'}]}`;

    try {
      const raw = await this.llm.chatFast(systemPrompt, userPrompt);
      const parsed = this.llm.parseJson<{ suggestions?: string[] }>(raw, {});
      let texts = this.normalizeSuggestions(
        parsed.suggestions ?? [],
        context.companyProfile,
        context.productContext,
        currentStage?.name ?? 'Opening',
        state.stats.objectionDetected,
        desiredCount === 1 ? 1 : 3,
        lastProspectLine,
      );
      if (mode === 'MORE_OPTIONS') {
        const currentPrimary = state.recentPrimarySuggestions[0] ?? '';
        const nonRedundant = texts.filter(
          (candidate) =>
            currentPrimary.length === 0 ||
            !this.areSuggestionsSimilar(candidate, currentPrimary),
        );
        const fallbackPool = this.buildStageFallbackSuggestions(
          context.companyProfile,
          context.productContext,
          currentStage?.name ?? 'Opening',
          state.stats.objectionDetected,
          lastProspectLine,
        ).filter(
          (candidate) =>
            currentPrimary.length === 0 ||
            !this.areSuggestionsSimilar(candidate, currentPrimary),
        );
        texts = this.pickDistinctSuggestions(
          [...nonRedundant, ...fallbackPool, ...texts],
          desiredCount,
        );
        return { texts: texts.slice(0, desiredCount) };
      }
      texts = texts.slice(0, 1);
      if (texts[0]) {
        this.publishManualPrimary(callId, state, texts[0]);
      }
      return { texts };
    } catch (err) {
      this.logger.error(`getAlternatives LLM error (${callId}): ${(err as Error).message}`);
      if (mode === 'SWAP' && stubAlts[0]) {
        this.publishManualPrimary(callId, state, stubAlts[0]);
      }
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

    const [companyProfile, productContext, agentConfig] = await Promise.all([
      this.fetchCompanyProfile(orgId),
      this.fetchProductContextForDebug(orgId, mode, selectedIds),
      this.resolveDebugAgentPrompt(orgId, input.agentId),
    ]);

    const context: CallContext = {
      callId: 'prompt-debug',
      callMode: 'OUTBOUND',
      callType: 'cold_outbound',
      guidanceLevel: input.guidance_level ?? 'STANDARD',
      agentPrompt: agentConfig.agentPrompt,
      agentUseDefaultTemplate: agentConfig.agentUseDefaultTemplate,
      agentPromptDelta: agentConfig.agentPromptDelta,
      agentFullPrompt: agentConfig.agentFullPrompt,
      notes: input.notes ?? null,
      preparedOpenerText: null,
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
      [],
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
        primary?: string;
        moment?: string;
        nudges?: string[];
        context_toast?: { title?: string; bullets?: string[] } | null;
      }>(raw, {});
      const suggestions = this.normalizeSuggestions(
        parsed.primary ? [parsed.primary] : [],
        companyProfile,
        productContext,
        currentStage.name,
        null,
        1,
        lastProspectLine,
      );
      const nudges = this.pickNonEmpty(parsed.nudges, 3)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 3);
      const cards = [
        parsed.context_toast?.title?.trim() ? `Context: ${parsed.context_toast.title.trim()}` : '',
        ...this.pickNonEmpty(parsed.context_toast?.bullets, 4),
      ]
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
          objection: null,
          sentiment: 'neutral',
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

    if (state.sessionStarted) {
      this.emitInitialSuggestion(callId, state);
    }

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

    let agentPrompt = state.context?.agentPrompt ?? '';
    let agentUseDefaultTemplate = true;
    let agentPromptDelta = '';
    let agentFullPrompt: string | null = null;
    if (call.agentId) {
      const [agent] = await this.db
        .select({
          prompt: schema.agents.prompt,
          useDefaultTemplate: schema.agents.useDefaultTemplate,
          promptDelta: schema.agents.promptDelta,
          fullPromptOverride: schema.agents.fullPromptOverride,
        })
        .from(schema.agents)
        .where(eq(schema.agents.id, call.agentId))
        .limit(1);
      if (agent) {
        agentPrompt = agent.prompt ?? '';
        agentUseDefaultTemplate = agent.useDefaultTemplate ?? true;
        agentPromptDelta = agent.promptDelta?.trim() || agent.prompt?.trim() || '';
        agentFullPrompt = agent.fullPromptOverride?.trim() || agent.prompt?.trim() || null;
      }
    }
    if (!call.agentId) {
      agentPromptDelta = '';
      agentFullPrompt = null;
      agentPrompt = '';
      agentUseDefaultTemplate = true;
    }

    const [companyProfile, productContext] = await Promise.all([
      this.fetchCompanyProfile(call.orgId),
      this.fetchProductContext(call.orgId, call.id, call.productsMode),
    ]);

    if (state.cancelled) return null;

    state.coachMemory = this.normalizeCoachMemory(call.coachMemory);
    if (state.coachMemory.last_5_primary_suggestions.length > 0) {
      state.recentPrimarySuggestions = state.coachMemory.last_5_primary_suggestions.slice(0, 5);
    }

    state.context = {
      callId,
      callMode: call.mode,
      callType: call.callType ?? 'cold_outbound',
      guidanceLevel: call.guidanceLevel,
      agentPrompt,
      agentUseDefaultTemplate,
      agentPromptDelta,
      agentFullPrompt,
      notes: call.notes ?? null,
      preparedOpenerText: call.preparedOpenerText ?? null,
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

  private normalizeCoachMemory(value: unknown): CoachMemory {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return {
      used_value_props: this.parseStringArray(record['used_value_props']).slice(0, 40),
      used_differentiators: this.parseStringArray(record['used_differentiators']).slice(0, 40),
      used_objection_responses: this.parseStringArray(record['used_objection_responses']).slice(
        0,
        40,
      ),
      questions_asked: this.parseStringArray(record['questions_asked']).slice(0, 40),
      last_5_primary_suggestions: this.parseStringArray(record['last_5_primary_suggestions']).slice(
        0,
        5,
      ),
    };
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
    if (!agentId) {
      return {
        agentPrompt: '',
        agentUseDefaultTemplate: true,
        agentPromptDelta: '',
        agentFullPrompt: null as string | null,
      };
    }
    const [agent] = await this.db
      .select({
        prompt: schema.agents.prompt,
        useDefaultTemplate: schema.agents.useDefaultTemplate,
        promptDelta: schema.agents.promptDelta,
        fullPromptOverride: schema.agents.fullPromptOverride,
      })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, orgId)))
      .limit(1);
    if (!agent) {
      return {
        agentPrompt: '',
        agentUseDefaultTemplate: true,
        agentPromptDelta: '',
        agentFullPrompt: null as string | null,
      };
    }
    return {
      agentPrompt: agent.prompt?.trim() ?? '',
      agentUseDefaultTemplate: agent.useDefaultTemplate ?? true,
      agentPromptDelta: agent.promptDelta?.trim() || agent.prompt?.trim() || '',
      agentFullPrompt: agent.fullPromptOverride?.trim() || agent.prompt?.trim() || null,
    };
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
    const [[salesContext], [legacyProfile], products] = await Promise.all([
      this.db
        .select()
        .from(schema.salesContext)
        .where(eq(schema.salesContext.orgId, orgId))
        .limit(1),
      this.db
        .select()
        .from(schema.orgCompanyProfiles)
        .where(eq(schema.orgCompanyProfiles.orgId, orgId))
        .limit(1),
      this.fetchOrgProducts(orgId),
    ]);

    const offeringsSummary = products
      .slice(0, 4)
      .map((item) => item.name)
      .join(', ');
    const valueProps = products
      .flatMap((item) => this.parseStringArray(item.valueProps).slice(0, 2))
      .slice(0, 8)
      .join('\n');
    const diffs = products
      .flatMap((item) => this.parseStringArray(item.differentiators).slice(0, 2))
      .slice(0, 8)
      .join('\n');
    const objections = products
      .flatMap((item) => this.toProductObjectionSnippets(item.objections, item.name))
      .slice(0, 8)
      .join('\n');
    const pricingRules = this.compactText(
      products
        .map((item) => this.valueToOneLine(item.pricingRules))
        .filter((line) => line.length > 0)
        .join('; '),
      450,
    );
    const faqLines = products
      .flatMap((item) => this.toProductFaqSnippets(item.faqs, item.name))
      .slice(0, 10)
      .join('\n');
    const dontSay = products
      .flatMap((item) => this.parseStringArray(item.dontSay))
      .slice(0, 10)
      .join('\n');

    const scProof = this.parseStringArray(salesContext?.proofPoints);
    const scCaseStudies = this.parseStringArray(salesContext?.caseStudies);
    const scGlobalValueProps = this.parseStringArray(salesContext?.globalValueProps);
    const scAllowedClaims = this.parseStringArray(salesContext?.allowedClaims);
    const scForbiddenClaims = this.parseStringArray(salesContext?.forbiddenClaims);
    const scSalesPolicies = this.parseStringArray(salesContext?.salesPolicies);
    const scEscalation = this.parseStringArray(salesContext?.escalationRules);
    const scCompetitors = this.parseStringArray(salesContext?.competitors);
    const scPositioning = this.parseStringArray(salesContext?.positioningRules);
    const scDisco = this.parseStringArray(salesContext?.discoveryQuestions);
    const scQual = this.parseStringArray(salesContext?.qualificationRubric);
    const scRoles = this.parseStringArray(salesContext?.targetRoles);
    const scIndustries = this.parseStringArray(salesContext?.industries);
    const scBuyingTriggers = this.parseStringArray(salesContext?.buyingTriggers);
    const scDisqualifiers = this.parseStringArray(salesContext?.disqualifiers);
    const scNextSteps = this.parseStringArray(salesContext?.nextSteps);
    const scHowItWorks = salesContext?.howItWorks?.trim() || '';

    const mappedFromSalesContext: CompanyProfile = {
      companyName: salesContext?.companyName?.trim() || legacyProfile?.companyName || '',
      productName:
        offeringsSummary ||
        salesContext?.whatWeSell?.trim() ||
        legacyProfile?.productName ||
        '',
      productSummary:
        salesContext?.whatWeSell?.trim() ||
        legacyProfile?.productSummary ||
        '',
      idealCustomerProfile: [
        salesContext?.targetCustomer?.trim() || '',
        scRoles.length > 0 ? `Roles: ${scRoles.join(', ')}` : '',
        scIndustries.length > 0 ? `Industries: ${scIndustries.join(', ')}` : '',
        scBuyingTriggers.length > 0 ? `Buying triggers: ${scBuyingTriggers.join(', ')}` : '',
        scDisqualifiers.length > 0 ? `Disqualifiers: ${scDisqualifiers.join(', ')}` : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
      valueProposition:
        [...scGlobalValueProps, ...valueProps.split('\n').filter((line) => line.trim().length > 0)]
          .filter((line) => line.trim().length > 0)
          .slice(0, 12)
          .join('\n') || legacyProfile?.valueProposition || '',
      differentiators: diffs || legacyProfile?.differentiators || '',
      proofPoints:
        [...scProof, ...scCaseStudies]
          .filter((line) => line.trim().length > 0)
          .slice(0, 18)
          .join('\n') || legacyProfile?.proofPoints || '',
      repTalkingPoints:
        scNextSteps.join('\n') || legacyProfile?.repTalkingPoints || '',
      discoveryGuidance:
        scDisco.join('\n') || legacyProfile?.discoveryGuidance || '',
      qualificationGuidance:
        scQual.join('\n') || legacyProfile?.qualificationGuidance || '',
      objectionHandling: objections || legacyProfile?.objectionHandling || '',
      competitorGuidance: [
        scCompetitors.length > 0 ? `Competitors: ${scCompetitors.join(', ')}` : '',
        ...scPositioning,
      ]
        .filter((line) => line.length > 0)
        .join('\n') || legacyProfile?.competitorGuidance || '',
      pricingGuidance: [
        ...scSalesPolicies,
        ...scEscalation.map((line) => `Escalate: ${line}`),
        ...scAllowedClaims.map((line) => `Allowed claim: ${line}`),
        pricingRules,
      ]
        .filter((line) => line.length > 0)
        .join('\n') || legacyProfile?.pricingGuidance || '',
      implementationGuidance:
        [scHowItWorks, ...scNextSteps].filter((line) => line.trim().length > 0).join('\n') ||
        legacyProfile?.implementationGuidance ||
        '',
      faq: faqLines || legacyProfile?.faq || '',
      doNotSay:
        [...scForbiddenClaims, ...dontSay.split('\n').filter((line) => line.trim().length > 0)]
          .filter((line) => line.trim().length > 0)
          .slice(0, 16)
          .join('\n') || legacyProfile?.doNotSay || '',
    };

    return { ...EMPTY_COMPANY_PROFILE_DEFAULTS, ...mappedFromSalesContext };
  }

  // ── Private: engine tick ────────────────────────────────────────────────────

  private async runEngineTick(
    callId: string,
    state: EngineState,
    opts: { reason: TickReason; requireTranscript: boolean; utteranceSeq?: number },
  ) {
    if (!state.context || state.cancelled || state.llmInFlight) return;
    if (opts.requireTranscript && state.transcriptBuffer.length === 0) return;

    state.llmInFlight = true;
    state.lastLlmCallAt = Date.now();
    state.llmCallCount++;

    try {
      if (this.llm.available && (state.transcriptBuffer.length > 0 || !opts.requireTranscript)) {
        await this.runLlmTick(callId, state, opts);
      } else if (!state.prospectSpeaking) {
        this.runStubTick(callId, state, opts.reason, opts.utteranceSeq);
      }
    } finally {
      state.llmInFlight = false;
    }
  }

  private async runLlmTick(
    callId: string,
    state: EngineState,
    opts: { reason: TickReason; requireTranscript: boolean; utteranceSeq?: number },
  ) {
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
      state.recentPrimarySuggestions,
    );
    const lastProspectLine =
      (state.lastProspectUtteranceText ||
        [...state.transcriptBuffer].reverse().find((t) => t.speaker === 'PROSPECT')?.text) ??
      '';
    const userPrompt =
      `Conversation window (REP/PROSPECT only):\n${recentTurns}\n\n` +
      `Last prospect final utterance: ${lastProspectLine || 'None'}\n` +
      `Update trigger: ${opts.reason}\n` +
      `Return JSON only now.`;

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

      let parsed = this.llm.parseJson<{
        moment?: string;
        primary?: string;
        nudges?: string[];
        context_toast?: { title?: string; bullets?: string[] } | null;
        ask?: string[] | null;
        used_updates?: {
          value_props_used?: string[];
          differentiators_used?: string[];
          objection_responses_used?: string[];
          questions_asked?: string[];
        };
      }>(raw, {});

      if (!parsed.primary || !parsed.moment) {
        const retryRaw = await this.llm.chatFast(
          systemPrompt,
          `${userPrompt}\nReturn strictly valid JSON with keys: moment, primary, nudges, context_toast, ask, used_updates.`,
        );
        parsed = this.llm.parseJson(retryRaw, parsed);
      }

      const normalizedSuggestions = this.normalizeSuggestions(
        parsed.primary ? [parsed.primary] : [],
        context.companyProfile,
        context.productContext,
        stageForPrompt.name,
        state.stats.objectionDetected,
        desiredCount,
        lastProspectLine,
      );
      const nudges = this.pickNonEmpty(parsed.nudges, 3).map((item) => item.trim()).filter(Boolean);
      const toastBullets = this.pickNonEmpty(parsed.context_toast?.bullets, 4);
      const toastTitle = parsed.context_toast?.title?.trim() ?? '';
      const supportingData = [
        toastTitle ? `Context: ${toastTitle}` : '',
        ...toastBullets,
      ].filter((item) => item.length > 0);
      const fallbackData = ragSnippets
        .slice(0, 4)
        .map((s) => `${FIELD_LABELS[s.field]}: ${s.text}`);
      const productFallback = context.productContext.snippets.slice(0, 3);
      const cardsFromContext = supportingData.length > 0 ? supportingData : fallbackData;
      const cards = [...cardsFromContext, ...productFallback].slice(0, 4);
      const momentTag = this.normalizeMomentTag(
        parsed.moment,
        stageForPrompt.name,
        state.stats.objectionDetected ?? null,
        state.stats.sentiment,
      );
      const updates = {
        value_props_used: this.pickNonEmpty(parsed.used_updates?.value_props_used, 4),
        differentiators_used: this.pickNonEmpty(parsed.used_updates?.differentiators_used, 4),
        objection_responses_used: this.pickNonEmpty(
          parsed.used_updates?.objection_responses_used,
          4,
        ),
        questions_asked: this.pickNonEmpty(parsed.used_updates?.questions_asked, 4),
      };
      state.coachMemory.used_value_props = [
        ...updates.value_props_used,
        ...state.coachMemory.used_value_props,
      ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 40);
      state.coachMemory.used_differentiators = [
        ...updates.differentiators_used,
        ...state.coachMemory.used_differentiators,
      ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 40);
      state.coachMemory.used_objection_responses = [
        ...updates.objection_responses_used,
        ...state.coachMemory.used_objection_responses,
      ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 40);
      state.coachMemory.questions_asked = [
        ...updates.questions_asked,
        ...state.coachMemory.questions_asked,
      ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 40);
      const tickPayload: EngineTickPayload = {
        suggestions: normalizedSuggestions,
        nudges,
        cards,
        objection: state.stats.objectionDetected ?? null,
        sentiment: state.stats.sentiment,
        checklistUpdates: {},
        momentTag,
      };

      if (state.prospectSpeaking) {
        state.pendingTickPayload = {
          reason: opts.reason,
          utteranceSeq: opts.utteranceSeq ?? state.prospectUtteranceSeq,
          payload: tickPayload,
        };
        return;
      }

      this.emitTickPayload(
        callId,
        state,
        tickPayload,
        opts.reason,
        opts.utteranceSeq ?? state.prospectUtteranceSeq,
      );
    } catch (err) {
      this.logger.error(`LLM tick error (${callId}): ${(err as Error).message}`);
      this.runStubTick(callId, state, opts.reason, opts.utteranceSeq);
    }
  }

  private emitTickPayload(
    callId: string,
    state: EngineState,
    payload: EngineTickPayload,
    reason: TickReason,
    utteranceSeq: number,
  ) {
    if (
      reason !== 'session_start' &&
      reason !== 'manual_swap' &&
      utteranceSeq <= state.lastUpdatedUtteranceSeq
    ) {
      this.gateway.emitToCall(callId, 'engine.debug', {
        reason,
        lastProspectUtterance: state.lastProspectUtteranceText,
        momentTag: payload.momentTag,
        suggestionUpdated: false,
      });
      return;
    }

    const dedupedSuggestions = this.pickDistinctSuggestions(payload.suggestions, 3);
    const normalizedNudges = this.normalizeNudges(payload.nudges, state);
    const antiRepeatedPrimary = this.pickNonRepeatingPrimary(
      state,
      dedupedSuggestions,
      reason,
      utteranceSeq,
    );
    const suggestionsForEmit = antiRepeatedPrimary
      ? [antiRepeatedPrimary, ...dedupedSuggestions.filter((s) => s !== antiRepeatedPrimary)].slice(0, 3)
      : dedupedSuggestions;

    this.gateway.emitToCall(callId, 'engine.suggestions', {
      suggestions: suggestionsForEmit,
      tsMs: Date.now(),
    });

    if (suggestionsForEmit[0]) {
      this.gateway.emitToCall(callId, 'engine.primary_suggestion', {
        text: suggestionsForEmit[0],
        tsMs: Date.now(),
      });
    }

    this.gateway.emitToCall(callId, 'engine.nudges', { nudges: normalizedNudges });
    this.gateway.emitToCall(callId, 'engine.context_cards', {
      cards: payload.cards,
      objection: payload.objection,
    });
    this.gateway.emitToCall(callId, 'engine.moment', {
      tag: payload.momentTag,
      tsMs: Date.now(),
    });

    if (payload.objection) state.stats.objectionDetected = payload.objection;
    if (payload.sentiment) state.stats.sentiment = payload.sentiment;
    state.lastMomentTag = payload.momentTag;
    state.lastUpdateReason = reason;
    state.lastUpdatedUtteranceSeq = utteranceSeq;
    if (suggestionsForEmit[0]) {
      state.recentPrimarySuggestions = [
        suggestionsForEmit[0],
        ...state.recentPrimarySuggestions.filter((item) => item !== suggestionsForEmit[0]),
      ].slice(0, 5);
    }
    state.coachMemory.last_5_primary_suggestions = state.recentPrimarySuggestions.slice(0, 5);
    void this.db
      .update(schema.calls)
      .set({ coachMemory: state.coachMemory })
      .where(eq(schema.calls.id, callId));

    this.gateway.emitToCall(callId, 'engine.debug', {
      reason,
      lastProspectUtterance: state.lastProspectUtteranceText,
      momentTag: payload.momentTag,
      suggestionUpdated: true,
    });
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

  private runStubTick(
    callId: string,
    state: EngineState,
    reason: TickReason,
    utteranceSeq?: number,
  ) {
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
      state.lastProspectUtteranceText,
    ).slice(0, Math.max(desiredCount, 3));

    const nudges =
      guidanceLevel !== 'MINIMAL'
        ? [STUB_NUDGES[n % STUB_NUDGES.length]!]
        : [];

    if (state.checklistState.length > 0) {
      const doneCount = Math.min(Math.floor(n / 2), state.checklistState.length);
      state.checklistState = state.checklistState.map((item, i) => ({
        ...item,
        done: i < doneCount,
      }));
      this.gateway.emitToCall(callId, 'engine.checklist', { items: state.checklistState });
      this.advanceStageIfChecklistCompleted(callId, state);
    }

    const tickPayload: EngineTickPayload = {
      suggestions,
      nudges,
      cards: this.buildOpeningContextCards(companyProfile, productContext),
      objection: state.stats.objectionDetected,
      sentiment: state.stats.sentiment,
      checklistUpdates: {},
      momentTag: this.computeMomentTag(stageName, state.stats.objectionDetected, state.stats.sentiment),
    };
    this.emitTickPayload(
      callId,
      state,
      tickPayload,
      reason,
      utteranceSeq ?? state.prospectUtteranceSeq,
    );
  }

  private emitStubTranscript(callId: string, state: EngineState) {
    state.stubTick++;
    const t = state.stubTick;
    const partialSpeaker = t % 6 < 3 ? 'REP' : 'PROSPECT';

    if (t % 2 === 1) {
      this.gateway.emitToCall(callId, 'transcript.partial', {
        speaker: partialSpeaker,
        text: `Speaking...`,
        tsMs: Date.now(),
      });
      if (partialSpeaker === 'PROSPECT') {
        this.signalSpeaking(callId, 'PROSPECT', 'Speaking...');
      }
    }

    if (t % 5 === 0) {
      const isRep = t % 10 < 5;
      const speaker = isRep ? 'REP' : 'PROSPECT';
      const lines = isRep ? STUB_TRANSCRIPT_REP : STUB_TRANSCRIPT_PROSPECT;
      const text = lines[Math.floor(t / 5) % lines.length]!;
      const tsMs = Date.now();

      this.gateway.emitToCall(callId, 'transcript.final', {
        speaker,
        text,
        tsMs,
        isFinal: true,
      });
      this.pushTranscript(callId, speaker, text);
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
      `Rep communicated value and used evidence, but discovery depth and close discipline were inconsistent. ` +
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
    recentPrimarySuggestions: string[] = [],
  ): string {
    void stageList;
    void checklistItems;
    void suggestionCount;
    const company = context.companyProfile;
    const offerMode = context.productContext.mode === ProductsMode.SELECTED ? 'SELECTED' : 'ALL';
    const offerNames =
      context.productContext.names.length > 0
        ? context.productContext.names.join(', ')
        : 'No offerings configured';
    const condensedOfferings =
      context.productContext.snippets.length > 0
        ? context.productContext.snippets.slice(0, 8).join('\n')
        : context.productContext.summary;
    const forbiddenClaims = company.doNotSay || 'None configured.';
    const salesPolicies = company.pricingGuidance || 'None configured.';
    const recentPrimary =
      recentPrimarySuggestions.length > 0
        ? recentPrimarySuggestions.map((item, index) => `${index + 1}. ${item}`).join('\n')
        : 'None';
    const ragSection =
      ragSnippets.length > 0
        ? ragSnippets
            .slice(0, 8)
            .map((item, index) => `${index + 1}. [${FIELD_LABELS[item.field]}] ${item.text}`)
            .join('\n')
        : 'None';
    const memoryState = this.engines.get(context.callId);
    const memorySection = memoryState
      ? [
          `used_value_props: ${memoryState.coachMemory.used_value_props.join(' | ') || 'none'}`,
          `used_differentiators: ${memoryState.coachMemory.used_differentiators.join(' | ') || 'none'}`,
          `used_objection_responses: ${memoryState.coachMemory.used_objection_responses.join(' | ') || 'none'}`,
          `questions_asked: ${memoryState.coachMemory.questions_asked.join(' | ') || 'none'}`,
          `last_5_primary_suggestions: ${memoryState.coachMemory.last_5_primary_suggestions.join(' | ') || 'none'}`,
        ].join('\n')
      : 'None';
    const systemCore = context.agentUseDefaultTemplate
      ? PROFESSIONAL_SALES_CALL_AGENT_PROMPT
      : 'You are a real-time sales copilot. Return valid JSON only. Enforce truthfulness, listening rules, concise outputs, and anti-repetition.';
    const agentBlock = context.agentUseDefaultTemplate
      ? `Agent Add-on Instructions: ${context.agentPromptDelta || 'None.'}`
      : `Agent Prompt: ${context.agentFullPrompt || context.agentPrompt || 'None.'}`;

    return (
      `${systemCore}\n\n` +
      `${agentBlock}\n\n` +
      `Sales Context:\n` +
      `Company: ${company.companyName || 'Unknown'}\n` +
      `What we sell: ${company.productSummary || company.productName || 'Unknown'}\n` +
      `ICP: ${company.idealCustomerProfile || 'Unknown'}\n` +
      `Proof points:\n${company.proofPoints || 'None'}\n` +
      `Value props:\n${company.valueProposition || 'None'}\n` +
      `Differentiators:\n${company.differentiators || 'None'}\n` +
      `How we work / delivery:\n${company.implementationGuidance || 'None'}\n` +
      `Allowed claims and policies:\n${salesPolicies}\n` +
      `Forbidden claims:\n${forbiddenClaims}\n` +
      `Discovery guidance:\n${company.discoveryGuidance || 'None'}\n` +
      `Qualification guidance:\n${company.qualificationGuidance || 'None'}\n` +
      `Competitor stance:\n${company.competitorGuidance || 'None'}\n` +
      `Next-step guidance:\n${company.repTalkingPoints || 'None'}\n\n` +
      `Offerings Context:\n` +
      `Mode: ${offerMode}\n` +
      `Selected offerings: ${offerNames}\n` +
      `Condensed offerings summary:\n${condensedOfferings || 'None'}\n\n` +
      `Live call metadata:\n` +
      `Current stage: ${currentStage.name}\n` +
      `Call type: ${context.callType}\n` +
      `Call mode: ${context.callMode}\n` +
      `Call notes: ${context.notes || 'None'}\n\n` +
      `Retrieved snippets for this turn:\n${ragSection}\n\n` +
      `Recent primary suggestions:\n${recentPrimary}\n\n` +
      `Coach memory:\n${memorySection}\n\n` +
      `Rules:\n` +
      `- Never invent company/product claims.\n` +
      `- If uncertain, ask a clarifying question.\n` +
      `- Do not repeat recent arguments unless prospect asks again.\n` +
      `- Primary must be 1-2 sentences and speakable.\n` +
      `- Nudges must be 2-3 items, <=6 words each.\n` +
      `- Moment must be short 2-4 words.\n` +
      `- Return JSON only with exact keys: moment, primary, nudges, context_toast, ask, used_updates.\n` +
      `- used_updates must include keys value_props_used, differentiators_used, objection_responses_used, questions_asked.\n`
    );
  }

  private buildOpeningSuggestions(
    company: CompanyProfile,
    productContext: ProductContext,
    callMode: string,
    notes: string | null,
  ): string[] {
    const numericProof =
      this
        .splitToSnippets(company.proofPoints)
        .find((line) => /\d/.test(line)) ?? '24-hour turnaround available on standard listings.';
    const productLabel =
      productContext.names[0] || company.productName || 'your service';
    const companyName = company.companyName || 'our team';
    const isDiscovery = /follow|discovery|existing|renewal|next step|check-in/i.test(
      `${notes ?? ''}`.toLowerCase(),
    );
    if (isDiscovery) {
      return [
        `Hi, this is ${companyName} following up on ${productLabel}. Would it help if we start with your current process and one goal for this week?`,
      ];
    }
    if (callMode === 'OUTBOUND') {
      return [
        `Hi, this is ${companyName}. Quick reason for my call on ${productLabel}: ${numericProof} What is the biggest blocker in your current process today?`,
      ];
    }
    return [
      `Hi, this is ${companyName} on ${productLabel}. Is now a bad time, or can I ask one quick question about your current workflow?`,
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
    const proofA = pickProof('we focus on reliable delivery and clear handoffs.');
    const proofB = pickProof('teams typically care most about speed, consistency, and reduced rework.');
    const proofC = pickProof('we can share relevant proof points once we confirm your use case.');

    if (/price|pricing|cost|budget|package/.test(last)) {
      return [
        `Pricing for ${primaryProduct} depends on scope and goals. Which use case should we size first?`,
      ];
    }
    if (/revision|adjust|changes|edit/.test(last)) {
      return [
        'Revision handling depends on scope and workflow. What level of flexibility do you need in practice?',
      ];
    }
    if (/what kind|which service|services|media|what do you provide/.test(last)) {
      return [
        `For ${primaryProduct}, we can map the right package for your workflow. Which outcomes matter most to you first?`,
      ];
    }
    if (/quality|consistent|how do you ensure/.test(last)) {
      return [
        'We use a standardized process and clear QA checkpoints. Which quality issues have caused the most friction recently?',
      ];
    }
    if (/turnaround|how fast|delivery|deliver/.test(last)) {
      return [
        'Turnaround depends on package scope and timeline. What deadline are you working against for the next listing?',
      ];
    }

    if (stage.includes('opening')) {
      return [
        `Hi, this is ${company.companyName || 'our team'} about ${primaryProduct}. Is now a bad time, or do you have 60 seconds?`,
        `Quick context: ${proofA}`,
        `Can I ask 2 quick questions to see if ${primaryProduct} fits your current workflow?`,
      ];
    }

    if (stage.includes('discovery')) {
      return [
        'How are you handling this process today?',
        'What is the biggest friction point right now?',
        `If one issue got fixed this quarter, would it be speed, consistency, or conversion? ${proofB}`,
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
          'Is your concern upfront cost or overall return?',
          `Teams usually justify spend when outcomes improve. ${proofB}`,
          'Would a small pilot help you compare cost versus impact?',
        ];
      }
      if (objection === 'COMPETITOR') {
        return [
          'What works with your current option, and where are the gaps?',
          `Reliability and execution consistency tend to matter most. ${proofA}`,
          'Would a side-by-side pilot be fair to evaluate fit?',
        ];
      }
      if (objection === 'TIMING') {
        return [
          'What timeline are you working against?',
          `We can align scope to that timeline. ${proofA}`,
          'Would now or next week be better for a pilot kickoff?',
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
        'Would a 15-minute fit call later this week work better than next week?',
        'Can we lock a small pilot date now to benchmark results?',
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

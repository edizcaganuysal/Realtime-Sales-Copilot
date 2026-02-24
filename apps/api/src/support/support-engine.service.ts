import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { FastCallModel } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { SupportGateway } from './support.gateway';
import { LlmService } from '../calls/llm.service';
import type { LlmResult } from '../calls/llm.service';
import { ActionRunnerService } from './action-runner.service';
import {
  SUPPORT_COPILOT_SYSTEM_PROMPT,
  buildSupportContextBlock,
  type SupportAgentContext,
} from './support-agent.prompt';

// ─── Types ──────────────────────────────────────────────────────────────────

type StageInfo = {
  name: string;
  goals: string;
  checklist: string[];
};

type TurnLine = { speaker: string; text: string; tsMs: number };

type SessionContext = {
  sessionId: string;
  orgId: string;
  llmModel: FastCallModel;
  agentPromptDelta: string;
  supportAgentContext: SupportAgentContext;
  stages: StageInfo[];
  availableActions: Array<{
    id: string;
    name: string;
    description: string;
    triggerPhrases: string[];
    inputSchema: Record<string, unknown>;
  }>;
  ragDocuments: RagDocument[];
};

type SessionStats = {
  agentTurns: number;
  customerTurns: number;
  agentQuestions: number;
  agentWords: number;
  customerWords: number;
  issueType: string | null;
  sentiment: 'positive' | 'neutral' | 'frustrated' | 'angry';
  talkRatioAgent: number;
};

type TickReason = 'session_start' | 'customer_final' | 'customer_silence' | 'fallback';

type CoachMemory = {
  last_5_primary_suggestions: string[];
  last_move_type: string;
  action_results: Array<{ name: string; output: unknown }>;
};

type SupportEngineState = {
  context: SessionContext | null;
  cancelled: boolean;
  transcriptBuffer: TurnLine[];
  checklistState: Array<{ label: string; done: boolean }>;
  currentStageIdx: number;
  lastLlmCallAt: number;
  llmCallCount: number;
  llmInFlight: boolean;
  avgLlmLatencyMs: number;
  stats: SessionStats;
  customerSpeaking: boolean;
  lastCustomerPartialText: string;
  pendingCustomerFinalSegments: string[];
  pendingCustomerFinalTimer: ReturnType<typeof setTimeout> | null;
  customerSilenceTimer: ReturnType<typeof setTimeout> | null;
  customerUtteranceSeq: number;
  lastUpdatedUtteranceSeq: number;
  lastCustomerUtteranceText: string;
  lastUpdateReason: TickReason | null;
  lastMomentTag: string;
  sessionStarted: boolean;
  recentPrimarySuggestions: string[];
  pendingTickRequest: { reason: 'customer_final' | 'customer_silence'; utteranceSeq: number } | null;
  coachMemory: CoachMemory;
  llmInterval: ReturnType<typeof setInterval> | null;
};

type RagDocument = {
  field: string;
  text: string;
};

type RagSnippet = {
  field: string;
  text: string;
  score: number;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const FALLBACK_STAGES: StageInfo[] = [
  {
    name: 'Identification',
    goals: 'Greet, identify customer, understand issue category.',
    checklist: [
      'Greet the customer warmly',
      'Ask how you can help today',
      'Identify the customer (name, account)',
      'Categorize the issue type',
    ],
  },
  {
    name: 'Diagnosis',
    goals: 'Ask clarifying questions, check systems, identify root cause.',
    checklist: [
      'Ask one targeted clarifying question',
      'Check relevant system/account if needed',
      'Identify root cause or category',
      'Confirm understanding with the customer',
    ],
  },
  {
    name: 'Resolution',
    goals: 'Propose solution, execute actions, confirm resolution.',
    checklist: [
      'Propose a specific solution',
      'Execute any needed actions',
      'Confirm the fix/resolution with customer',
      'Offer additional help if applicable',
    ],
  },
  {
    name: 'Closure',
    goals: 'Summarize, confirm satisfaction, offer follow-up.',
    checklist: [
      'Summarize what was resolved',
      'Ask if the customer is satisfied',
      'Offer follow-up resources',
      'Thank the customer and close',
    ],
  },
];

const ISSUE_KEYWORDS: Record<string, string[]> = {
  BILLING: ['price', 'charge', 'invoice', 'refund', 'payment', 'bill', 'subscription', 'plan', 'cost', 'expensive'],
  TECHNICAL: ['bug', 'error', 'broken', 'not working', 'crash', 'slow', 'glitch', 'issue', 'problem', 'fix'],
  ACCOUNT: ['login', 'password', 'access', 'permissions', 'sign in', 'locked', 'account', 'profile', 'settings'],
  SHIPPING: ['delivery', 'tracking', 'shipment', 'order status', 'shipping', 'arrive', 'package', 'lost'],
  CANCELLATION: ['cancel', 'unsubscribe', 'close account', 'stop', 'end subscription', 'terminate'],
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'to', 'of', 'for', 'with',
  'on', 'in', 'at', 'this', 'that', 'it', 'we', 'you', 'they', 'our',
  'their', 'be', 'as', 'if', 'by', 'from', 'can', 'do', 'does', 'did',
  'have', 'has', 'had', 'will', 'would', 'should', 'could', 'not', 'no',
  'yes', 'about', 'just', 'very', 'really',
]);

const FIELD_BOOSTS_BY_ISSUE: Record<string, string[]> = {
  BILLING: ['returnRefundPolicy', 'salesPolicies', 'supportFaqs', 'slaRules'],
  TECHNICAL: ['troubleshootingGuides', 'supportFaqs', 'knowledgeAppendix', 'commonIssues'],
  ACCOUNT: ['supportFaqs', 'troubleshootingGuides', 'knowledgeAppendix'],
  SHIPPING: ['salesPolicies', 'slaRules', 'supportFaqs', 'commonIssues'],
  CANCELLATION: ['returnRefundPolicy', 'salesPolicies', 'escalationRules', 'slaRules'],
};

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class SupportEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(SupportEngineService.name);
  private engines = new Map<string, SupportEngineState>();

  constructor(
    private readonly gateway: SupportGateway,
    private readonly llm: LlmService,
    private readonly actionRunner: ActionRunnerService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  onModuleDestroy() {
    for (const [sessionId] of this.engines) {
      this.stop(sessionId);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start(sessionId: string) {
    if (this.engines.has(sessionId)) return;

    const state: SupportEngineState = {
      context: null,
      cancelled: false,
      transcriptBuffer: [],
      checklistState: [],
      currentStageIdx: 0,
      lastLlmCallAt: 0,
      llmCallCount: 0,
      llmInFlight: false,
      avgLlmLatencyMs: 0,
      stats: {
        agentTurns: 0,
        customerTurns: 0,
        agentQuestions: 0,
        agentWords: 0,
        customerWords: 0,
        issueType: null,
        sentiment: 'neutral',
        talkRatioAgent: 50,
      },
      customerSpeaking: false,
      lastCustomerPartialText: '',
      pendingCustomerFinalSegments: [],
      pendingCustomerFinalTimer: null,
      customerSilenceTimer: null,
      customerUtteranceSeq: 0,
      lastUpdatedUtteranceSeq: -1,
      lastCustomerUtteranceText: '',
      lastUpdateReason: null,
      lastMomentTag: 'Identification',
      sessionStarted: false,
      recentPrimarySuggestions: [],
      pendingTickRequest: null,
      coachMemory: {
        last_5_primary_suggestions: [],
        last_move_type: '',
        action_results: [],
      },
      llmInterval: null,
    };

    this.engines.set(sessionId, state);

    this.loadContext(sessionId, state).catch((err: Error) =>
      this.logger.error(`Support engine context load failed (${sessionId}): ${err.message}`),
    );

    // Fallback interval
    state.llmInterval = setInterval(() => {
      const hasNewSignal = state.customerUtteranceSeq > state.lastUpdatedUtteranceSeq;
      const hasPending = state.pendingTickRequest !== null;
      if (
        !state.llmInFlight &&
        (hasNewSignal || hasPending) &&
        Date.now() - state.lastLlmCallAt > 15_000
      ) {
        this.runEngineTick(sessionId, state, { reason: 'fallback', requireTranscript: true }).catch(
          (err: Error) => this.logger.error(`Support engine tick error (${sessionId}): ${err.message}`),
        );
      }
    }, 15_000);

    this.logger.log(`Support engine started — session ${sessionId}`);
  }

  emitSessionStart(sessionId: string) {
    const state = this.engines.get(sessionId);
    if (!state || state.cancelled) return;
    if (state.sessionStarted) return;
    state.sessionStarted = true;
    this.gateway.emitToSession(sessionId, 'session_start', { tsMs: Date.now() });
    if (!state.context) return;
    this.emitInitialSuggestion(sessionId, state);
  }

  pushTranscript(sessionId: string, speaker: string, text: string) {
    const state = this.engines.get(sessionId);
    if (!state) return;

    const tsMs = Date.now();
    state.transcriptBuffer.push({ speaker, text, tsMs });
    if (state.transcriptBuffer.length > 30) state.transcriptBuffer.shift();

    // Update stats
    if (speaker === 'AGENT') {
      state.stats.agentTurns++;
      state.stats.agentWords += this.countWords(text);
      if (text.includes('?')) state.stats.agentQuestions++;
      this.gateway.emitToSession(sessionId, 'engine.primary_consumed', { tsMs });
    } else {
      state.stats.customerTurns++;
      state.stats.customerWords += this.countWords(text);

      // Detect issue type
      const lower = text.toLowerCase();
      for (const [type, keywords] of Object.entries(ISSUE_KEYWORDS)) {
        if (keywords.some((kw) => lower.includes(kw))) {
          state.stats.issueType = type;
          break;
        }
      }

      // Detect sentiment
      if (lower.includes('angry') || lower.includes('unacceptable') || lower.includes('terrible') || lower.includes('awful')) {
        state.stats.sentiment = 'angry';
      } else if (lower.includes('frustrated') || lower.includes('annoyed') || lower.includes("can't believe") || lower.includes('ridiculous')) {
        state.stats.sentiment = 'frustrated';
      } else if (lower.includes('thank') || lower.includes('great') || lower.includes('perfect') || lower.includes('appreciate')) {
        state.stats.sentiment = 'positive';
      }
    }

    // Talk ratio
    const totalWords = state.stats.agentWords + state.stats.customerWords;
    state.stats.talkRatioAgent =
      totalWords > 0 ? Math.round((state.stats.agentWords / totalWords) * 100) : 50;

    this.gateway.emitToSession(sessionId, 'engine.stats', { stats: state.stats });

    if (speaker === 'CUSTOMER') {
      state.lastCustomerUtteranceText = text;
      state.pendingCustomerFinalSegments.push(text);
      this.clearSilenceTimer(state);
      this.clearFinalDebounceTimer(state);
      state.pendingCustomerFinalTimer = setTimeout(() => {
        this.finalizeCustomerUtterance(sessionId, state, 'customer_final');
      }, 280);
    }
  }

  signalSpeaking(sessionId: string, speaker: string, text?: string) {
    const state = this.engines.get(sessionId);
    if (!state || speaker !== 'CUSTOMER') return;

    if (text?.trim()) state.lastCustomerPartialText = text.trim();

    if (!state.customerSpeaking) {
      state.customerSpeaking = true;
      this.gateway.emitToSession(sessionId, 'engine.customer_speaking', { speaking: true });
    }

    this.clearSilenceTimer(state);
    state.customerSilenceTimer = setTimeout(() => {
      this.finalizeCustomerUtterance(sessionId, state, 'customer_silence');
    }, 1000);
  }

  /**
   * Feed an action result back to the engine so the next suggestion incorporates it.
   */
  feedActionResult(sessionId: string, actionName: string, output: unknown) {
    const state = this.engines.get(sessionId);
    if (!state) return;
    state.coachMemory.action_results.push({ name: actionName, output });
    // Trigger a new engine tick
    if (!state.llmInFlight && state.context) {
      this.runEngineTick(sessionId, state, {
        reason: 'customer_final',
        requireTranscript: false,
      }).catch((err: Error) =>
        this.logger.error(`Support engine action-result tick error (${sessionId}): ${err.message}`),
      );
    }
  }

  stop(sessionId: string) {
    const state = this.engines.get(sessionId);
    if (!state) return;
    state.cancelled = true;
    this.clearSilenceTimer(state);
    this.clearFinalDebounceTimer(state);
    if (state.llmInterval) clearInterval(state.llmInterval);
    this.engines.delete(sessionId);
    this.logger.log(`Support engine stopped — session ${sessionId}`);
  }

  // ── Private: Timers ───────────────────────────────────────────────────────

  private clearSilenceTimer(state: SupportEngineState) {
    if (!state.customerSilenceTimer) return;
    clearTimeout(state.customerSilenceTimer);
    state.customerSilenceTimer = null;
  }

  private clearFinalDebounceTimer(state: SupportEngineState) {
    if (!state.pendingCustomerFinalTimer) return;
    clearTimeout(state.pendingCustomerFinalTimer);
    state.pendingCustomerFinalTimer = null;
  }

  private finalizeCustomerUtterance(
    sessionId: string,
    state: SupportEngineState,
    reason: 'customer_final' | 'customer_silence',
  ) {
    if (state.cancelled) return;

    this.clearSilenceTimer(state);
    this.clearFinalDebounceTimer(state);

    const finalText = state.pendingCustomerFinalSegments.join(' ').replace(/\s+/g, ' ').trim();
    state.pendingCustomerFinalSegments = [];

    const partialText = state.lastCustomerPartialText.replace(/\s+/g, ' ').trim();
    if (finalText.length > 0) {
      state.lastCustomerUtteranceText = finalText;
    } else if (reason === 'customer_silence' && partialText.length > 0) {
      state.lastCustomerUtteranceText = partialText;
    }

    state.lastCustomerPartialText = '';
    state.customerSpeaking = false;
    this.gateway.emitToSession(sessionId, 'engine.customer_speaking', { speaking: false });

    if (state.lastCustomerUtteranceText.length === 0) return;

    state.customerUtteranceSeq += 1;

    if (state.llmInFlight) {
      state.pendingTickRequest = { reason, utteranceSeq: state.customerUtteranceSeq };
      return;
    }

    this.runEngineTick(sessionId, state, {
      reason,
      requireTranscript: false,
      utteranceSeq: state.customerUtteranceSeq,
    }).catch((err: Error) =>
      this.logger.error(`Support engine tick (${reason}) error (${sessionId}): ${err.message}`),
    );
  }

  // ── Private: Context Loading ──────────────────────────────────────────────

  private async loadContext(sessionId: string, state: SupportEngineState) {
    const [session] = await this.db
      .select()
      .from(schema.supportSessions)
      .where(eq(schema.supportSessions.id, sessionId))
      .limit(1);
    if (!session || state.cancelled) return;

    // Load everything in parallel
    const [salesCtx, supportCtx, products, agent, actionDefs] = await Promise.all([
      this.db
        .select()
        .from(schema.salesContext)
        .where(eq(schema.salesContext.orgId, session.orgId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select()
        .from(schema.supportContext)
        .where(eq(schema.supportContext.orgId, session.orgId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.orgId, session.orgId))
        .orderBy(asc(schema.products.name)),
      session.agentId
        ? this.db
            .select()
            .from(schema.agents)
            .where(eq(schema.agents.id, session.agentId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      this.db
        .select()
        .from(schema.actionDefinitions)
        .where(
          and(
            eq(schema.actionDefinitions.orgId, session.orgId),
            eq(schema.actionDefinitions.isActive, true),
          ),
        ),
    ]);

    if (state.cancelled) return;

    // Build support agent context from both tables
    const formatJsonArray = (val: unknown): string => {
      if (!Array.isArray(val) || val.length === 0) return '';
      return val
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item !== null) {
            return Object.entries(item as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
              .join(', ');
          }
          return '';
        })
        .filter((s) => s.length > 0)
        .join('\n- ');
    };

    // Build product FAQ/knowledge strings
    const productFaqs = products
      .flatMap((p) => {
        const faqs = Array.isArray(p.faqs) ? (p.faqs as Array<{ question?: string; answer?: string }>) : [];
        return faqs.map((f) => `[${p.name}] Q: ${f.question ?? ''} A: ${f.answer ?? ''}`);
      })
      .filter((s) => s.length > 10)
      .join('\n');

    const productObjections = products
      .flatMap((p) => {
        const objections = Array.isArray(p.objections) ? (p.objections as Array<{ objection?: string; response?: string }>) : [];
        return objections.map((o) => `[${p.name}] "${o.objection ?? ''}": ${o.response ?? ''}`);
      })
      .filter((s) => s.length > 10)
      .join('\n');

    const availableActions = actionDefs.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      triggerPhrases: Array.isArray(d.triggerPhrases) ? (d.triggerPhrases as string[]) : [],
      inputSchema: (d.inputSchema as Record<string, unknown>) ?? {},
    }));

    const supportAgentContext: SupportAgentContext = {
      companyName: salesCtx?.companyName ?? '',
      whatWeSell: salesCtx?.whatWeSell ?? '',
      howItWorks: salesCtx?.howItWorks ?? '',
      policies: formatJsonArray(salesCtx?.salesPolicies),
      escalationRules: formatJsonArray(salesCtx?.escalationRules),
      forbiddenClaims: formatJsonArray(salesCtx?.forbiddenClaims),
      knowledgeAppendix: salesCtx?.knowledgeAppendix ?? '',
      supportFaqs: formatJsonArray(supportCtx?.supportFaqs),
      troubleshootingGuides: formatJsonArray(supportCtx?.troubleshootingGuides),
      returnRefundPolicy: supportCtx?.returnRefundPolicy ?? '',
      slaRules: formatJsonArray(supportCtx?.slaRules),
      commonIssues: formatJsonArray(supportCtx?.commonIssues),
      supportKnowledgeAppendix: supportCtx?.supportKnowledgeAppendix ?? '',
      availableActions,
    };

    // Build RAG documents
    const ragDocuments: RagDocument[] = [];
    const addDoc = (field: string, text: string) => {
      if (text.trim().length > 5) ragDocuments.push({ field, text: text.trim() });
    };
    addDoc('supportFaqs', supportAgentContext.supportFaqs);
    addDoc('troubleshootingGuides', supportAgentContext.troubleshootingGuides);
    addDoc('returnRefundPolicy', supportAgentContext.returnRefundPolicy);
    addDoc('slaRules', supportAgentContext.slaRules);
    addDoc('commonIssues', supportAgentContext.commonIssues);
    addDoc('supportKnowledgeAppendix', supportAgentContext.supportKnowledgeAppendix);
    addDoc('knowledgeAppendix', supportAgentContext.knowledgeAppendix);
    addDoc('policies', supportAgentContext.policies);
    addDoc('escalationRules', supportAgentContext.escalationRules);
    addDoc('forbiddenClaims', supportAgentContext.forbiddenClaims);
    if (productFaqs) addDoc('productFaqs', productFaqs);
    if (productObjections) addDoc('productObjections', productObjections);

    state.context = {
      sessionId,
      orgId: session.orgId,
      llmModel: this.llm.defaultFastModel,
      agentPromptDelta: agent?.promptDelta?.trim() ?? '',
      supportAgentContext,
      stages: FALLBACK_STAGES,
      availableActions,
      ragDocuments,
    };

    // Initialize checklist
    const firstChecklist = state.context.stages[0]?.checklist ?? [];
    if (firstChecklist.length) {
      state.checklistState = firstChecklist.map((label) => ({ label, done: false }));
      this.gateway.emitToSession(sessionId, 'engine.checklist', { items: state.checklistState });
    }

    this.gateway.emitToSession(sessionId, 'engine.stage', {
      stageIdx: 0,
      stageName: state.context.stages[0]?.name ?? 'Identification',
    });

    if (state.sessionStarted) {
      this.emitInitialSuggestion(sessionId, state);
    }

    this.logger.log(`Support engine context loaded — session ${sessionId}`);
  }

  // ── Private: Suggestions ──────────────────────────────────────────────────

  private emitInitialSuggestion(sessionId: string, state: SupportEngineState) {
    if (!state.context) return;

    if (state.transcriptBuffer.length > 0) {
      if (!state.llmInFlight) {
        this.runEngineTick(sessionId, state, {
          reason: 'session_start',
          requireTranscript: false,
        }).catch((err: Error) =>
          this.logger.error(`Support engine tick (session_start) error (${sessionId}): ${err.message}`),
        );
      }
      return;
    }

    const companyName = state.context.supportAgentContext.companyName || 'our company';
    const suggestions = [
      `Hi, thank you for calling ${companyName}. How can I help you today?`,
    ];

    this.emitSuggestions(sessionId, state, {
      suggestions,
      nudges: ['Ask how you can help', 'Identify the customer'],
      knowledgeCards: [],
      momentTag: 'Greeting',
      issueType: null,
      resolutionStatus: 'diagnosing',
      proposedActions: [],
      empathyNote: null,
    });
  }

  private emitSuggestions(
    sessionId: string,
    state: SupportEngineState,
    payload: {
      suggestions: string[];
      nudges: string[];
      knowledgeCards: string[];
      momentTag: string;
      issueType: string | null;
      resolutionStatus: string;
      proposedActions: Array<{ definitionId: string; name: string; input: Record<string, unknown>; reason: string }>;
      empathyNote: string | null;
    },
  ) {
    const primary = payload.suggestions[0] ?? '';
    if (primary) {
      state.recentPrimarySuggestions.unshift(primary);
      if (state.recentPrimarySuggestions.length > 5) state.recentPrimarySuggestions.pop();
      state.coachMemory.last_5_primary_suggestions = state.recentPrimarySuggestions.slice(0, 5);
    }
    state.lastMomentTag = payload.momentTag;
    state.lastUpdatedUtteranceSeq = state.customerUtteranceSeq;

    this.gateway.emitToSession(sessionId, 'engine.suggestions', {
      suggestions: payload.suggestions,
      nudges: payload.nudges,
      knowledgeCards: payload.knowledgeCards,
      momentTag: payload.momentTag,
      issueType: payload.issueType,
      resolutionStatus: payload.resolutionStatus,
      empathyNote: payload.empathyNote,
    });

    this.gateway.emitToSession(sessionId, 'engine.primary_suggestion', {
      text: primary,
      momentTag: payload.momentTag,
    });

    if (payload.nudges.length > 0) {
      this.gateway.emitToSession(sessionId, 'engine.nudges', { nudges: payload.nudges });
    }

    if (payload.knowledgeCards.length > 0) {
      this.gateway.emitToSession(sessionId, 'engine.knowledge_cards', {
        cards: payload.knowledgeCards,
      });
    }

    this.gateway.emitToSession(sessionId, 'engine.moment', { moment: payload.momentTag });

    // Persist suggestions to DB
    if (primary) {
      this.db
        .insert(schema.supportSuggestions)
        .values({
          sessionId,
          tsMs: Date.now(),
          kind: 'PRIMARY',
          rank: 0,
          text: primary,
          intent: payload.momentTag,
          metaJson: {
            issueType: payload.issueType,
            resolutionStatus: payload.resolutionStatus,
          },
        })
        .catch((err: Error) =>
          this.logger.error(`Failed to persist support suggestion: ${err.message}`),
        );
    }

    // Handle proposed actions
    for (const action of payload.proposedActions) {
      this.actionRunner
        .proposeAction(sessionId, action.definitionId, action.input)
        .catch((err: Error) =>
          this.logger.error(`Failed to propose action: ${err.message}`),
        );
    }
  }

  // ── Private: Engine Tick ──────────────────────────────────────────────────

  private async runEngineTick(
    sessionId: string,
    state: SupportEngineState,
    opts: { reason: TickReason; requireTranscript: boolean; utteranceSeq?: number },
  ) {
    if (!state.context || state.cancelled || state.llmInFlight) return;
    if (opts.requireTranscript && state.transcriptBuffer.length === 0) return;

    state.llmInFlight = true;
    state.lastLlmCallAt = Date.now();
    state.llmCallCount++;

    try {
      if (this.llm.available && (state.transcriptBuffer.length > 0 || !opts.requireTranscript)) {
        await this.runLlmTick(sessionId, state, opts);
      } else if (!state.customerSpeaking) {
        this.runFallbackTick(sessionId, state, opts.reason);
      }
    } finally {
      state.llmInFlight = false;
      if (state.cancelled || state.customerSpeaking) return;
      if (!state.pendingTickRequest) return;
      const pending = state.pendingTickRequest;
      state.pendingTickRequest = null;
      this.runEngineTick(sessionId, state, {
        reason: pending.reason,
        requireTranscript: false,
        utteranceSeq: pending.utteranceSeq,
      }).catch((err: Error) =>
        this.logger.error(`Support engine tick retry error (${sessionId}): ${err.message}`),
      );
    }
  }

  private async runLlmTick(
    sessionId: string,
    state: SupportEngineState,
    opts: { reason: TickReason; requireTranscript: boolean; utteranceSeq?: number },
  ) {
    const context = state.context;
    if (!context) return;

    const currentStage = context.stages[state.currentStageIdx] ?? context.stages[0];
    if (!currentStage) return;

    const recentTurns = state.transcriptBuffer
      .slice(-15)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');

    const ragSnippets = this.retrieveSnippets(
      context.ragDocuments,
      recentTurns,
      state.stats.issueType,
    );

    const systemPrompt = this.buildSystemPrompt(context, currentStage, ragSnippets, state);

    const lastCustomerLine =
      state.lastCustomerUtteranceText ||
      [...state.transcriptBuffer].reverse().find((t) => t.speaker === 'CUSTOMER')?.text ||
      '';

    const entities = this.extractEntities(lastCustomerLine);
    const actionResultsBlock = state.coachMemory.action_results.length > 0
      ? `\naction_results:\n${state.coachMemory.action_results
          .map((r) => `- ${r.name}: ${JSON.stringify(r.output).slice(0, 300)}`)
          .join('\n')}`
      : '';

    const userPrompt =
      `Conversation window (AGENT/CUSTOMER only):\n${recentTurns}\n\n` +
      `customer_last_utterance: "${lastCustomerLine || 'None'}"\n` +
      `issue_type: ${state.stats.issueType ?? 'GENERAL'}\n` +
      `entities: ${entities.length > 0 ? entities.join(', ') : 'none'}\n` +
      `customer_sentiment: ${state.stats.sentiment}\n` +
      `available_actions: ${context.availableActions.map((a) => a.name).join(', ') || 'none'}` +
      actionResultsBlock + '\n' +
      `Update trigger: ${opts.reason}\n` +
      `Return JSON only now.`;

    try {
      const llmStartedAt = Date.now();
      const FAST_INTERIM_MS = 900;

      const llmPromise = this.llm.chatFast(systemPrompt, userPrompt, {
        model: context.llmModel,
        jsonMode: true,
        temperature: 0.5,
        billing: { orgId: context.orgId, ledgerType: 'USAGE_LLM_SUPPORT_ENGINE_TICK', metadata: { session_id: sessionId } },
      });

      const shouldUseFastInterim = opts.reason === 'customer_final' || opts.reason === 'customer_silence';
      const timeoutPromise: Promise<null | '__skip__'> = shouldUseFastInterim
        ? new Promise<null>((resolve) => setTimeout(() => resolve(null), FAST_INTERIM_MS))
        : Promise.resolve('__skip__' as const);

      const raceResult = await Promise.race([llmPromise, timeoutPromise]);

      if (raceResult === null) {
        // Emit deterministic interim
        const interim = this.buildDeterministicFallback(lastCustomerLine, state.stats.issueType);
        if (!state.customerSpeaking) {
          this.gateway.emitToSession(sessionId, 'engine.primary_suggestion', {
            text: interim,
            momentTag: state.lastMomentTag,
            interim: true,
          });
        }
      }

      const llmResult: LlmResult = raceResult !== null && raceResult !== '__skip__' ? raceResult : await llmPromise;
      const raw = llmResult.text;
      const llmLatency = Date.now() - llmStartedAt;
      state.avgLlmLatencyMs =
        state.avgLlmLatencyMs === 0
          ? llmLatency
          : Math.round(state.avgLlmLatencyMs * 0.7 + llmLatency * 0.3);

      let parsed = this.llm.parseJson<{
        moment?: string;
        primary?: string;
        follow_up_question?: string | null;
        empathy_note?: string | null;
        proposed_actions?: Array<{
          definitionId?: string;
          name?: string;
          input?: Record<string, unknown>;
          reason?: string;
        }>;
        knowledge_cite?: { source?: string; text?: string } | null;
        nudges?: string[];
        issue_type?: string;
        resolution_status?: string;
      }>(raw, {});

      // Retry if missing primary
      if (!parsed.primary || !parsed.moment) {
        const retryResult = await this.llm.chatFast(
          systemPrompt,
          `${userPrompt}\nReturn strictly valid JSON with keys: moment, primary, nudges, proposed_actions, issue_type, resolution_status.`,
          {
            model: context.llmModel,
            jsonMode: true,
            temperature: 0.45,
            billing: { orgId: context.orgId, ledgerType: 'USAGE_LLM_SUPPORT_ENGINE_TICK', metadata: { session_id: sessionId, retry: true } },
          },
        );
        parsed = this.llm.parseJson(retryResult.text, parsed);
      }

      const primary = parsed.primary?.trim() || this.buildDeterministicFallback(lastCustomerLine, state.stats.issueType);
      const nudges = (parsed.nudges ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 3);
      const fallbackNudges = this.buildFallbackNudges(state);
      const finalNudges = nudges.length >= 2 ? nudges : [...nudges, ...fallbackNudges].slice(0, 3);

      const knowledgeCards: string[] = [];
      if (parsed.knowledge_cite?.text) {
        knowledgeCards.push(`[${parsed.knowledge_cite.source ?? 'KB'}] ${parsed.knowledge_cite.text}`);
      }
      ragSnippets.slice(0, 3).forEach((s) => {
        knowledgeCards.push(`[${s.field}] ${s.text.slice(0, 200)}`);
      });

      const momentTag = parsed.moment?.trim() || this.computeSupportMoment(currentStage.name, state.stats);
      const issueType = parsed.issue_type || state.stats.issueType;
      if (issueType) state.stats.issueType = issueType;

      // Validate proposed actions
      const proposedActions = (parsed.proposed_actions ?? [])
        .filter((a) => a.definitionId && context.availableActions.some((d) => d.id === a.definitionId))
        .map((a) => ({
          definitionId: a.definitionId!,
          name: a.name ?? 'Action',
          input: a.input ?? {},
          reason: a.reason ?? '',
        }));

      // Stage advancement heuristic
      this.maybeAdvanceStage(state, parsed.resolution_status);

      this.emitSuggestions(sessionId, state, {
        suggestions: [primary],
        nudges: finalNudges,
        knowledgeCards: knowledgeCards.slice(0, 4),
        momentTag,
        issueType,
        resolutionStatus: parsed.resolution_status ?? 'diagnosing',
        proposedActions,
        empathyNote: parsed.empathy_note ?? null,
      });
    } catch (err) {
      this.logger.error(`Support LLM tick error (${sessionId}): ${(err as Error).message}`);
      this.runFallbackTick(sessionId, state, opts.reason);
    }
  }

  private runFallbackTick(sessionId: string, state: SupportEngineState, reason: TickReason) {
    const fallback = this.buildDeterministicFallback(
      state.lastCustomerUtteranceText,
      state.stats.issueType,
    );
    const stage = state.context?.stages[state.currentStageIdx];

    this.emitSuggestions(sessionId, state, {
      suggestions: [fallback],
      nudges: this.buildFallbackNudges(state),
      knowledgeCards: [],
      momentTag: stage?.name ?? 'Support',
      issueType: state.stats.issueType,
      resolutionStatus: 'diagnosing',
      proposedActions: [],
      empathyNote: null,
    });
  }

  // ── Private: Prompt Building ──────────────────────────────────────────────

  private buildSystemPrompt(
    context: SessionContext,
    currentStage: StageInfo,
    ragSnippets: RagSnippet[],
    state: SupportEngineState,
  ): string {
    const contextBlock = buildSupportContextBlock(context.supportAgentContext);
    const stageList = context.stages
      .map((s, i) => `${i + 1}. ${s.name} — ${s.goals}`)
      .join('\n');
    const checklistBlock = state.checklistState.length > 0
      ? state.checklistState.map((item) => `${item.done ? '[x]' : '[ ]'} ${item.label}`).join('\n')
      : 'No checklist for this stage.';
    const ragSection = ragSnippets.length > 0
      ? ragSnippets
          .slice(0, 8)
          .map((s, i) => `${i + 1}. [${s.field}] ${s.text}`)
          .join('\n')
      : 'None';
    const recentPrimary = state.recentPrimarySuggestions.length > 0
      ? state.recentPrimarySuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'None';
    const actionResultsSection = state.coachMemory.action_results.length > 0
      ? state.coachMemory.action_results
          .map((r) => `- ${r.name}: ${JSON.stringify(r.output).slice(0, 300)}`)
          .join('\n')
      : 'None';

    const agentAddon = context.agentPromptDelta
      ? `\nAgent Add-on Instructions: ${context.agentPromptDelta}\n`
      : '';

    return (
      `${SUPPORT_COPILOT_SYSTEM_PROMPT}\n\n` +
      agentAddon +
      `Support Context:\n${contextBlock}\n\n` +
      `Support Playbook:\n` +
      `Stage map:\n${stageList}\n` +
      `Current stage: ${currentStage.name}\n` +
      `Current stage checklist:\n${checklistBlock}\n\n` +
      `Retrieved knowledge for this turn:\n${ragSection}\n\n` +
      `Recent primary suggestions (avoid repeating):\n${recentPrimary}\n\n` +
      `Action results:\n${actionResultsSection}\n\n` +
      `Rules:\n` +
      `- Never invent facts. Only reference what is in the knowledge base.\n` +
      `- If uncertain, propose an action to look up the information.\n` +
      `- Primary must be 1-2 sentences and speakable.\n` +
      `- Nudges must be 2-3 items, <=6 words each.\n` +
      `- Moment must be 2-4 words.\n` +
      `- Return JSON only.\n`
    );
  }

  // ── Private: RAG ──────────────────────────────────────────────────────────

  private retrieveSnippets(
    documents: RagDocument[],
    recentTurns: string,
    issueType: string | null,
  ): RagSnippet[] {
    if (documents.length === 0) return [];

    const queryTokens = this.tokenize(recentTurns);
    if (queryTokens.length === 0) return [];

    const querySet = new Set(queryTokens);
    const boostedFields = new Set(
      issueType ? (FIELD_BOOSTS_BY_ISSUE[issueType] ?? []) : [],
    );

    const scored: RagSnippet[] = documents.map((doc) => {
      const docTokens = this.tokenize(doc.text);
      let overlap = 0;
      for (const token of docTokens) {
        if (querySet.has(token)) overlap++;
      }
      let score = docTokens.length > 0 ? overlap / docTokens.length : 0;
      if (boostedFields.has(doc.field)) score *= 1.5;
      return { field: doc.field, text: doc.text.slice(0, 500), score };
    });

    return scored
      .filter((s) => s.score > 0.02)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  // ── Private: Helpers ──────────────────────────────────────────────────────

  private countWords(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    // Order numbers
    const orderMatch = text.match(/(?:order|#)\s*([A-Z0-9-]{4,})/i);
    if (orderMatch) entities.push(`order: ${orderMatch[1]}`);
    // Email
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch) entities.push(`email: ${emailMatch[0]}`);
    // Phone
    const phoneMatch = text.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
    if (phoneMatch) entities.push(`phone: ${phoneMatch[0]}`);
    // Account ID
    const accountMatch = text.match(/(?:account|acct)\s*#?\s*([A-Z0-9-]{4,})/i);
    if (accountMatch) entities.push(`account: ${accountMatch[1]}`);
    return entities;
  }

  private buildDeterministicFallback(customerText: string, issueType: string | null): string {
    if (!customerText.trim()) {
      return 'How can I help you today?';
    }
    if (issueType === 'BILLING') {
      return "I'd be happy to help with your billing concern. Could you share your account or order number so I can pull up the details?";
    }
    if (issueType === 'TECHNICAL') {
      return "I understand you're experiencing a technical issue. Can you walk me through exactly what's happening so I can help troubleshoot?";
    }
    if (issueType === 'SHIPPING') {
      return "Let me look into your shipping concern. Do you have an order number I can use to check the status?";
    }
    if (issueType === 'CANCELLATION') {
      return "I'd like to understand your situation better before we proceed. Could you share what's prompting this so I can see if there's something we can resolve?";
    }
    if (issueType === 'ACCOUNT') {
      return "I can help with your account. Can you verify the email address or account ID associated with it?";
    }
    // Generic but specific
    const words = customerText.split(/\s+/).slice(0, 4).join(' ');
    return `I hear you regarding ${words}. Let me look into this — could you share any reference numbers or details that would help me find the right information?`;
  }

  private buildFallbackNudges(state: SupportEngineState): string[] {
    const nudges: string[] = [];
    if (!state.stats.issueType) nudges.push('Identify the issue type');
    if (state.stats.customerTurns < 2) nudges.push('Ask for details');
    if (state.stats.sentiment === 'frustrated' || state.stats.sentiment === 'angry') {
      nudges.push('Acknowledge frustration');
    }
    if (state.currentStageIdx >= 2) nudges.push('Confirm resolution');
    nudges.push('Check knowledge base');
    return nudges.slice(0, 3);
  }

  private computeSupportMoment(stageName: string, stats: SessionStats): string {
    if (stats.sentiment === 'angry') return 'Escalation risk';
    if (stats.sentiment === 'frustrated') return 'Frustrated customer';
    if (stats.issueType === 'BILLING') return 'Billing inquiry';
    if (stats.issueType === 'TECHNICAL') return 'Technical issue';
    if (stats.issueType === 'SHIPPING') return 'Shipping question';
    if (stats.issueType === 'CANCELLATION') return 'Cancellation request';
    if (stats.issueType === 'ACCOUNT') return 'Account issue';
    const stage = stageName.toLowerCase();
    if (stage.includes('identification')) return 'Identifying issue';
    if (stage.includes('diagnosis')) return 'Diagnosing';
    if (stage.includes('resolution')) return 'Resolving';
    if (stage.includes('closure')) return 'Wrapping up';
    return 'Support';
  }

  private maybeAdvanceStage(state: SupportEngineState, resolutionStatus?: string) {
    if (!state.context) return;
    const stages = state.context.stages;

    let targetIdx = state.currentStageIdx;
    if (resolutionStatus === 'resolving' && state.currentStageIdx < 2) targetIdx = 2;
    else if (resolutionStatus === 'resolved' && state.currentStageIdx < 3) targetIdx = 3;
    else if (resolutionStatus === 'diagnosing' && state.currentStageIdx < 1) targetIdx = 1;

    if (targetIdx !== state.currentStageIdx && targetIdx < stages.length) {
      state.currentStageIdx = targetIdx;
      const newStage = stages[targetIdx];
      if (newStage) {
        state.checklistState = newStage.checklist.map((label) => ({ label, done: false }));
        this.gateway.emitToSession(state.context.sessionId, 'engine.stage', {
          stageIdx: targetIdx,
          stageName: newStage.name,
        });
        this.gateway.emitToSession(state.context.sessionId, 'engine.checklist', {
          items: state.checklistState,
        });
      }
    }
  }

  private areSuggestionsSimilar(a: string, b: string): boolean {
    const ta = new Set(this.tokenize(a).slice(0, 16));
    const tb = new Set(this.tokenize(b).slice(0, 16));
    if (ta.size === 0 || tb.size === 0) return false;
    let intersection = 0;
    for (const token of ta) {
      if (tb.has(token)) intersection++;
    }
    const union = ta.size + tb.size - intersection;
    return union > 0 ? intersection / union >= 0.7 : false;
  }
}

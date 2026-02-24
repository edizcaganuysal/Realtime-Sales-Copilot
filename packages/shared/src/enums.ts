export enum Role {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  REP = 'REP',
}

export enum AgentScope {
  PERSONAL = 'PERSONAL',
  ORG = 'ORG',
}

export enum AgentStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum PublisherPolicy {
  ADMIN_ONLY = 'ADMIN_ONLY',
  ADMIN_AND_MANAGERS = 'ADMIN_AND_MANAGERS',
}

export enum LiveLayout {
  MINIMAL = 'MINIMAL',
  STANDARD = 'STANDARD',
  TRANSCRIPT = 'TRANSCRIPT',
}

export enum GuidanceLevel {
  MINIMAL = 'MINIMAL',
  STANDARD = 'STANDARD',
  GUIDED = 'GUIDED',
}

export enum CallMode {
  OUTBOUND = 'OUTBOUND',
  MOCK = 'MOCK',
  AI_CALLER = 'AI_CALLER',
  SUPPORT = 'SUPPORT',
}

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
  ESCALATED = 'ESCALATED',
}

export enum ActionStatus {
  PROPOSED = 'PROPOSED',
  APPROVED = 'APPROVED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

export enum ActionRisk {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum SupportIssueType {
  BILLING = 'BILLING',
  TECHNICAL = 'TECHNICAL',
  ACCOUNT = 'ACCOUNT',
  SHIPPING = 'SHIPPING',
  CANCELLATION = 'CANCELLATION',
  GENERAL = 'GENERAL',
}

export enum ProductsMode {
  ALL = 'ALL',
  SELECTED = 'SELECTED',
}

export const FAST_CALL_MODELS = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o'] as const;
export type FastCallModel = (typeof FAST_CALL_MODELS)[number];

export const AI_CALLER_VOICES = ['marin', 'cedar', 'ash', 'ballad', 'coral', 'sage', 'verse', 'alloy', 'echo', 'shimmer'] as const;
export type AiCallerVoice = (typeof AI_CALLER_VOICES)[number];

export const AI_CALLER_MODELS = ['gpt-4o-mini-realtime-preview', 'gpt-4o-realtime-preview'] as const;
export type AiCallerModel = (typeof AI_CALLER_MODELS)[number];

export enum CallStatus {
  INITIATED = 'INITIATED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export const RETENTION_DAYS = [30, 90, 365] as const;
export type RetentionDays = (typeof RETENTION_DAYS)[number];

export type NudgeType =
  | 'ASK_QUESTION'
  | 'ADDRESS_OBJECTION'
  | 'TOO_MUCH_TALKING'
  | 'MISSING_NEXT_STEP'
  | 'SOFTEN_TONE'
  | 'SLOW_DOWN'
  | 'CONFIRM_UNDERSTANDING';

export const NUDGE_LABELS: Record<NudgeType, string> = {
  ASK_QUESTION: "You haven't asked a question",
  ADDRESS_OBJECTION: 'Address objection',
  TOO_MUCH_TALKING: 'Too much talking',
  MISSING_NEXT_STEP: 'Missing next step',
  SOFTEN_TONE: 'Tone: soften',
  SLOW_DOWN: 'Slow down',
  CONFIRM_UNDERSTANDING: 'Check understanding',
};

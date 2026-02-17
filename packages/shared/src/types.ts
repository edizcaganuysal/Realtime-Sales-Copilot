import type {
  AgentScope,
  AgentStatus,
  CallStatus,
  GuidanceLevel,
  LiveLayout,
  NudgeType,
  PublisherPolicy,
  RetentionDays,
  Role,
} from './enums';

// ─── Org ────────────────────────────────────────────────────────────────────

export interface OrgGovernance {
  requiresAgentApproval: boolean;
  allowRepAgentCreation: boolean;
  publisherPolicy: PublisherPolicy;
  liveLayoutDefault: LiveLayout;
  retentionDays: RetentionDays;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  governance: OrgGovernance;
  createdAt: Date;
  updatedAt: Date;
}

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Agent ──────────────────────────────────────────────────────────────────

export interface AgentStage {
  id: string;
  name: string;
  order: number;
  checklist: string[];
}

export interface Agent {
  id: string;
  orgId: string;
  createdByUserId: string;
  name: string;
  description: string;
  scope: AgentScope;
  status: AgentStatus;
  stages: AgentStage[];
  systemPrompt: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Call ───────────────────────────────────────────────────────────────────

export interface Call {
  id: string;
  orgId: string;
  repUserId: string;
  agentId: string | null;
  prospectPhone: string;
  prospectName: string | null;
  status: CallStatus;
  guidanceLevel: GuidanceLevel;
  layout: LiveLayout;
  twilioCallSid: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Transcript ──────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  id: string;
  callId: string;
  speaker: 'REP' | 'PROSPECT';
  text: string;
  timestampMs: number; // ms from call start
  createdAt: Date;
}

// ─── Coaching ────────────────────────────────────────────────────────────────

export interface CoachingSuggestion {
  id: string;
  callId: string;
  primary: string;
  alternatives: [string, string]; // exactly 2 "more options"
  nudges: NudgeType[];
  currentStage: string;
  generatedAt: Date;
}

// ─── WebSocket event shapes ──────────────────────────────────────────────────

export interface WsTranscriptEvent {
  type: 'TRANSCRIPT';
  payload: TranscriptEntry;
}

export interface WsCoachingEvent {
  type: 'COACHING';
  payload: CoachingSuggestion;
}

export type WsServerEvent = WsTranscriptEvent | WsCoachingEvent;

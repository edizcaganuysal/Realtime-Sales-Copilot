import { z } from 'zod';
import { AgentScope, GuidanceLevel, LiveLayout, PublisherPolicy, Role } from './enums';

// ─── Org ────────────────────────────────────────────────────────────────────

export const OrgGovernanceSchema = z.object({
  requiresAgentApproval: z.boolean(),
  allowRepAgentCreation: z.boolean(),
  publisherPolicy: z.nativeEnum(PublisherPolicy),
  liveLayoutDefault: z.nativeEnum(LiveLayout),
  retentionDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
});

export const CreateOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

// ─── User ───────────────────────────────────────────────────────────────────

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.nativeEnum(Role),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Agent ──────────────────────────────────────────────────────────────────

export const AgentStageSchema = z.object({
  name: z.string().min(1).max(100),
  order: z.number().int().min(0),
  checklist: z.array(z.string().max(200)).max(10).default([]),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  scope: z.nativeEnum(AgentScope),
  stages: z.array(AgentStageSchema).max(10).default([]),
  systemPrompt: z.string().max(4000).default(''),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

// ─── Call ───────────────────────────────────────────────────────────────────

export const CreateCallSchema = z.object({
  agentId: z.string().uuid().nullable().default(null),
  prospectPhone: z.string().min(7).max(20),
  prospectName: z.string().max(100).nullable().default(null),
  guidanceLevel: z.nativeEnum(GuidanceLevel).default(GuidanceLevel.STANDARD),
  layout: z.nativeEnum(LiveLayout).optional(),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type OrgGovernanceInput = z.infer<typeof OrgGovernanceSchema>;
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type CreateCallInput = z.infer<typeof CreateCallSchema>;

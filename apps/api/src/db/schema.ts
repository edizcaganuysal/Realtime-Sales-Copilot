import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'MANAGER', 'REP']);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'INVITED', 'DISABLED']);

export const publisherPolicyEnum = pgEnum('publisher_policy', [
  'ADMIN_ONLY',
  'ADMIN_AND_MANAGERS',
]);

export const liveLayoutEnum = pgEnum('live_layout', ['MINIMAL', 'STANDARD', 'TRANSCRIPT']);

export const guidanceLevelEnum = pgEnum('guidance_level', ['MINIMAL', 'STANDARD', 'GUIDED']);

export const agentScopeEnum = pgEnum('agent_scope', ['PERSONAL', 'ORG']);

export const agentStatusEnum = pgEnum('agent_status', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
]);

export const suggestionKindEnum = pgEnum('suggestion_kind', ['PRIMARY', 'ALTERNATIVE']);

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orgSettings = pgTable('org_settings', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  requiresAgentApproval: boolean('requires_agent_approval').default(true).notNull(),
  allowRepAgentCreation: boolean('allow_rep_agent_creation').default(true).notNull(),
  publisherPolicy: publisherPolicyEnum('publisher_policy')
    .default('ADMIN_AND_MANAGERS')
    .notNull(),
  liveLayoutDefault: liveLayoutEnum('live_layout_default').default('STANDARD').notNull(),
  retentionDays: integer('retention_days').default(90).notNull(),
});

export const orgCompanyProfiles = pgTable('org_company_profiles', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  companyName: text('company_name').notNull(),
  productName: text('product_name').notNull(),
  productSummary: text('product_summary').notNull(),
  idealCustomerProfile: text('ideal_customer_profile').notNull(),
  valueProposition: text('value_proposition').notNull(),
  differentiators: text('differentiators').notNull(),
  proofPoints: text('proof_points').notNull(),
  repTalkingPoints: text('rep_talking_points').notNull(),
  discoveryGuidance: text('discovery_guidance').notNull(),
  qualificationGuidance: text('qualification_guidance').notNull(),
  objectionHandling: text('objection_handling').notNull(),
  competitorGuidance: text('competitor_guidance').notNull(),
  pricingGuidance: text('pricing_guidance').notNull(),
  implementationGuidance: text('implementation_guidance').notNull(),
  faq: text('faq').notNull(),
  doNotSay: text('do_not_say').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  status: userStatusEnum('status').default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const playbooks = pgTable('playbooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const playbookStages = pgTable('playbook_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  playbookId: uuid('playbook_id')
    .notNull()
    .references(() => playbooks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  goals: text('goals'),
  checklistJson: jsonb('checklist_json').default([]).notNull(),
  intentWeightsJson: jsonb('intent_weights_json').default({}).notNull(),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  scope: agentScopeEnum('scope').notNull(),
  status: agentStatusEnum('status').default('DRAFT').notNull(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  configJson: jsonb('config_json').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  playbookId: uuid('playbook_id').references(() => playbooks.id, { onDelete: 'set null' }),
  mode: text('mode').notNull().default('OUTBOUND'),
  guidanceLevel: guidanceLevelEnum('guidance_level').default('STANDARD').notNull(),
  layoutPreset: liveLayoutEnum('layout_preset').default('STANDARD').notNull(),
  status: text('status').default('INITIATED').notNull(),
  phoneTo: text('phone_to').notNull(),
  contactJson: jsonb('contact_json').default({}).notNull(),
  notes: text('notes'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  twilioCallSid: text('twilio_call_sid'),
});

export const callTranscript = pgTable('call_transcript', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: uuid('call_id')
    .notNull()
    .references(() => calls.id, { onDelete: 'cascade' }),
  tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
  speaker: text('speaker').notNull(),
  text: text('text').notNull(),
  isFinal: boolean('is_final').default(false).notNull(),
});

export const callEvents = pgTable('call_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: uuid('call_id')
    .notNull()
    .references(() => calls.id, { onDelete: 'cascade' }),
  tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
  type: text('type').notNull(),
  payloadJson: jsonb('payload_json').default({}).notNull(),
});

export const callSuggestions = pgTable('call_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: uuid('call_id')
    .notNull()
    .references(() => calls.id, { onDelete: 'cascade' }),
  tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
  kind: suggestionKindEnum('kind').notNull(),
  rank: integer('rank').default(0).notNull(),
  text: text('text').notNull(),
  intent: text('intent'),
  metaJson: jsonb('meta_json').default({}).notNull(),
});

export const callSummaries = pgTable('call_summaries', {
  callId: uuid('call_id')
    .primaryKey()
    .references(() => calls.id, { onDelete: 'cascade' }),
  summaryJson: jsonb('summary_json').default({}).notNull(),
  coachingJson: jsonb('coaching_json').default({}).notNull(),
  checklistResultsJson: jsonb('checklist_results_json').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

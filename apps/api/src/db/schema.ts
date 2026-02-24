import {
  pgTable,
  pgEnum,
  primaryKey,
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

export const salesContext = pgTable('sales_context', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  companyName: text('company_name'),
  whatWeSell: text('what_we_sell'),
  howItWorks: text('how_it_works'),
  strategy: text('strategy'),
  offerCategory: text('offer_category'),
  targetCustomer: text('target_customer'),
  targetRoles: jsonb('target_roles').default([]).notNull(),
  industries: jsonb('industries').default([]).notNull(),
  buyingTriggers: jsonb('buying_triggers').default([]).notNull(),
  disqualifiers: jsonb('disqualifiers').default([]).notNull(),
  globalValueProps: jsonb('global_value_props').default([]).notNull(),
  proofPoints: jsonb('proof_points').default([]).notNull(),
  caseStudies: jsonb('case_studies').default([]).notNull(),
  allowedClaims: jsonb('allowed_claims').default([]).notNull(),
  forbiddenClaims: jsonb('forbidden_claims').default([]).notNull(),
  salesPolicies: jsonb('sales_policies').default([]).notNull(),
  escalationRules: jsonb('escalation_rules').default([]).notNull(),
  nextSteps: jsonb('next_steps').default([]).notNull(),
  competitors: jsonb('competitors').default([]).notNull(),
  positioningRules: jsonb('positioning_rules').default([]).notNull(),
  discoveryQuestions: jsonb('discovery_questions').default([]).notNull(),
  qualificationRubric: jsonb('qualification_rubric').default([]).notNull(),
  knowledgeAppendix: text('knowledge_appendix'),
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
  useDefaultTemplate: boolean('use_default_template').default(true).notNull(),
  promptDelta: text('prompt_delta').default('').notNull(),
  fullPromptOverride: text('full_prompt_override'),
  configJson: jsonb('config_json').default({}).notNull(),
  openers: jsonb('openers').default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  elevatorPitch: text('elevator_pitch'),
  valueProps: jsonb('value_props').default([]).notNull(),
  differentiators: jsonb('differentiators').default([]).notNull(),
  pricingRules: jsonb('pricing_rules').default({}).notNull(),
  dontSay: jsonb('dont_say').default([]).notNull(),
  faqs: jsonb('faqs').default([]).notNull(),
  objections: jsonb('objections').default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  monthlyCredits: integer('monthly_credits').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

export const orgSubscription = pgTable('org_subscription', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id),
  status: text('status').default('active').notNull(),
  creditsBalance: integer('credits_balance').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  metadataJson: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const creditPurchaseRequests = pgTable('credit_purchase_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  package: text('package').notNull(),
  credits: integer('credits').notNull(),
  notes: text('notes'),
  status: text('status').default('new').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const fineTuneRequests = pgTable('fine_tune_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  dataSources: jsonb('data_sources').default([]).notNull(),
  complianceNotes: text('compliance_notes'),
  notes: text('notes'),
  status: text('status').default('new').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ingestionJobs = pgTable('ingestion_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  target: text('target').notNull(),
  sourceType: text('source_type').notNull(),
  status: text('status').default('queued').notNull(),
  input: jsonb('input').default({}).notNull(),
  result: jsonb('result').default({}),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ingestionAssets = pgTable('ingestion_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => ingestionJobs.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  uri: text('uri').notNull(),
  title: text('title'),
  contentText: text('content_text'),
  contentSha: text('content_sha'),
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
  callType: text('call_type').default('cold_outbound').notNull(),
  guidanceLevel: guidanceLevelEnum('guidance_level').default('STANDARD').notNull(),
  layoutPreset: liveLayoutEnum('layout_preset').default('STANDARD').notNull(),
  productsMode: text('products_mode').default('ALL').notNull(),
  status: text('status').default('INITIATED').notNull(),
  phoneTo: text('phone_to').notNull(),
  contactJson: jsonb('contact_json').default({}).notNull(),
  notes: text('notes'),
  outcome: text('outcome').default('unknown').notNull(),
  dealValue: integer('deal_value'),
  preparedOpenerText: text('prepared_opener_text'),
  preparedOpenerGeneratedAt: timestamp('prepared_opener_generated_at', {
    withTimezone: true,
  }),
  preparedFollowupSeed: text('prepared_followup_seed'),
  coachMemory: jsonb('coach_memory').default({}).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  twilioCallSid: text('twilio_call_sid'),
});

export const callProducts = pgTable(
  'call_products',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.callId, table.productId] }),
  }),
);

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

/* ─── Support Copilot Tables ─── */

export const sessionStatusEnum = pgEnum('session_status', [
  'ACTIVE',
  'RESOLVED',
  'ESCALATED',
]);

export const actionStatusEnum = pgEnum('action_status', [
  'PROPOSED',
  'APPROVED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
]);

export const actionRiskEnum = pgEnum('action_risk', ['LOW', 'MEDIUM', 'HIGH']);

export const supportContext = pgTable('support_context', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  supportFaqs: jsonb('support_faqs').default([]).notNull(),
  troubleshootingGuides: jsonb('troubleshooting_guides').default([]).notNull(),
  returnRefundPolicy: text('return_refund_policy').default(''),
  slaRules: jsonb('sla_rules').default([]).notNull(),
  commonIssues: jsonb('common_issues').default([]).notNull(),
  supportKnowledgeAppendix: text('support_knowledge_appendix').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  configJson: jsonb('config_json').default({}).notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const actionDefinitions = pgTable('action_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  integrationId: uuid('integration_id')
    .notNull()
    .references(() => integrations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  triggerPhrases: jsonb('trigger_phrases').default([]).notNull(),
  inputSchema: jsonb('input_schema').default({}).notNull(),
  executionConfig: jsonb('execution_config').default({}).notNull(),
  requiresApproval: boolean('requires_approval').default(true).notNull(),
  riskLevel: actionRiskEnum('risk_level').default('LOW').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const supportSessions = pgTable('support_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: sessionStatusEnum('status').default('ACTIVE').notNull(),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  customerJson: jsonb('customer_json').default({}).notNull(),
  issueCategory: text('issue_category'),
  coachMemory: jsonb('coach_memory').default({}).notNull(),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const actionExecutions = pgTable('action_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => supportSessions.id, { onDelete: 'cascade' }),
  definitionId: uuid('definition_id')
    .notNull()
    .references(() => actionDefinitions.id),
  status: actionStatusEnum('action_exec_status').default('PROPOSED').notNull(),
  inputJson: jsonb('input_json').default({}).notNull(),
  outputJson: jsonb('output_json'),
  errorMessage: text('error_message'),
  proposedAt: timestamp('proposed_at', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const supportTranscript = pgTable('support_transcript', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => supportSessions.id, { onDelete: 'cascade' }),
  tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
  speaker: text('speaker').notNull(),
  text: text('text').notNull(),
  isFinal: boolean('is_final').default(true).notNull(),
});

export const supportSuggestions = pgTable('support_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => supportSessions.id, { onDelete: 'cascade' }),
  tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
  kind: suggestionKindEnum('kind').notNull(),
  rank: integer('rank').default(0).notNull(),
  text: text('text').notNull(),
  intent: text('intent'),
  metaJson: jsonb('meta_json').default({}).notNull(),
});

-- =============================================================================
-- Sales AI — Full schema + seed for Supabase SQL Editor
-- Paste this entire file into: Supabase Dashboard → SQL Editor → Run
-- =============================================================================

-- Required extension for password hashing in seed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "public"."agent_scope" AS ENUM('PERSONAL', 'ORG');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."agent_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."guidance_level" AS ENUM('MINIMAL', 'STANDARD', 'GUIDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."live_layout" AS ENUM('MINIMAL', 'STANDARD', 'TRANSCRIPT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."publisher_policy" AS ENUM('ADMIN_ONLY', 'ADMIN_AND_MANAGERS');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."role" AS ENUM('ADMIN', 'MANAGER', 'REP');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."suggestion_kind" AS ENUM('PRIMARY', 'ALTERNATIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INVITED', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "orgs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "org_settings" (
  "org_id" uuid PRIMARY KEY NOT NULL,
  "requires_agent_approval" boolean DEFAULT true NOT NULL,
  "allow_rep_agent_creation" boolean DEFAULT true NOT NULL,
  "publisher_policy" "publisher_policy" DEFAULT 'ADMIN_AND_MANAGERS' NOT NULL,
  "live_layout_default" "live_layout" DEFAULT 'STANDARD' NOT NULL,
  "retention_days" integer DEFAULT 90 NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "role" "role" NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "playbook_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playbook_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "name" text NOT NULL,
  "goals" text,
  "checklist_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "intent_weights_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "owner_user_id" uuid,
  "scope" "agent_scope" NOT NULL,
  "status" "agent_status" DEFAULT 'DRAFT' NOT NULL,
  "name" text NOT NULL,
  "prompt" text NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "agent_id" uuid,
  "playbook_id" uuid,
  "mode" text DEFAULT 'OUTBOUND' NOT NULL,
  "guidance_level" "guidance_level" DEFAULT 'STANDARD' NOT NULL,
  "layout_preset" "live_layout" DEFAULT 'STANDARD' NOT NULL,
  "status" text DEFAULT 'INITIATED' NOT NULL,
  "phone_to" text NOT NULL,
  "contact_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notes" text,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "twilio_call_sid" text
);

CREATE TABLE IF NOT EXISTS "call_transcript" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "call_id" uuid NOT NULL,
  "ts_ms" bigint NOT NULL,
  "speaker" text NOT NULL,
  "text" text NOT NULL,
  "is_final" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "call_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "call_id" uuid NOT NULL,
  "ts_ms" bigint NOT NULL,
  "type" text NOT NULL,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "call_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "call_id" uuid NOT NULL,
  "ts_ms" bigint NOT NULL,
  "kind" "suggestion_kind" NOT NULL,
  "rank" integer DEFAULT 0 NOT NULL,
  "text" text NOT NULL,
  "intent" text,
  "meta_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "call_summaries" (
  "call_id" uuid PRIMARY KEY NOT NULL,
  "summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "coaching_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "checklist_results_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ── Foreign Keys ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "playbook_stages" ADD CONSTRAINT "playbook_stages_playbook_id_playbooks_id_fk"
    FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_agents_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_playbook_id_playbooks_id_fk"
    FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "call_suggestions" ADD CONSTRAINT "call_suggestions_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_call_id_calls_id_fk"
    FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Seed Data ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_org_id uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  v_user_id uuid := 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  v_playbook_id uuid := 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  v_agent_id uuid := 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
BEGIN

  INSERT INTO orgs (id, name)
  VALUES (v_org_id, 'Demo Org')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO org_settings (org_id, requires_agent_approval, allow_rep_agent_creation, publisher_policy, live_layout_default, retention_days)
  VALUES (v_org_id, true, true, 'ADMIN_AND_MANAGERS', 'STANDARD', 90)
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO users (id, org_id, role, name, email, password_hash, status)
  VALUES (
    v_user_id,
    v_org_id,
    'ADMIN',
    'Admin User',
    'admin@example.com',
    crypt('Password123!', gen_salt('bf', 10)),
    'ACTIVE'
  )
  ON CONFLICT (email) DO NOTHING;

  INSERT INTO playbooks (id, org_id, name, is_default)
  VALUES (v_playbook_id, v_org_id, 'Default Sales Playbook', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO playbook_stages (playbook_id, position, name, goals, checklist_json) VALUES
    (v_playbook_id, 0, 'Opening', 'Establish rapport and set agenda',
      '["Introduce yourself", "State purpose of call", "Confirm prospect has time"]'::jsonb),
    (v_playbook_id, 1, 'Discovery', 'Understand prospect needs and pain points',
      '["Ask about current solution", "Identify pain points", "Quantify impact", "Understand decision process"]'::jsonb),
    (v_playbook_id, 2, 'Pitch', 'Present value proposition tailored to needs',
      '["Recap discovered needs", "Present relevant features", "Share social proof", "Highlight ROI"]'::jsonb),
    (v_playbook_id, 3, 'Objection Handling', 'Address concerns and build confidence',
      '["Acknowledge objection", "Clarify if needed", "Respond with evidence", "Confirm resolution"]'::jsonb),
    (v_playbook_id, 4, 'Close', 'Secure commitment and define next steps',
      '["Summarize agreed value", "Propose next step", "Confirm timeline", "Schedule follow-up"]'::jsonb);

  INSERT INTO agents (id, org_id, owner_user_id, scope, status, name, prompt, config_json)
  VALUES (
    v_agent_id,
    v_org_id,
    null,
    'ORG',
    'APPROVED',
    'Default Coach',
    'You are a live sales coaching assistant. Listen to the conversation and provide concise, actionable suggestions to help the sales rep close the deal. Focus on uncovering needs, handling objections, and guiding toward a close.',
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

END $$;

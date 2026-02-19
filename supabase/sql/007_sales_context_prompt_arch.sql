create extension if not exists pgcrypto;

create table if not exists public.sales_context (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  company_name text,
  what_we_sell text,
  offer_category text,
  target_customer text,
  target_roles jsonb default '[]'::jsonb,
  industries jsonb default '[]'::jsonb,
  disqualifiers jsonb default '[]'::jsonb,
  proof_points jsonb default '[]'::jsonb,
  allowed_claims jsonb default '[]'::jsonb,
  forbidden_claims jsonb default '[]'::jsonb,
  sales_policies jsonb default '[]'::jsonb,
  escalation_rules jsonb default '[]'::jsonb,
  next_steps jsonb default '[]'::jsonb,
  scheduling_link text,
  competitors jsonb default '[]'::jsonb,
  positioning_rules jsonb default '[]'::jsonb,
  discovery_questions jsonb default '[]'::jsonb,
  qualification_rubric jsonb default '[]'::jsonb,
  knowledge_appendix text,
  updated_at timestamptz default now()
);

alter table public.agents
  add column if not exists use_default_template boolean default true;

update public.agents
set use_default_template = true
where use_default_template is null;

alter table public.agents
  alter column use_default_template set not null;

alter table public.agents
  add column if not exists prompt_delta text default '';

update public.agents
set prompt_delta = ''
where prompt_delta is null;

alter table public.agents
  alter column prompt_delta set not null;

alter table public.agents
  add column if not exists full_prompt_override text;

alter table public.calls
  add column if not exists call_type text default 'cold_outbound';

update public.calls
set call_type = 'cold_outbound'
where call_type is null;

alter table public.calls
  alter column call_type set not null;

alter table public.calls
  add column if not exists prepared_opener_text text;

alter table public.calls
  add column if not exists prepared_opener_generated_at timestamptz;

alter table public.calls
  add column if not exists coach_memory jsonb default '{}'::jsonb;

update public.calls
set coach_memory = '{}'::jsonb
where coach_memory is null;

alter table public.calls
  alter column coach_memory set not null;

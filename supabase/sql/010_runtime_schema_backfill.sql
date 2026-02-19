create extension if not exists pgcrypto;

create table if not exists public.sales_context (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  company_name text,
  what_we_sell text,
  how_it_works text,
  offer_category text,
  target_customer text,
  target_roles jsonb default '[]'::jsonb not null,
  industries jsonb default '[]'::jsonb not null,
  buying_triggers jsonb default '[]'::jsonb not null,
  disqualifiers jsonb default '[]'::jsonb not null,
  global_value_props jsonb default '[]'::jsonb not null,
  proof_points jsonb default '[]'::jsonb not null,
  case_studies jsonb default '[]'::jsonb not null,
  allowed_claims jsonb default '[]'::jsonb not null,
  forbidden_claims jsonb default '[]'::jsonb not null,
  sales_policies jsonb default '[]'::jsonb not null,
  escalation_rules jsonb default '[]'::jsonb not null,
  next_steps jsonb default '[]'::jsonb not null,
  competitors jsonb default '[]'::jsonb not null,
  positioning_rules jsonb default '[]'::jsonb not null,
  discovery_questions jsonb default '[]'::jsonb not null,
  qualification_rubric jsonb default '[]'::jsonb not null,
  knowledge_appendix text,
  updated_at timestamptz default now() not null
);

alter table if exists public.sales_context
  add column if not exists company_name text,
  add column if not exists what_we_sell text,
  add column if not exists how_it_works text,
  add column if not exists offer_category text,
  add column if not exists target_customer text,
  add column if not exists target_roles jsonb default '[]'::jsonb not null,
  add column if not exists industries jsonb default '[]'::jsonb not null,
  add column if not exists buying_triggers jsonb default '[]'::jsonb not null,
  add column if not exists disqualifiers jsonb default '[]'::jsonb not null,
  add column if not exists global_value_props jsonb default '[]'::jsonb not null,
  add column if not exists proof_points jsonb default '[]'::jsonb not null,
  add column if not exists case_studies jsonb default '[]'::jsonb not null,
  add column if not exists allowed_claims jsonb default '[]'::jsonb not null,
  add column if not exists forbidden_claims jsonb default '[]'::jsonb not null,
  add column if not exists sales_policies jsonb default '[]'::jsonb not null,
  add column if not exists escalation_rules jsonb default '[]'::jsonb not null,
  add column if not exists next_steps jsonb default '[]'::jsonb not null,
  add column if not exists competitors jsonb default '[]'::jsonb not null,
  add column if not exists positioning_rules jsonb default '[]'::jsonb not null,
  add column if not exists discovery_questions jsonb default '[]'::jsonb not null,
  add column if not exists qualification_rubric jsonb default '[]'::jsonb not null,
  add column if not exists knowledge_appendix text,
  add column if not exists updated_at timestamptz default now() not null;

alter table if exists public.sales_context
  drop column if exists scheduling_link;

alter table if exists public.agents
  add column if not exists use_default_template boolean default true;

update public.agents
set use_default_template = true
where use_default_template is null;

alter table if exists public.agents
  alter column use_default_template set not null;

alter table if exists public.agents
  add column if not exists prompt_delta text default '';

update public.agents
set prompt_delta = ''
where prompt_delta is null;

alter table if exists public.agents
  alter column prompt_delta set not null;

alter table if exists public.agents
  add column if not exists full_prompt_override text;

alter table if exists public.calls
  add column if not exists products_mode text default 'ALL',
  add column if not exists call_type text default 'cold_outbound',
  add column if not exists prepared_opener_text text,
  add column if not exists prepared_opener_generated_at timestamptz,
  add column if not exists coach_memory jsonb default '{}'::jsonb,
  add column if not exists outcome text default 'unknown',
  add column if not exists deal_value int;

update public.calls
set call_type = 'cold_outbound'
where call_type is null;

update public.calls
set coach_memory = '{}'::jsonb
where coach_memory is null;

update public.calls
set outcome = 'unknown'
where outcome is null;

alter table if exists public.calls
  alter column products_mode set default 'ALL';

alter table if exists public.calls
  alter column call_type set default 'cold_outbound';

alter table if exists public.calls
  alter column call_type set not null;

alter table if exists public.calls
  alter column coach_memory set default '{}'::jsonb;

alter table if exists public.calls
  alter column coach_memory set not null;

alter table if exists public.calls
  alter column outcome set default 'unknown';

alter table if exists public.calls
  alter column outcome set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calls_products_mode_check'
      and conrelid = 'public.calls'::regclass
  ) then
    alter table public.calls
      add constraint calls_products_mode_check
      check (products_mode in ('ALL', 'SELECTED'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calls_outcome_check'
      and conrelid = 'public.calls'::regclass
  ) then
    alter table public.calls
      add constraint calls_outcome_check
      check (outcome in ('won', 'lost', 'follow_up', 'unknown'));
  end if;
end $$;

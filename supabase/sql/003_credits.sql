create extension if not exists pgcrypto;

create table if not exists public.plans (
  id text primary key,
  name text not null,
  monthly_credits int not null,
  is_active bool default true
);

create table if not exists public.org_subscription (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text default 'active',
  credits_balance int default 0,
  updated_at timestamptz default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  type text not null,
  amount int not null,
  balance_after int not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists credit_ledger_org_created_idx
  on public.credit_ledger (org_id, created_at desc);

insert into public.plans (id, name, monthly_credits, is_active)
values
  ('starter', 'Starter', 50000, true),
  ('pro', 'Pro', 150000, true),
  ('business', 'Business', 400000, true)
on conflict (id) do update
set
  name = excluded.name,
  monthly_credits = excluded.monthly_credits,
  is_active = excluded.is_active;

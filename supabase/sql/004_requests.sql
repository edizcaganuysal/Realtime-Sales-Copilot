create extension if not exists pgcrypto;

create table if not exists public.sales_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid null,
  type text,
  name text,
  email text,
  company text,
  role text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists sales_requests_created_at_idx
  on public.sales_requests (created_at desc);

create table if not exists public.fine_tune_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  requested_by_user_id uuid not null references public.users(id) on delete cascade,
  data_sources jsonb default '[]'::jsonb,
  compliance_notes text,
  notes text,
  status text default 'new',
  created_at timestamptz default now()
);

create index if not exists fine_tune_requests_org_created_idx
  on public.fine_tune_requests (org_id, created_at desc);

create index if not exists fine_tune_requests_status_idx
  on public.fine_tune_requests (status);

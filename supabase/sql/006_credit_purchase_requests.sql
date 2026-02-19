create extension if not exists pgcrypto;

create table if not exists public.credit_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  requested_by_user_id uuid not null references public.users(id) on delete cascade,
  package text not null,
  credits int not null,
  notes text,
  status text default 'new',
  created_at timestamptz default now()
);

create index if not exists credit_purchase_requests_org_created_idx
  on public.credit_purchase_requests (org_id, created_at desc);

create index if not exists credit_purchase_requests_status_idx
  on public.credit_purchase_requests (status);

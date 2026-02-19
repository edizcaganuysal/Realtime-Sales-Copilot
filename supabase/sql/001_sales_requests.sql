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

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  elevator_pitch text,
  value_props jsonb default '[]'::jsonb,
  differentiators jsonb default '[]'::jsonb,
  pricing_rules jsonb default '{}'::jsonb,
  dont_say jsonb default '[]'::jsonb,
  faqs jsonb default '[]'::jsonb,
  objections jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create index if not exists products_org_id_name_idx
  on public.products (org_id, name);

alter table public.calls
  add column if not exists products_mode text default 'ALL';

update public.calls
set products_mode = 'ALL'
where products_mode is null;

alter table public.calls
  alter column products_mode set default 'ALL';

alter table public.calls
  alter column products_mode set not null;

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

create table if not exists public.call_products (
  call_id uuid not null references public.calls(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (call_id, product_id)
);

create index if not exists call_products_product_id_idx
  on public.call_products (product_id);

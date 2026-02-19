create extension if not exists pgcrypto;

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by_user_id uuid not null references public.users(id) on delete cascade,
  target text not null,
  source_type text not null,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  result jsonb default '{}'::jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ingestion_jobs_target_check'
      and conrelid = 'public.ingestion_jobs'::regclass
  ) then
    alter table public.ingestion_jobs
      add constraint ingestion_jobs_target_check
      check (target in ('COMPANY', 'PRODUCT'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ingestion_jobs_source_type_check'
      and conrelid = 'public.ingestion_jobs'::regclass
  ) then
    alter table public.ingestion_jobs
      add constraint ingestion_jobs_source_type_check
      check (source_type in ('WEBSITE', 'PDF'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ingestion_jobs_status_check'
      and conrelid = 'public.ingestion_jobs'::regclass
  ) then
    alter table public.ingestion_jobs
      add constraint ingestion_jobs_status_check
      check (status in ('queued', 'running', 'succeeded', 'failed'));
  end if;
end $$;

create index if not exists ingestion_jobs_org_created_idx
  on public.ingestion_jobs (org_id, created_at desc);

create index if not exists ingestion_jobs_status_idx
  on public.ingestion_jobs (status);

create table if not exists public.ingestion_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ingestion_jobs(id) on delete cascade,
  kind text not null,
  uri text not null,
  title text,
  content_text text,
  content_sha text,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ingestion_assets_kind_check'
      and conrelid = 'public.ingestion_assets'::regclass
  ) then
    alter table public.ingestion_assets
      add constraint ingestion_assets_kind_check
      check (kind in ('PDF', 'PAGE'));
  end if;
end $$;

create index if not exists ingestion_assets_job_idx
  on public.ingestion_assets (job_id, created_at desc);

alter table if exists public.calls
  add column if not exists outcome text default 'unknown',
  add column if not exists deal_value int;

update public.calls
set outcome = 'unknown'
where outcome is null;

alter table if exists public.calls
  alter column outcome set default 'unknown';

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

alter table if exists public.calls
  alter column outcome set not null;

update public.agents
set scope = 'PERSONAL',
    status = 'APPROVED'
where scope <> 'PERSONAL'
   or status <> 'APPROVED';

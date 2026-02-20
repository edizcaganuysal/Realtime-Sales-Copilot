alter table if exists public.call_suggestions
  add column if not exists text text;

alter table if exists public.call_suggestions
  alter column text type text;

alter table if exists public.calls
  add column if not exists prepared_opener_text text,
  add column if not exists prepared_followup_seed text;

alter table if exists public.calls
  alter column prepared_opener_text type text;

alter table if exists public.calls
  alter column prepared_followup_seed type text;

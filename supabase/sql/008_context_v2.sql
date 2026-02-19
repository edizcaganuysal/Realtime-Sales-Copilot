alter table if exists public.sales_context
  add column if not exists how_it_works text,
  add column if not exists buying_triggers jsonb default '[]'::jsonb not null,
  add column if not exists case_studies jsonb default '[]'::jsonb not null,
  add column if not exists global_value_props jsonb default '[]'::jsonb not null;

alter table if exists public.sales_context
  drop column if exists scheduling_link;

insert into public.plans (id, name, monthly_credits, is_active)
values ('free', 'Free', 1000, true)
on conflict (id) do update
set
  name = excluded.name,
  monthly_credits = excluded.monthly_credits,
  is_active = excluded.is_active;

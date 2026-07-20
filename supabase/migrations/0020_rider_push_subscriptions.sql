-- Assinaturas de Push dos aparelhos dos motoboys.
-- Somente a Edge Function, usando a Service Role, grava e lê estes dados.

create table if not exists public.rider_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  rider_id text not null,
  rider_name text,
  endpoint text not null unique,
  subscription_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rider_push_subscriptions_rider_id_idx
  on public.rider_push_subscriptions (rider_id);

alter table public.rider_push_subscriptions enable row level security;
revoke all on table public.rider_push_subscriptions from anon, authenticated;

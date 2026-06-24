-- Garra Delivery: instala apenas a estrutura necessária para iFood e 99Food
-- no projeto Supabase de destino, preservando as tabelas operacionais existentes.

create extension if not exists "pgcrypto";

create table if not exists public.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ifood_merchant_id text unique,
  ifood_merchant_nome text,
  status text not null default 'desconectada'
    check (status in ('desconectada', 'conectando', 'conectada')),
  pickup_lat double precision,
  pickup_lng double precision,
  created_at timestamptz not null default now(),
  taxa_entrega_padrao numeric(10, 2) not null default 0,
  taxa_motoboy_padrao numeric(10, 2) not null default 0
);

create table if not exists public.ifood_tokens (
  loja_id uuid primary key references public.lojas (id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expira_em timestamptz,
  authorization_code_verifier text,
  user_code text,
  user_code_expira_em timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.food99_tokens (
  app_shop_id text primary key,
  auth_token text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  origem text,
  payload jsonb,
  headers jsonb,
  raw text,
  created_at timestamptz not null default now()
);

alter table public.pending_deliveries
  add column if not exists bidding_started_at timestamptz;

alter table public.lojas enable row level security;
alter table public.ifood_tokens enable row level security;
alter table public.food99_tokens enable row level security;
alter table public.webhook_logs enable row level security;

drop policy if exists lojas_all on public.lojas;
create policy lojas_all on public.lojas
  for all using (true) with check (true);

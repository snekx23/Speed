-- =====================================================================
-- Borá Açaí — schema inicial (teles + motoboys)
-- Rode no SQL Editor do Supabase (uma vez).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Motoboys
-- ---------------------------------------------------------------------
create table if not exists public.motoboys (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  telefone   text,
  pin        text not null unique,           -- código curto de login
  ativo      boolean not null default true,
  lat        double precision,
  lng        double precision,
  last_seen  timestamptz
);

-- ---------------------------------------------------------------------
-- Teles (entregas)
-- ---------------------------------------------------------------------
create table if not exists public.teles (
  id           uuid primary key default gen_random_uuid(),
  origem       text not null default 'manual'
               check (origem in ('ifood', '99food', 'manual')),
  external_id  text,                          -- id do pedido na plataforma
  codigo       text not null,                 -- código curto exibido no card
  cliente_nome text not null default '',
  endereco     text not null default '',
  lat          double precision,
  lng          double precision,
  valor        numeric(10, 2),
  itens        jsonb not null default '[]'::jsonb,
  status       text not null default 'novo'
               check (status in ('novo','atribuido','em_rota','entregue','cancelado')),
  motoboy_id   uuid references public.motoboys (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists teles_status_idx     on public.teles (status);
create index if not exists teles_motoboy_idx     on public.teles (motoboy_id);
create unique index if not exists teles_origem_ext_idx
  on public.teles (origem, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------
-- Histórico de eventos (opcional, útil p/ auditoria)
-- ---------------------------------------------------------------------
create table if not exists public.tele_eventos (
  id         uuid primary key default gen_random_uuid(),
  tele_id    uuid references public.teles (id) on delete cascade,
  tipo       text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Realtime: publica mudanças destas tabelas para o front
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.teles;
alter publication supabase_realtime add table public.motoboys;

-- ---------------------------------------------------------------------
-- RPC: login do motoboy por PIN (retorna o motoboy se ativo)
-- ---------------------------------------------------------------------
create or replace function public.login_motoboy(p_pin text)
returns public.motoboys
language sql
security definer
set search_path = public
as $$
  select * from public.motoboys
  where pin = p_pin and ativo = true
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- MVP: ferramenta interna. O painel usa a chave anon no navegador, então
-- liberamos as operações para 'anon'. Em produção, coloque o painel atrás
-- de autenticação (Supabase Auth) e restrinja as policies por papel.
-- ---------------------------------------------------------------------
alter table public.motoboys    enable row level security;
alter table public.teles       enable row level security;
alter table public.tele_eventos enable row level security;

drop policy if exists motoboys_all    on public.motoboys;
drop policy if exists teles_all        on public.teles;
drop policy if exists tele_eventos_all on public.tele_eventos;

create policy motoboys_all    on public.motoboys    for all using (true) with check (true);
create policy teles_all        on public.teles       for all using (true) with check (true);
create policy tele_eventos_all on public.tele_eventos for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- Seed: alguns motoboys para teste
-- ---------------------------------------------------------------------
insert into public.motoboys (nome, telefone, pin) values
  ('João',  '11999990001', '1234'),
  ('Maria', '11999990002', '5678'),
  ('Pedro', '11999990003', '9012')
on conflict (pin) do nothing;

-- =====================================================================
-- Borá Açaí — multi-loja + integração iFood (app Distribuído)
-- Rode no SQL Editor do Supabase depois do 0001_init.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lojas (cada restaurante que conecta a própria conta iFood)
-- ---------------------------------------------------------------------
create table if not exists public.lojas (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  -- id da loja na plataforma iFood (merchantId, UUID retornado pela API)
  ifood_merchant_id   text unique,
  ifood_merchant_nome text,
  -- desconectada | conectando | conectada
  status              text not null default 'desconectada'
                      check (status in ('desconectada','conectando','conectada')),
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Tokens iFood por loja (NÃO expor no front — só Edge Functions leem)
-- ---------------------------------------------------------------------
create table if not exists public.ifood_tokens (
  loja_id                     uuid primary key references public.lojas (id) on delete cascade,
  access_token                text,
  refresh_token               text,
  token_expira_em             timestamptz,
  -- transitórios durante o fluxo userCode (autorização do lojista)
  authorization_code_verifier text,
  user_code                   text,
  user_code_expira_em         timestamptz,
  updated_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- teles passam a pertencer a uma loja
-- ---------------------------------------------------------------------
alter table public.teles
  add column if not exists loja_id uuid references public.lojas (id) on delete set null;

create index if not exists teles_loja_idx on public.teles (loja_id);

-- Realtime do painel
alter publication supabase_realtime add table public.lojas;

-- ---------------------------------------------------------------------
-- RLS
-- lojas: leitura/gestão pelo painel (anon, MVP — apertar em produção).
-- ifood_tokens: SEM policy de anon -> só a service_role (Edge Functions)
--               consegue ler/escrever. Tokens nunca chegam ao navegador.
-- ---------------------------------------------------------------------
alter table public.lojas        enable row level security;
alter table public.ifood_tokens enable row level security;

drop policy if exists lojas_all on public.lojas;
create policy lojas_all on public.lojas for all using (true) with check (true);
-- (ifood_tokens fica sem policy: bloqueado para anon, liberado p/ service_role)

-- ---------------------------------------------------------------------
-- Loja de exemplo (a Borá) para testes do painel
-- ---------------------------------------------------------------------
insert into public.lojas (nome) values ('Borá Açaí')
on conflict do nothing;

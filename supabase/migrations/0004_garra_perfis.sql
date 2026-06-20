-- =====================================================================
-- Garra Delivery — perfis de acesso (admin/parceiro) + taxas/ganhos
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis: ligam um usuário do Supabase Auth a um papel e a uma loja.
--   admin    -> dono da Garra (acesso total)
--   parceiro -> loja parceira (só leitura + faturamento da própria loja)
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text,
  papel      text not null check (papel in ('admin', 'parceiro')),
  loja_id    uuid references public.lojas (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.perfis enable row level security;
drop policy if exists perfis_self on public.perfis;
-- cada usuário lê o próprio perfil
create policy perfis_self on public.perfis for select using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- Taxas padrão por loja (usadas ao criar a tele; ajustáveis por tele)
--   taxa_entrega_padrao -> quanto a loja paga à Garra por entrega
--   taxa_motoboy_padrao -> quanto o motoboy ganha por entrega
-- ---------------------------------------------------------------------
alter table public.lojas
  add column if not exists taxa_entrega_padrao numeric(10, 2) not null default 0,
  add column if not exists taxa_motoboy_padrao numeric(10, 2) not null default 0;

-- ---------------------------------------------------------------------
-- Valores por tele + marca de entrega (para o relatório semanal)
-- ---------------------------------------------------------------------
alter table public.teles
  add column if not exists taxa_entrega numeric(10, 2),
  add column if not exists taxa_motoboy numeric(10, 2),
  add column if not exists entregue_em  timestamptz;

create index if not exists teles_entregue_em_idx on public.teles (entregue_em);

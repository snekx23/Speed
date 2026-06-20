-- =====================================================================
-- Garra Delivery — taxa de entrega por cidade
-- Ex.: Sapucaia 8, Esteio 10, São Leopoldo 16 (valores a confirmar)
-- =====================================================================

create table if not exists public.cidades (
  id    uuid primary key default gen_random_uuid(),
  nome  text not null unique,
  taxa  numeric(10, 2) not null default 0
);

alter table public.cidades enable row level security;
drop policy if exists cidades_all on public.cidades;
create policy cidades_all on public.cidades for all using (true) with check (true);
alter publication supabase_realtime add table public.cidades;

-- cidade da tele (usada para definir a taxa)
alter table public.teles add column if not exists cidade text;

-- seed (zonas/taxas confirmadas pelo dono)
insert into public.cidades (nome, taxa) values
  ('Sapucaia do Sul', 8),
  ('Esteio', 10),
  ('Novo Esteio', 15),
  ('Cachorrinha', 20),
  ('São Leopoldo', 20),
  ('Canoas', 20)
on conflict (nome) do nothing;

-- Garra Delivery: isolamento Multi-Tenant por loja e usuário autenticado.
-- O acesso de parceiros é sempre derivado de public.perfis.loja_id + auth.uid().

alter table public.lojas
  add column if not exists telefone text,
  add column if not exists cidade text,
  add column if not exists phone text,
  add column if not exists city text,
  add column if not exists email text;

-- O schema operacional original não tinha uma tabela de perfis. Criamos a
-- fonte canônica de vínculo entre auth.users, o papel de acesso e a loja.
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  papel text not null default 'parceiro' check (papel in ('admin', 'parceiro')),
  loja_id uuid references public.lojas(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Protege também instalações em que uma tabela parcial tenha sido criada.
alter table public.perfis
  add column if not exists nome text,
  add column if not exists papel text not null default 'parceiro',
  add column if not exists username text,
  add column if not exists loja_id uuid references public.lojas(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists lojas_email_unique_idx
  on public.lojas (lower(email))
  where email is not null;

create unique index if not exists perfis_username_unique_idx
  on public.perfis (lower(username))
  where username is not null;

alter table public.client_history
  add column if not exists loja_id uuid references public.lojas(id) on delete set null;

alter table public.pending_deliveries
  add column if not exists loja_id uuid references public.lojas(id) on delete set null;

create index if not exists client_history_loja_id_idx on public.client_history(loja_id);
create index if not exists pending_deliveries_loja_id_idx on public.pending_deliveries(loja_id);
create index if not exists perfis_loja_id_idx on public.perfis(loja_id);

-- Backfill seguro para registros legados que possuem somente o nome da loja.
update public.client_history as delivery
set loja_id = store.id
from public.lojas as store
where delivery.loja_id is null
  and translate(lower(trim(delivery.client)), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
    = translate(lower(trim(store.nome)), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');

update public.pending_deliveries as delivery
set loja_id = store.id
from public.lojas as store
where delivery.loja_id is null
  and translate(lower(trim(delivery.client)), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
    = translate(lower(trim(store.nome)), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');

-- Registro canônico estável para o Bora Açaí. O UUID é a referência única
-- usada pelos seletores e pelo isolamento de todas as entregas legadas.
insert into public.lojas (id, nome, phone, city, status)
values (
  '00000000-0000-0000-0000-000000000001',
  'Bora Açaí',
  '(51) 99999-9999',
  'Sapucaia do Sul',
  'conectada'
)
on conflict (id) do update
set nome = excluded.nome,
    phone = excluded.phone,
    city = excluded.city,
    status = excluded.status;

-- Normaliza todas as variantes legadas de nome diretamente para o UUID canônico.
update public.client_history
set loja_id = '00000000-0000-0000-0000-000000000001'
where lower(coalesce(client, '')) like any (array[
  '%bora açaí%', '%bora açai%', '%boraaçai%', '%boraacai%'
]);

update public.pending_deliveries
set loja_id = '00000000-0000-0000-0000-000000000001'
where lower(coalesce(client, '')) like any (array[
  '%bora açaí%', '%bora açai%', '%boraaçai%', '%boraacai%'
]);

-- O perfil só é inserido se o usuário correspondente já existir em auth.users.
-- A senha nunca é armazenada aqui; o painel legado continua usando username.
insert into public.perfis (id, nome, papel, username, loja_id)
select
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Bora Açaí',
  'parceiro',
  'boraaçai',
  '00000000-0000-0000-0000-000000000001'::uuid
where exists (
  select 1 from auth.users where id = '00000000-0000-0000-0000-000000000002'::uuid
)
on conflict (id) do update
set nome = excluded.nome,
    papel = excluded.papel,
    username = excluded.username,
    loja_id = excluded.loja_id;

alter table public.client_history enable row level security;
alter table public.pending_deliveries enable row level security;
alter table public.lojas enable row level security;
alter table public.perfis enable row level security;

-- Recrie somente as políticas nomeadas abaixo caso a migração seja reaplicada.
drop policy if exists client_history_tenant_read on public.client_history;
drop policy if exists client_history_admin_write on public.client_history;
drop policy if exists client_history_all on public.client_history;
drop policy if exists pending_deliveries_tenant_read on public.pending_deliveries;
drop policy if exists pending_deliveries_admin_write on public.pending_deliveries;
drop policy if exists pending_deliveries_all on public.pending_deliveries;
drop policy if exists lojas_all on public.lojas;
drop policy if exists lojas_tenant_read on public.lojas;
drop policy if exists lojas_admin_write on public.lojas;
drop policy if exists perfis_self on public.perfis;

create policy perfis_self
on public.perfis
for select
to authenticated
using (id = (select auth.uid()));

create policy client_history_tenant_read
on public.client_history
for select
to authenticated
using (
  exists (
    select 1
    from public.perfis as profile
    where profile.id = (select auth.uid())
      and (profile.papel = 'admin' or profile.loja_id = client_history.loja_id)
  )
);

create policy client_history_admin_write
on public.client_history
for all
to authenticated
using (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid()) and profile.papel = 'admin'
  )
)
with check (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid()) and profile.papel = 'admin'
  )
);

create policy pending_deliveries_tenant_read
on public.pending_deliveries
for select
to authenticated
using (
  exists (
    select 1
    from public.perfis as profile
    where profile.id = (select auth.uid())
      and (profile.papel = 'admin' or profile.loja_id = pending_deliveries.loja_id)
  )
);

create policy pending_deliveries_admin_write
on public.pending_deliveries
for all
to authenticated
using (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid()) and profile.papel = 'admin'
  )
)
with check (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid()) and profile.papel = 'admin'
  )
);

create policy lojas_tenant_read
on public.lojas
for select
to authenticated
using (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid())
      and (profile.papel = 'admin' or profile.loja_id = lojas.id)
  )
);

create policy lojas_admin_write
on public.lojas
for all
to authenticated
using (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid()) and profile.papel = 'admin'
  )
)
with check (
  exists (
    select 1 from public.perfis as profile
    where profile.id = (select auth.uid()) and profile.papel = 'admin'
  )
);

-- Reparo: Bora Acai e o unico comercio conectado a 99Food.
-- Execute depois da migration multi-tenant.

alter table public.lojas
  add column if not exists food99_app_shop_id text,
  add column if not exists food99_merchant_nome text;

insert into public.lojas (id, nome, status)
values ('00000000-0000-0000-0000-000000000001'::uuid, 'Bora Acai', 'desconectada')
on conflict (id) do update
set nome = excluded.nome;

do $$
declare
  legacy_id uuid;
  legacy_app_shop_id text;
  legacy_merchant_name text;
begin
  select id, food99_app_shop_id, food99_merchant_nome
    into legacy_id, legacy_app_shop_id, legacy_merchant_name
  from public.lojas
  where id <> '00000000-0000-0000-0000-000000000001'::uuid
    and food99_app_shop_id is not null
    and translate(lower(trim(coalesce(nome, ''))),
      'áàãâäéèêëíìîïóòõôöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc') in ('bora acai', 'boraacai')
  order by id
  limit 1;

  if legacy_id is not null then
    update public.lojas
    set food99_app_shop_id = null
    where id = legacy_id;

    update public.lojas
    set food99_app_shop_id = legacy_app_shop_id,
        food99_merchant_nome = coalesce(legacy_merchant_name, nome),
        status = 'conectada'
    where id = '00000000-0000-0000-0000-000000000001'::uuid;
  end if;
end $$;

update public.pending_deliveries
set loja_id = '00000000-0000-0000-0000-000000000001'::uuid
where translate(lower(trim(coalesce(client, ''))),
  'áàãâäéèêëíìîïóòõôöúùûüç',
  'aaaaaeeeeiiiiooooouuuuc') in ('bora acai', 'boraacai');

update public.client_history
set loja_id = '00000000-0000-0000-0000-000000000001'::uuid
where translate(lower(trim(coalesce(client, ''))),
  'áàãâäéèêëíìîïóòõôöúùûüç',
  'aaaaaeeeeiiiiooooouuuuc') in ('bora acai', 'boraacai');

drop policy if exists pending_deliveries_all on public.pending_deliveries;
drop policy if exists client_history_all on public.client_history;

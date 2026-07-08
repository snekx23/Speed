-- Adiciona política de select para food99_tokens para permitir verificar o status da conexão no frontend
drop policy if exists food99_tokens_select on public.food99_tokens;
create policy food99_tokens_select on public.food99_tokens
  for select using (true);

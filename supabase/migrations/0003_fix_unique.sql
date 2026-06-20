-- Corrige o índice de deduplicação de teles: o índice parcial não funciona
-- com upsert (ON CONFLICT) via PostgREST/Edge Functions. Troca por índice único
-- normal em (origem, external_id). NULLs continuam permitidos para teles manuais.

drop index if exists teles_origem_ext_idx;
create unique index if not exists teles_origem_ext_uniq on public.teles (origem, external_id);

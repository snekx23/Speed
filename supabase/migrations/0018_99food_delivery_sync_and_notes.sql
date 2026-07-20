-- Metadados necessários para baixar pedidos 99Food pelo PWA e exibir observações do comprador.
-- Seguro para executar no SQL Editor: todas as alterações são idempotentes.

ALTER TABLE public.pending_deliveries
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS food99_app_shop_id text,
  ADD COLUMN IF NOT EXISTS observacao text;

ALTER TABLE public.client_history
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS food99_app_shop_id text,
  ADD COLUMN IF NOT EXISTS observacao text;

-- Mantém compatibilidade com a coluna plural criada anteriormente, se ela existir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pending_deliveries' AND column_name = 'observacoes'
  ) THEN
    EXECUTE 'UPDATE public.pending_deliveries
      SET observacao = COALESCE(NULLIF(observacao, ''''), NULLIF(observacoes, ''''))
      WHERE observacao IS NULL OR observacao = ''''';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'client_history' AND column_name = 'observacoes'
  ) THEN
    EXECUTE 'UPDATE public.client_history
      SET observacao = COALESCE(NULLIF(observacao, ''''), NULLIF(observacoes, ''''))
      WHERE observacao IS NULL OR observacao = ''''';
  END IF;
END $$;

-- Recupera o ID nativo de registros 99Food existentes no formato visual:
-- "99Food #504037 (576467...)".
UPDATE public.pending_deliveries
SET external_id = substring(id FROM '\(([^()]*)\)\s*$')
WHERE (external_id IS NULL OR external_id = '')
  AND id LIKE '99Food %';

UPDATE public.client_history
SET external_id = substring(id FROM '\(([^()]*)\)\s*$')
WHERE (external_id IS NULL OR external_id = '')
  AND id LIKE '99Food %';

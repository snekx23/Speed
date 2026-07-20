BEGIN;

ALTER TABLE public.pending_deliveries
  ADD COLUMN IF NOT EXISTS dispatch_status TEXT DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS dispatch_processing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_confirmed_at TIMESTAMPTZ;

ALTER TABLE public.pending_deliveries
  ADD COLUMN IF NOT EXISTS delivered_status TEXT DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS delivered_processing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_confirmed_at TIMESTAMPTZ;

UPDATE public.pending_deliveries
SET dispatch_status = 'pendente'
WHERE dispatch_status IS NULL;

UPDATE public.pending_deliveries
SET delivered_status = 'pendente'
WHERE delivered_status IS NULL;

ALTER TABLE public.pending_deliveries
  ALTER COLUMN dispatch_status SET DEFAULT 'pendente',
  ALTER COLUMN dispatch_status SET NOT NULL,
  ALTER COLUMN delivered_status SET DEFAULT 'pendente',
  ALTER COLUMN delivered_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_deliveries_external_id
  ON public.pending_deliveries (external_id);

CREATE INDEX IF NOT EXISTS idx_pending_deliveries_dispatch_status
  ON public.pending_deliveries (dispatch_status);

CREATE INDEX IF NOT EXISTS idx_pending_deliveries_delivered_status
  ON public.pending_deliveries (delivered_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pending_deliveries_dispatch_status_check'
      AND conrelid = 'public.pending_deliveries'::regclass
  ) THEN
    ALTER TABLE public.pending_deliveries
      ADD CONSTRAINT pending_deliveries_dispatch_status_check
      CHECK (
        dispatch_status IN (
          'pendente',
          'processando',
          'aceito',
          'confirmado',
          'falhou',
          'reconciliacao_necessaria'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pending_deliveries_delivered_status_check'
      AND conrelid = 'public.pending_deliveries'::regclass
  ) THEN
    ALTER TABLE public.pending_deliveries
      ADD CONSTRAINT pending_deliveries_delivered_status_check
      CHECK (
        delivered_status IN (
          'pendente',
          'processando',
          'aceito',
          'confirmado',
          'falhou',
          'reconciliacao_necessaria',
          'nao_requerido'
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.pending_deliveries.dispatch_status IS
  'Estado do envio de despacho para a 99Food.';

COMMENT ON COLUMN public.pending_deliveries.dispatch_processing_at IS
  'Momento em que uma Edge Function adquiriu a trava do despacho.';

COMMENT ON COLUMN public.pending_deliveries.dispatch_sent_at IS
  'Momento em que o despacho foi aceito pela API da 99Food.';

COMMENT ON COLUMN public.pending_deliveries.dispatch_confirmed_at IS
  'Momento em que o webhook confirmou o evento DISPATCHED.';

COMMENT ON COLUMN public.pending_deliveries.delivered_status IS
  'Estado do envio de conclusão da entrega para a 99Food.';

COMMENT ON COLUMN public.pending_deliveries.delivered_processing_at IS
  'Momento em que uma Edge Function adquiriu a trava da conclusão.';

COMMENT ON COLUMN public.pending_deliveries.delivered_sent_at IS
  'Momento em que a conclusão foi aceita pela API da 99Food.';

COMMENT ON COLUMN public.pending_deliveries.delivered_confirmed_at IS
  'Momento em que o webhook confirmou DELIVERED ou CONCLUDED.';

COMMIT;
-- Competência financeira e vínculo do consumo com o estabelecimento de origem.
-- A tabela operacional existente para consumíveis/vales é rider_consumables.

ALTER TABLE public.rider_consumables
  ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES public.lojas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_competencia date;

-- Lançamentos legados entram na competência do dia em que foram registrados.
UPDATE public.rider_consumables
SET data_competencia = created_at::date
WHERE data_competencia IS NULL;

CREATE INDEX IF NOT EXISTS rider_consumables_loja_competencia_idx
  ON public.rider_consumables (loja_id, data_competencia);

CREATE INDEX IF NOT EXISTS rider_consumables_rider_competencia_idx
  ON public.rider_consumables (rider_id, data_competencia);

-- Preserva o valor bruto para auditoria; amount segue como valor líquido do motoboy.
ALTER TABLE public.rider_credits
  ADD COLUMN IF NOT EXISTS gross_amount NUMERIC;

-- Créditos legados tinham amount bruto. Preservamos esse valor para auditoria
-- e convertemos amount para o líquido que o PWA já consome.
UPDATE public.rider_credits
SET gross_amount = amount,
    amount = ROUND(amount * 0.90, 2)
WHERE gross_amount IS NULL;

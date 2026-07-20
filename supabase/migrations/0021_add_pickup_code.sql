-- Adiciona pickup_code e dispatch_sent_at nas tabelas pending_deliveries e client_history
ALTER TABLE public.pending_deliveries 
  ADD COLUMN IF NOT EXISTS pickup_code TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_sent_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.client_history 
  ADD COLUMN IF NOT EXISTS pickup_code TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_sent_at TIMESTAMP WITH TIME ZONE;

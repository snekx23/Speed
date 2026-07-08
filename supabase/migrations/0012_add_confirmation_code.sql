-- Migration: Add confirmation_code to pending_deliveries and client_history
ALTER TABLE public.pending_deliveries ADD COLUMN IF NOT EXISTS confirmation_code TEXT;
ALTER TABLE public.client_history ADD COLUMN IF NOT EXISTS confirmation_code TEXT;

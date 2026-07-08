-- Migration: Add total_order_amount to pending_deliveries and client_history
ALTER TABLE public.pending_deliveries ADD COLUMN IF NOT EXISTS total_order_amount TEXT;
ALTER TABLE public.client_history ADD COLUMN IF NOT EXISTS total_order_amount TEXT;

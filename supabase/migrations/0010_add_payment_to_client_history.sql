-- Migration: Add payment column to client_history table
ALTER TABLE public.client_history ADD COLUMN IF NOT EXISTS payment TEXT;

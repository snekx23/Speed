-- Migration: Add detailed columns to public.rider_consumables table for vales and lanches
ALTER TABLE public.rider_consumables
  ADD COLUMN IF NOT EXISTS categoria TEXT CHECK (categoria IN ('Vale', 'Consumível')) DEFAULT 'Consumível',
  ADD COLUMN IF NOT EXISTS quantidade INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observacao TEXT;

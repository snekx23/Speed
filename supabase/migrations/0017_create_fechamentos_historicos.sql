-- Migration: Create fechamentos_historicos table to store weekly closed batches of payouts
CREATE TABLE IF NOT EXISTS public.fechamentos_historicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id TEXT NOT NULL,
  rider_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  consumables_amount NUMERIC NOT NULL DEFAULT 0,
  credits_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL DEFAULT 0,
  order_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS and public access policy matching project style
ALTER TABLE public.fechamentos_historicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fechamentos_historicos_all ON public.fechamentos_historicos;
CREATE POLICY fechamentos_historicos_all ON public.fechamentos_historicos FOR ALL TO public USING (true) WITH CHECK (true);

-- Add to Realtime Publication if not already added
alter publication supabase_realtime add table public.fechamentos_historicos;

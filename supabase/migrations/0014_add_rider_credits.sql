-- Migration to add rider_credits table for tracking bonuses, extra shifts, and adjustments

CREATE TABLE IF NOT EXISTS public.rider_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id TEXT NOT NULL REFERENCES public.fleet(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  description TEXT NOT NULL,
  target_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS and add open public policy matching project style
ALTER TABLE public.rider_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY rider_credits_all ON public.rider_credits FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.rider_credits
  ADD COLUMN IF NOT EXISTS client_name TEXT;

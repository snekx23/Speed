-- Migration: Add battery_level to fleet
ALTER TABLE public.fleet ADD COLUMN IF NOT EXISTS battery_level INTEGER;

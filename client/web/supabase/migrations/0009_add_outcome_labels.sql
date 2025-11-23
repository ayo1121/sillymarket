-- Migration: Add outcome_labels column to markets table
-- This allows outcome names to be stored globally and shown to all users

ALTER TABLE public.markets 
ADD COLUMN IF NOT EXISTS outcome_labels jsonb;

COMMENT ON COLUMN public.markets.outcome_labels IS 'Array of outcome label strings (e.g. ["Yes", "No"] or custom labels)';

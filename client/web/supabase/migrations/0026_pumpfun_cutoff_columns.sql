-- Migration: Add Pump.fun cutoff columns to markets table
-- Breaking change assumption: No real markets exist on mainnet yet

-- Add pumpfun_mint column (nullable - only used for pumpfun_stream_end mode)
ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS pumpfun_mint TEXT;

-- Add cutoff_mode column - defaults to 'time' to preserve existing behavior
-- Values: 'time' | 'pumpfun_stream_end' | 'manual'
ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS cutoff_mode TEXT NOT NULL DEFAULT 'time';

-- Add status column - tracks market lifecycle
-- Values: 'open' | 'cutoff' | 'resolved' | 'void'
ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

-- Create composite index for efficient polling of Pump.fun markets
CREATE INDEX IF NOT EXISTS idx_markets_cutoff_mode_status 
ON public.markets (cutoff_mode, status);

-- Add partial index for active Pump.fun markets (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_markets_pumpfun_open 
ON public.markets (pumpfun_mint) 
WHERE cutoff_mode = 'pumpfun_stream_end' AND status = 'open' AND pumpfun_mint IS NOT NULL;

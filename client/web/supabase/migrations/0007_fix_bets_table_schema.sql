-- =====================================================================
-- Migration: Fix bets table schema to match edge function expectations
-- 
-- Problem: The bets table has an outdated schema from old migrations
-- with columns like user_id, bet_type, market_id that don't match
-- what the index_bet_event edge function expects.
--
-- Solution: Drop and recreate the table with the correct schema.
-- =====================================================================

-- Drop existing bets table (with all policies and indexes)
DROP TABLE IF EXISTS public.bets CASCADE;

-- Recreate bets table with correct schema for edge function
CREATE TABLE public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  bettor_pubkey text NOT NULL,
  username text,
  outcome_index integer NOT NULL,
  outcome_label text,
  amount_sol numeric NOT NULL,
  amount_lamports bigint NOT NULL,
  tx_sig text NOT NULL UNIQUE,
  block_time timestamptz NOT NULL,
  pools_after jsonb,
  probs_after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_bets_market_pubkey ON public.bets (market_pubkey);
CREATE INDEX idx_bets_bettor_pubkey ON public.bets (bettor_pubkey);
CREATE INDEX idx_bets_tx_sig ON public.bets (tx_sig);
CREATE INDEX idx_bets_block_time ON public.bets (block_time DESC);
CREATE INDEX idx_bets_created_at ON public.bets (created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Everyone can read bets
CREATE POLICY "Bets are viewable by everyone"
  ON public.bets
  FOR SELECT
  USING (true);

-- RLS Policy: Only service role can insert bets (edge function only)
-- This prevents frontend from writing directly to bets table
CREATE POLICY "Only service role can insert bets"
  ON public.bets
  FOR INSERT
  WITH CHECK (
    -- Check if the request is from service role (Edge Function)
    (SELECT current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
  );

-- Enable Realtime for bets table
-- This allows the frontend to subscribe to new bet inserts
ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;

-- Add helpful comment
COMMENT ON TABLE public.bets IS 'Stores bet events indexed from Solana blockchain via Helius webhook → Edge Function';
COMMENT ON COLUMN public.bets.pools_after IS 'Pool sizes after bet placement (JSONB array of numbers)';
COMMENT ON COLUMN public.bets.probs_after IS 'Probabilities after bet placement (JSONB array of numbers, 0-1)';
COMMENT ON COLUMN public.bets.amount_lamports IS 'Bet amount in lamports (1 SOL = 1,000,000,000 lamports)';

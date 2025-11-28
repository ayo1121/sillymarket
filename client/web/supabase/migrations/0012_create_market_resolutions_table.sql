-- =====================================================================
-- Migration: Create market_resolutions table
-- Purpose: Track market resolution events from blockchain
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.market_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  winner_index integer NOT NULL,
  auto_void boolean NOT NULL DEFAULT false,
  resolved_total_pool bigint,
  resolved_win_pool bigint,
  fees_transferred bigint,
  block_time timestamptz NOT NULL,
  tx_sig text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_market_resolutions_market_pubkey 
  ON public.market_resolutions(market_pubkey);
CREATE INDEX IF NOT EXISTS idx_market_resolutions_block_time 
  ON public.market_resolutions(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_market_resolutions_tx_sig 
  ON public.market_resolutions(tx_sig);

-- Enable Row Level Security
ALTER TABLE public.market_resolutions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Everyone can read
CREATE POLICY "Market resolutions are viewable by everyone"
  ON public.market_resolutions FOR SELECT
  USING (true);

-- RLS Policy: Only service role can insert (edge function only)
CREATE POLICY "Only service role can insert market resolutions"
  ON public.market_resolutions FOR INSERT
  WITH CHECK (
    (SELECT current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
  );

-- Enable realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'market_resolutions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_resolutions;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END;
$$;

-- Comments
COMMENT ON TABLE public.market_resolutions IS 'Market resolution events indexed from Solana blockchain via Helius webhook';
COMMENT ON COLUMN public.market_resolutions.market_pubkey IS 'Solana public key of the resolved market';
COMMENT ON COLUMN public.market_resolutions.winner_index IS 'Winning outcome index (-2 for void, 0-4 for outcomes)';
COMMENT ON COLUMN public.market_resolutions.auto_void IS 'True if market was auto-voided due to no activity';

-- =====================================================================
-- Migration: Create market_events table
-- Purpose: Track market creation events from blockchain
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.market_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  creator_pubkey text NOT NULL,
  cutoff_ts bigint NOT NULL,
  outcomes_count integer NOT NULL,
  question_hash text,
  block_time timestamptz NOT NULL,
  tx_sig text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_market_events_market_pubkey 
  ON public.market_events(market_pubkey);
CREATE INDEX IF NOT EXISTS idx_market_events_creator_pubkey 
  ON public.market_events(creator_pubkey);
CREATE INDEX IF NOT EXISTS idx_market_events_block_time 
  ON public.market_events(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_market_events_tx_sig 
  ON public.market_events(tx_sig);

-- Enable Row Level Security
ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Everyone can read
CREATE POLICY "Market events are viewable by everyone"
  ON public.market_events FOR SELECT
  USING (true);

-- RLS Policy: Only service role can insert (edge function only)
CREATE POLICY "Only service role can insert market events"
  ON public.market_events FOR INSERT
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
      AND tablename = 'market_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_events;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END;
$$;

-- Comments
COMMENT ON TABLE public.market_events IS 'Market creation events indexed from Solana blockchain via Helius webhook';
COMMENT ON COLUMN public.market_events.market_pubkey IS 'Solana public key of the market account';
COMMENT ON COLUMN public.market_events.creator_pubkey IS 'Solana public key of the market creator';
COMMENT ON COLUMN public.market_events.cutoff_ts IS 'Unix timestamp when market closes';
COMMENT ON COLUMN public.market_events.outcomes_count IS 'Number of outcomes (2-5)';

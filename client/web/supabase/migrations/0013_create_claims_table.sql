-- =====================================================================
-- Migration: Create claims table
-- Purpose: Track winnings claimed events from blockchain
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  user_pubkey text NOT NULL,
  amount_lamports bigint NOT NULL,
  block_time timestamptz NOT NULL,
  tx_sig text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_claims_market_pubkey 
  ON public.claims(market_pubkey);
CREATE INDEX IF NOT EXISTS idx_claims_user_pubkey 
  ON public.claims(user_pubkey);
CREATE INDEX IF NOT EXISTS idx_claims_block_time 
  ON public.claims(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_claims_tx_sig 
  ON public.claims(tx_sig);

-- Enable Row Level Security
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Everyone can read
CREATE POLICY "Claims are viewable by everyone"
  ON public.claims FOR SELECT
  USING (true);

-- RLS Policy: Only service role can insert (edge function only)
CREATE POLICY "Only service role can insert claims"
  ON public.claims FOR INSERT
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
      AND tablename = 'claims'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.claims;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END;
$$;

-- Comments
COMMENT ON TABLE public.claims IS 'Winnings claimed events indexed from Solana blockchain via Helius webhook';
COMMENT ON COLUMN public.claims.market_pubkey IS 'Solana public key of the market';
COMMENT ON COLUMN public.claims.user_pubkey IS 'Solana public key of the user claiming winnings';
COMMENT ON COLUMN public.claims.amount_lamports IS 'Amount claimed in lamports (1 SOL = 1,000,000,000 lamports)';

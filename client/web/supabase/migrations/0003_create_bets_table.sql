-- Create bets table for storing BetPlaced events
CREATE TABLE IF NOT EXISTS public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  bettor_pubkey text NOT NULL,
  username text,
  outcome_index integer NOT NULL,
  outcome_label text,
  amount_sol numeric NOT NULL,
  tx_sig text NOT NULL,
  block_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_bets_market_pubkey ON public.bets (market_pubkey);
CREATE INDEX IF NOT EXISTS idx_bets_tx_sig ON public.bets (tx_sig);
CREATE INDEX IF NOT EXISTS idx_bets_created_at ON public.bets (created_at DESC);


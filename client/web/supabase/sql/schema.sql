-- Supabase schema for yesno_markets indexing
-- Run this SQL block once in the Supabase SQL Editor

-- bets table (existing, ensure all columns exist)
CREATE TABLE IF NOT EXISTS public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  bettor_pubkey text NOT NULL,
  username text,
  outcome_index integer,
  outcome_label text,
  amount_lamports bigint,
  amount_sol numeric,
  tx_sig text UNIQUE,
  block_time timestamptz,
  created_at timestamptz DEFAULT now(),
  pools_after jsonb,
  probs_after jsonb
);

-- market_events table (for MarketCreated)
CREATE TABLE IF NOT EXISTS public.market_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  creator_pubkey text NOT NULL,
  cutoff_ts bigint,
  outcomes_count integer,
  question_hash text,
  block_time timestamptz,
  tx_sig text,
  created_at timestamptz DEFAULT now()
);

-- market_resolutions table (for WinnerResolved)
CREATE TABLE IF NOT EXISTS public.market_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  winner_index integer,
  auto_void boolean DEFAULT false,
  resolved_total_pool bigint,
  resolved_win_pool bigint,
  fees_transferred bigint,
  block_time timestamptz,
  tx_sig text,
  created_at timestamptz DEFAULT now()
);

-- claims table (for WinningsClaimed)
CREATE TABLE IF NOT EXISTS public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  user_pubkey text NOT NULL,
  amount_lamports bigint,
  block_time timestamptz,
  tx_sig text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS bets_market_pubkey_idx ON public.bets(market_pubkey);
CREATE INDEX IF NOT EXISTS bets_block_time_idx ON public.bets(block_time);
CREATE INDEX IF NOT EXISTS bets_bettor_pubkey_idx ON public.bets(bettor_pubkey);
CREATE UNIQUE INDEX IF NOT EXISTS bets_tx_sig_unique ON public.bets(tx_sig);

CREATE INDEX IF NOT EXISTS market_events_market_pubkey_idx ON public.market_events(market_pubkey);
CREATE INDEX IF NOT EXISTS market_events_block_time_idx ON public.market_events(block_time);

CREATE INDEX IF NOT EXISTS market_resolutions_market_pubkey_idx ON public.market_resolutions(market_pubkey);
CREATE INDEX IF NOT EXISTS market_resolutions_block_time_idx ON public.market_resolutions(block_time);

CREATE INDEX IF NOT EXISTS claims_market_pubkey_idx ON public.claims(market_pubkey);
CREATE INDEX IF NOT EXISTS claims_user_pubkey_idx ON public.claims(user_pubkey);
CREATE INDEX IF NOT EXISTS claims_block_time_idx ON public.claims(block_time);


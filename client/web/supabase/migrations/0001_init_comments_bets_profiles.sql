-- =====================================================================
-- Supabase schema for comments, bets, and profiles
-- This is designed to work with auth.users and the generated TS types.
-- =====================================================================

-- COMMENTS TABLE
CREATE TABLE IF NOT EXISTS public.comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Everyone can read comments
CREATE POLICY IF NOT EXISTS "Comments are viewable by everyone"
  ON public.comments
  FOR SELECT
  USING (true);

-- Only logged-in user can insert their own comments
CREATE POLICY IF NOT EXISTS "Users can insert their own comments"
  ON public.comments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only comment owner can delete their comments
CREATE POLICY IF NOT EXISTS "Users can delete their own comments"
  ON public.comments
  FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for comments
CREATE INDEX IF NOT EXISTS idx_comments_market_id
  ON public.comments (market_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at
  ON public.comments (created_at DESC);

-- Enable realtime on comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;

-- =====================================================================
-- BETS TABLE (optional analytics layer, used by Supabase client types)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.bets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  bet_type    text NOT NULL CHECK (bet_type IN ('yes', 'no')),
  amount      numeric NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Bets are viewable by everyone"
  ON public.bets
  FOR SELECT
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can insert their own bets"
  ON public.bets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update their own bets"
  ON public.bets
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_bets_market_id
  ON public.bets (market_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id
  ON public.bets (user_id);

-- (Realtime on bets is optional; add if needed)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;

-- =====================================================================
-- PROFILES TABLE (usernames, avatar URLs, wallet addresses)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  username       text UNIQUE,
  avatar_url     text,
  wallet_address text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Profiles are viewable by everyone"
  ON public.profiles
  FOR SELECT
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Optional: enable realtime on profiles if you want live username/avatar updates
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;


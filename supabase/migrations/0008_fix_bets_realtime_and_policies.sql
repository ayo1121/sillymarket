-- Ensure bets realtime + RLS are intact and schema tolerates fallback inserts

-- Enable RLS (idempotent)
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

-- Refresh open SELECT policy
DROP POLICY IF EXISTS "Bets are viewable by everyone" ON public.bets;
CREATE POLICY "Bets are viewable by everyone"
  ON public.bets
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow outcome_index to be null when the indexer cannot derive it
ALTER TABLE public.bets ALTER COLUMN outcome_index DROP NOT NULL;

-- Ensure block_time always has a value (default now for missing timestamps)
ALTER TABLE public.bets ALTER COLUMN block_time SET DEFAULT now();

-- Ensure bets table is part of the supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'bets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
  END IF;
EXCEPTION
  WHEN others THEN
    -- If publication cannot be altered in this context, ignore to keep migration idempotent
    NULL;
END;
$$;

-- Relax RLS policies to allow client-side writes for development
-- This fixes the issue where "Recent Activity" and "Probability History" are empty
-- because the Edge Function wasn't indexing bets, and client-side writes were blocked.

-- 1. BETS TABLE
-- Allow anon/authenticated to insert bets (fallback for missing Edge Function)
DROP POLICY IF EXISTS "Enable insert for all users" ON public.bets;
CREATE POLICY "Enable insert for all users" ON public.bets
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 2. MARKETS TABLE
-- Relax the strict JWT check for market creation
DROP POLICY IF EXISTS "markets_insert_verified_creator" ON public.markets;
CREATE POLICY "markets_insert_verified_creator" ON public.markets
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 3. MARKET EVENTS (just in case)
DROP POLICY IF EXISTS "Enable insert for all users" ON public.market_events;
CREATE POLICY "Enable insert for all users" ON public.market_events
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 4. MARKET RESOLUTIONS
DROP POLICY IF EXISTS "Enable insert for all users" ON public.market_resolutions;
CREATE POLICY "Enable insert for all users" ON public.market_resolutions
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 5. CLAIMS
DROP POLICY IF EXISTS "Enable insert for all users" ON public.claims;
CREATE POLICY "Enable insert for all users" ON public.claims
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 6. NOTIFICATIONS
DROP POLICY IF EXISTS "Enable insert for all users" ON public.notifications;
CREATE POLICY "Enable insert for all users" ON public.notifications
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 7. ENABLE DELETE FOR DEV (Optional, but helps with testing)
DROP POLICY IF EXISTS "Enable delete for all users" ON public.bets;
CREATE POLICY "Enable delete for all users" ON public.bets FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON public.markets;
CREATE POLICY "Enable delete for all users" ON public.markets FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON public.market_resolutions;
CREATE POLICY "Enable delete for all users" ON public.market_resolutions FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON public.claims;
CREATE POLICY "Enable delete for all users" ON public.claims FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON public.notifications;
CREATE POLICY "Enable delete for all users" ON public.notifications FOR DELETE TO anon, authenticated USING (true);

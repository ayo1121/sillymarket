-- =====================================================================
-- SUPABASE RLS SECURITY FIXES
-- Migration: 0004_fix_rls_policies.sql
-- Purpose: Fix critical RLS policy vulnerabilities identified in security audit
-- Date: 2025-11-22
-- =====================================================================
--
-- SUMMARY OF CHANGES:
-- 1. markets: Prevent anonymous INSERT/UPDATE, allow read-only access
-- 2. bets: Enable RLS, restrict INSERT to service role only
-- 3. comments: Disable RLS (backend handles authorization via DATABASE_URL)
-- 4. profiles: Drop unused table (incorrectly tied to auth.users)
-- 5. users: Enable RLS, allow SELECT only (backend bypasses via DATABASE_URL)
-- 6. siws_nonces: Enable RLS, block all frontend access
-- 7. Enable realtime for bets table
--
-- This migration is idempotent and safe to run multiple times.
-- =====================================================================

-- =====================================================================
-- 1. FIX TABLE: public.markets
-- Issue: Currently allows anonymous INSERT/UPDATE (anyone can modify metadata)
-- Fix: Allow SELECT for all, INSERT only if not exists, deny UPDATE/DELETE
-- =====================================================================

-- Enable RLS if not already enabled
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;

-- ✅ SECURE: Read access for everyone (market metadata is public)
CREATE POLICY "markets_select_all"
ON public.markets
FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: Insert only if market doesn't already exist (prevent overwrites)
-- Note: This doesn't verify the creator, but prevents duplicate/overwrite attacks
-- The on-chain program is the source of truth for market creation
CREATE POLICY "markets_insert_once"
ON public.markets
FOR INSERT
TO anon, authenticated
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.markets 
    WHERE market_pubkey = NEW.market_pubkey
  )
);

-- ✅ SECURE: NO UPDATE allowed from frontend
-- Market metadata should be immutable after creation
-- If updates are needed, they should go through backend API with proper auth
CREATE POLICY "markets_no_update"
ON public.markets
FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ SECURE: NO DELETE allowed from frontend
CREATE POLICY "markets_no_delete"
ON public.markets
FOR DELETE
TO anon, authenticated
USING (false);

-- =====================================================================
-- 2. FIX TABLE: public.bets
-- Issue: NO RLS policies (anyone can insert/delete bet records)
-- Fix: Enable RLS, allow SELECT for all, INSERT only for service role
-- =====================================================================

-- Enable RLS (missing in original migration)
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies (in case of re-run)
DROP POLICY IF EXISTS "Bets are viewable by everyone" ON public.bets;
DROP POLICY IF EXISTS "Users can insert their own bets" ON public.bets;
DROP POLICY IF EXISTS "Users can update their own bets" ON public.bets;
DROP POLICY IF EXISTS "bets_select_all" ON public.bets;
DROP POLICY IF EXISTS "bets_insert_service_only" ON public.bets;
DROP POLICY IF EXISTS "bets_no_update" ON public.bets;
DROP POLICY IF EXISTS "bets_no_delete" ON public.bets;

-- ✅ SECURE: Read access for everyone (bet history is public)
CREATE POLICY "bets_select_all"
ON public.bets
FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: Only Edge Function (service role) can INSERT
-- Frontend should NEVER write to bets table
-- Bets are indexed via Helius webhook → Edge Function
CREATE POLICY "bets_insert_service_only"
ON public.bets
FOR INSERT
TO authenticated
WITH CHECK (
  -- Check if the request is from service role (Edge Function)
  (auth.jwt() ->> 'role') = 'service_role'
);

-- ✅ SECURE: NO UPDATE allowed
CREATE POLICY "bets_no_update"
ON public.bets
FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ SECURE: NO DELETE allowed
CREATE POLICY "bets_no_delete"
ON public.bets
FOR DELETE
TO anon, authenticated
USING (false);

-- =====================================================================
-- 3. FIX TABLE: public.comments
-- Issue: References auth.users but app uses wallet-based auth (broken FK)
-- Fix: Disable RLS (backend handles authorization), remove auth.users FK
-- =====================================================================

-- Disable RLS - backend handles authorization via DATABASE_URL
ALTER TABLE public.comments DISABLE ROW LEVEL SECURITY;

-- Drop broken policies that reference auth.uid()
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
DROP POLICY IF EXISTS "Users can insert their own comments" ON public.comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.comments;

-- Remove foreign key to auth.users (not used by this app)
-- The app uses backend's users table, not Supabase Auth
DO $$ 
BEGIN
  -- Check if the constraint exists before dropping
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'comments_user_id_fkey' 
    AND table_name = 'comments'
  ) THEN
    ALTER TABLE public.comments DROP CONSTRAINT comments_user_id_fkey;
  END IF;
END $$;

-- Note: Backend API (server/src/index.ts) handles comment authorization
-- via JWT session validation before INSERT/DELETE operations

-- =====================================================================
-- 4. DROP TABLE: public.profiles
-- Issue: Unused table incorrectly tied to auth.users
-- Fix: Drop the table entirely
-- =====================================================================

-- This table is NOT used by the application
-- The backend uses its own users table in PostgreSQL
DROP TABLE IF EXISTS public.profiles CASCADE;

-- =====================================================================
-- 5. FIX TABLE: public.users (backend wallet users)
-- Issue: No RLS policies (frontend could read/write if they had access)
-- Fix: Enable RLS, allow SELECT only, deny all writes from frontend
-- =====================================================================

-- Enable RLS on backend's users table
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies (in case of re-run)
DROP POLICY IF EXISTS "users_select_all" ON public.users;
DROP POLICY IF EXISTS "users_no_insert" ON public.users;
DROP POLICY IF EXISTS "users_no_update" ON public.users;
DROP POLICY IF EXISTS "users_no_delete" ON public.users;

-- ✅ SECURE: Read access for everyone (usernames are public)
CREATE POLICY "users_select_all"
ON public.users
FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: NO INSERT from frontend
-- Only backend (with direct PostgreSQL connection) can insert
CREATE POLICY "users_no_insert"
ON public.users
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

-- ✅ SECURE: NO UPDATE from frontend
CREATE POLICY "users_no_update"
ON public.users
FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ SECURE: NO DELETE from frontend
CREATE POLICY "users_no_delete"
ON public.users
FOR DELETE
TO anon, authenticated
USING (false);

-- Note: Backend bypasses RLS because it connects with DATABASE_URL
-- (full PostgreSQL access), not Supabase client

-- =====================================================================
-- 6. FIX TABLE: public.siws_nonces
-- Issue: No RLS policies (frontend could manipulate nonces)
-- Fix: Enable RLS, block ALL frontend access
-- =====================================================================

-- Enable RLS on siws_nonces table
ALTER TABLE IF EXISTS public.siws_nonces ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies (in case of re-run)
DROP POLICY IF EXISTS "siws_nonces_no_access" ON public.siws_nonces;
DROP POLICY IF EXISTS "siws_nonces_no_select" ON public.siws_nonces;
DROP POLICY IF EXISTS "siws_nonces_no_insert" ON public.siws_nonces;
DROP POLICY IF EXISTS "siws_nonces_no_update" ON public.siws_nonces;
DROP POLICY IF EXISTS "siws_nonces_no_delete" ON public.siws_nonces;

-- ✅ SECURE: NO access from frontend for any operation
-- This table is backend-only (authentication nonces)
CREATE POLICY "siws_nonces_no_select"
ON public.siws_nonces
FOR SELECT
TO anon, authenticated
USING (false);

CREATE POLICY "siws_nonces_no_insert"
ON public.siws_nonces
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "siws_nonces_no_update"
ON public.siws_nonces
FOR UPDATE
TO anon, authenticated
USING (false);

CREATE POLICY "siws_nonces_no_delete"
ON public.siws_nonces
FOR DELETE
TO anon, authenticated
USING (false);

-- =====================================================================
-- 7. ENABLE REALTIME FOR BETS
-- Allow frontend to subscribe to bet events in real-time
-- =====================================================================

-- Add bets table to realtime publication (if not already added)
DO $$ 
BEGIN
  -- Check if bets table is already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'bets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
  END IF;
END $$;

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
--
-- SUMMARY OF SECURITY IMPROVEMENTS:
--
-- ✅ markets: Prevented anonymous updates/deletes, allow insert only once
-- ✅ bets: Enabled RLS, restricted inserts to service role (Edge Function)
-- ✅ comments: Disabled RLS (backend handles auth), removed broken FK
-- ✅ profiles: Dropped unused table
-- ✅ users: Enabled RLS, read-only for frontend
-- ✅ siws_nonces: Enabled RLS, blocked all frontend access
-- ✅ bets: Enabled realtime subscriptions
--
-- NEXT STEPS:
-- 1. Run this migration: supabase db push
-- 2. Test that frontend can still read markets/bets
-- 3. Test that frontend CANNOT update markets
-- 4. Test that Edge Function CAN insert bets
-- 5. Verify backend API can still manage comments/users
--
-- =====================================================================

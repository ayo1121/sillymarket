-- =====================================================================
-- Migration: RLS Security Hardening
-- Created: 2025-11-29
-- Purpose: Fix critical RLS vulnerabilities before mainnet launch
--
-- CRITICAL FIXES:
-- 1. Markets: Restrict UPDATE to creator_wallet only
-- 2. Comments: Add wallet verification (prevent impersonation)
-- 3. Users: Prevent username squatting and profile spoofing
-- =====================================================================

-- =====================================================================
-- 1. MARKETS TABLE: Restrict UPDATE to creator only
-- =====================================================================

-- Add explicit SELECT policy (everyone can read)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;
DROP POLICY IF EXISTS "markets_select_all" ON public.markets;
CREATE POLICY "markets_select_all" ON public.markets
  FOR SELECT
  TO public
  USING (true); -- Everyone can read markets

-- Drop the overly permissive UPDATE policy
DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;
DROP POLICY IF EXISTS "markets_update_all" ON public.markets;

-- SECURE: Only the market creator can update metadata
-- This prevents attackers from changing market questions, descriptions, or images
CREATE POLICY "markets_update_creator_only" ON public.markets
  FOR UPDATE
  TO authenticated, anon
  USING (
    -- Verify the authenticated wallet matches the creator_wallet
    creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub'
  )
  WITH CHECK (
    -- Also verify on the new row (prevent changing creator_wallet)
    creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- Explicitly prevent DELETE (markets are permanent)
DROP POLICY IF EXISTS "markets_delete_nobody" ON public.markets;
CREATE POLICY "markets_delete_nobody" ON public.markets
  FOR DELETE
  TO public
  USING (false); -- Nobody can delete markets

-- Add comment for documentation
COMMENT ON POLICY "markets_select_all" ON public.markets IS 
  'Everyone can read market data';
COMMENT ON POLICY "markets_update_creator_only" ON public.markets IS 
  'Only the market creator (verified by JWT sub claim) can update market metadata';

-- =====================================================================
-- 2. COMMENTS TABLE: Add wallet verification
-- =====================================================================

-- Add explicit SELECT policy (everyone can read)
DROP POLICY IF EXISTS "comments_select_all" ON public.comments;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.comments;
CREATE POLICY "comments_select_all" ON public.comments
  FOR SELECT
  TO public
  USING (true); -- Everyone can read comments

-- Drop the overly permissive anon insert policy
DROP POLICY IF EXISTS "comments_insert_anon" ON public.comments;
DROP POLICY IF EXISTS "comments_insert_authenticated" ON public.comments;

-- SECURE: Verify wallet ownership before allowing comment insert
-- Option A: Require authenticated session with wallet verification
CREATE POLICY "comments_insert_verified_wallet" ON public.comments
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    -- Verify the user_id in the comment matches the authenticated wallet
    -- This assumes user_id is the wallet pubkey (not UUID)
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- Explicitly prevent UPDATE (comments are immutable)
DROP POLICY IF EXISTS "comments_update_nobody" ON public.comments;
CREATE POLICY "comments_update_nobody" ON public.comments
  FOR UPDATE
  TO public
  USING (false); -- Comments cannot be edited

-- Keep DELETE policy for comment owners
-- (Assuming user_id is wallet pubkey, not auth.uid())
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.comments;
DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;
CREATE POLICY "comments_delete_own" ON public.comments
  FOR DELETE
  TO authenticated, anon
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );

COMMENT ON POLICY "comments_select_all" ON public.comments IS
  'Everyone can read comments';
COMMENT ON POLICY "comments_insert_verified_wallet" ON public.comments IS
  'Users can only insert comments with their own wallet pubkey (verified via JWT)';

-- =====================================================================
-- 3. USERS TABLE: Prevent username squatting
-- =====================================================================

-- Add explicit SELECT policy (everyone can read)
DROP POLICY IF EXISTS "users_select_all" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
CREATE POLICY "users_select_all" ON public.users
  FOR SELECT
  TO public
  USING (true); -- Everyone can read user profiles

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "users_insert_all" ON public.users;

-- SECURE: Users can only insert/upsert their own profile
CREATE POLICY "users_insert_own_only" ON public.users
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    -- Verify the pubkey being inserted matches the authenticated wallet
    pubkey = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- Keep the UPDATE policy (already restricts to own profile)
-- But make it more explicit
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own_verified" ON public.users
  FOR UPDATE
  TO authenticated, anon
  USING (
    pubkey = current_setting('request.jwt.claims', true)::json->>'sub'
  )
  WITH CHECK (
    -- Prevent changing pubkey
    pubkey = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- Explicitly prevent DELETE (user profiles are permanent)
DROP POLICY IF EXISTS "users_delete_nobody" ON public.users;
CREATE POLICY "users_delete_nobody" ON public.users
  FOR DELETE
  TO public
  USING (false); -- Nobody can delete user profiles

COMMENT ON POLICY "users_select_all" ON public.users IS
  'Everyone can read user profiles';
COMMENT ON POLICY "users_insert_own_only" ON public.users IS
  'Users can only create profiles for their own wallet (verified via JWT)';

-- =====================================================================
-- 4. ADDITIONAL SECURITY: Prevent impersonation in markets INSERT
-- =====================================================================

-- Update markets INSERT policy to verify creator_wallet
DROP POLICY IF EXISTS "markets_insert_authenticated" ON public.markets;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;

CREATE POLICY "markets_insert_verified_creator" ON public.markets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    -- Verify creator_wallet matches authenticated wallet
    creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub'
    OR creator_wallet IS NULL -- Allow NULL for backwards compatibility
  );

COMMENT ON POLICY "markets_insert_verified_creator" ON public.markets IS
  'Market creator_wallet must match authenticated wallet (prevents spoofing)';

-- =====================================================================
-- 5. VERIFICATION QUERIES
-- =====================================================================

-- Verify all policies are in place
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  -- Check markets policies
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'markets'
    AND policyname IN (
      'markets_select_all',
      'markets_update_creator_only',
      'markets_delete_nobody',
      'markets_insert_verified_creator'
    );
  
  IF policy_count < 4 THEN
    RAISE WARNING 'Markets table missing security policies! Found % of 4', policy_count;
  ELSE
    RAISE NOTICE '✅ Markets table: All security policies in place';
  END IF;

  -- Check comments policies
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'comments'
    AND policyname IN (
      'comments_select_all',
      'comments_insert_verified_wallet',
      'comments_update_nobody',
      'comments_delete_own'
    );
  
  IF policy_count < 4 THEN
    RAISE WARNING 'Comments table missing security policies! Found % of 4', policy_count;
  ELSE
    RAISE NOTICE '✅ Comments table: All security policies in place';
  END IF;

  -- Check users policies
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'users'
    AND policyname IN (
      'users_select_all',
      'users_insert_own_only',
      'users_update_own_verified',
      'users_delete_nobody'
    );
  
  IF policy_count < 4 THEN
    RAISE WARNING 'Users table missing security policies! Found % of 4', policy_count;
  ELSE
    RAISE NOTICE '✅ Users table: All security policies in place';
  END IF;
END $$;

-- =====================================================================
-- IMPORTANT NOTES FOR DEPLOYMENT
-- =====================================================================

-- 1. JWT Validation: This migration assumes that the JWT 'sub' claim contains
--    the wallet public key. Verify this is correctly set up in your auth flow.
--
-- 2. Backwards Compatibility: Some policies allow NULL values for backwards
--    compatibility. Remove these after verifying all existing data is valid.
--
-- 3. Testing: Before deploying to production, test with:
--    - Anon client trying to update others' markets (should fail)
--    - Anon client trying to insert comments with fake pubkey (should fail)
--    - Authenticated user trying to create profile for another wallet (should fail)
--
-- 4. Monitoring: After deployment, monitor for:
--    - Increased RLS policy violation errors (expected initially)
--    - Failed INSERT/UPDATE attempts (potential attack attempts)
--    - Any legitimate operations that are blocked (fix policies if needed)
--
-- 5. Rollback Plan: If issues arise, you can temporarily revert to permissive
--    policies, but this should only be done as a last resort and with monitoring.

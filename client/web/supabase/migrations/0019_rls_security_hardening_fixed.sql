-- =====================================================================
-- Migration: RLS Security Hardening (FIXED)
-- Created: 2025-11-30
-- Purpose: Fix critical RLS vulnerabilities before mainnet launch
--
-- FIXES:
-- 1. UUID type casting for comments.user_id comparisons
-- 2. Reorganized policies: all 4 policies per table grouped together
-- 3. Fixed policy ordering (SELECT, INSERT, UPDATE, DELETE)
-- =====================================================================

-- =====================================================================
-- 1. MARKETS TABLE: 4 policies (SELECT, INSERT, UPDATE, DELETE)
-- =====================================================================

-- SELECT: Everyone can read
DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;
DROP POLICY IF EXISTS "markets_select_all" ON public.markets;
CREATE POLICY "markets_select_all" ON public.markets
  FOR SELECT
  TO public
  USING (true);

-- INSERT: Verify creator_wallet matches JWT
DROP POLICY IF EXISTS "markets_insert_authenticated" ON public.markets;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;
DROP POLICY IF EXISTS "markets_insert_verified_creator" ON public.markets;
CREATE POLICY "markets_insert_verified_creator" ON public.markets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub'
    OR creator_wallet IS NULL
  );

-- UPDATE: Only creator can update
DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;
DROP POLICY IF EXISTS "markets_update_all" ON public.markets;
DROP POLICY IF EXISTS "markets_update_creator_only" ON public.markets;
CREATE POLICY "markets_update_creator_only" ON public.markets
  FOR UPDATE
  TO authenticated, anon
  USING (
    creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub'
  )
  WITH CHECK (
    creator_wallet = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- DELETE: Nobody can delete
DROP POLICY IF EXISTS "markets_delete_nobody" ON public.markets;
CREATE POLICY "markets_delete_nobody" ON public.markets
  FOR DELETE
  TO public
  USING (false);

COMMENT ON POLICY "markets_select_all" ON public.markets IS 
  'Everyone can read market data';
COMMENT ON POLICY "markets_insert_verified_creator" ON public.markets IS
  'Market creator_wallet must match authenticated wallet';
COMMENT ON POLICY "markets_update_creator_only" ON public.markets IS 
  'Only the market creator can update market metadata';

-- =====================================================================
-- 2. COMMENTS TABLE: 4 policies (SELECT, INSERT, UPDATE, DELETE)
-- =====================================================================

-- SELECT: Everyone can read
DROP POLICY IF EXISTS "comments_select_all" ON public.comments;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.comments;
CREATE POLICY "comments_select_all" ON public.comments
  FOR SELECT
  TO public
  USING (true);

-- INSERT: Verify user_id matches JWT (CAST TO UUID!)
DROP POLICY IF EXISTS "comments_insert_anon" ON public.comments;
DROP POLICY IF EXISTS "comments_insert_authenticated" ON public.comments;
DROP POLICY IF EXISTS "comments_insert_verified_wallet" ON public.comments;
CREATE POLICY "comments_insert_verified_wallet" ON public.comments
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    -- CRITICAL: Cast JWT claim to UUID to match user_id column type
    user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

-- UPDATE: Comments are immutable
DROP POLICY IF EXISTS "comments_update_nobody" ON public.comments;
CREATE POLICY "comments_update_nobody" ON public.comments
  FOR UPDATE
  TO public
  USING (false);

-- DELETE: Only comment owner can delete
DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;
CREATE POLICY "comments_delete_own" ON public.comments
  FOR DELETE
  TO authenticated, anon
  USING (
    -- CRITICAL: Cast JWT claim to UUID
    user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

COMMENT ON POLICY "comments_select_all" ON public.comments IS
  'Everyone can read comments';
COMMENT ON POLICY "comments_insert_verified_wallet" ON public.comments IS
  'Users can only insert comments with their own wallet (prevents impersonation)';
COMMENT ON POLICY "comments_update_nobody" ON public.comments IS
  'Comments are immutable once posted';
COMMENT ON POLICY "comments_delete_own" ON public.comments IS
  'Users can delete their own comments only';

-- =====================================================================
-- 3. PROFILES TABLE: 4 policies (SELECT, INSERT, UPDATE, DELETE)
-- Note: Using 'profiles' table (not 'users') as per schema
-- =====================================================================

-- SELECT: Everyone can read
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles
  FOR SELECT
  TO public
  USING (true);

-- INSERT: Users can only insert their own profile
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    -- CRITICAL: Cast JWT claim to UUID to match user_id column type
    user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

-- UPDATE: Users can only update their own profile
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  TO authenticated, anon
  USING (
    -- CRITICAL: Cast JWT claim to UUID
    user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  )
  WITH CHECK (
    -- Prevent changing user_id
    user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

-- DELETE: Nobody can delete profiles
DROP POLICY IF EXISTS "profiles_delete_nobody" ON public.profiles;
CREATE POLICY "profiles_delete_nobody" ON public.profiles
  FOR DELETE
  TO public
  USING (false);

COMMENT ON POLICY "profiles_select_all" ON public.profiles IS
  'Everyone can read user profiles';
COMMENT ON POLICY "profiles_insert_own" ON public.profiles IS
  'Users can only create their own profile';
COMMENT ON POLICY "profiles_update_own" ON public.profiles IS
  'Users can only update their own profile';

-- =====================================================================
-- 4. VERIFICATION
-- =====================================================================

-- Verify all policies are in place
DO $$
DECLARE
  policy_count int;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename IN ('markets', 'comments', 'profiles')
    AND schemaname = 'public';
  
  IF policy_count < 12 THEN
    RAISE WARNING 'Expected 12 policies (4 per table), found %', policy_count;
  ELSE
    RAISE NOTICE '✅ All 12 RLS policies created successfully';
  END IF;
END $$;

-- Show all policies for verification
SELECT 
  tablename,
  policyname,
  cmd AS command,
  CASE 
    WHEN cmd = 'SELECT' THEN '1_SELECT'
    WHEN cmd = 'INSERT' THEN '2_INSERT'
    WHEN cmd = 'UPDATE' THEN '3_UPDATE'
    WHEN cmd = 'DELETE' THEN '4_DELETE'
  END AS sort_order
FROM pg_policies
WHERE tablename IN ('markets', 'comments', 'profiles')
  AND schemaname = 'public'
ORDER BY tablename, sort_order;

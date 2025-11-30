-- =====================================================================
-- Migration: RLS Security Hardening (SAFE VERSION)
-- Created: 2025-11-30
-- Purpose: Apply RLS security hardening only to existing tables
--
-- This version checks if tables exist before applying policies
-- Safe to run on any database state
-- =====================================================================

-- =====================================================================
-- 1. MARKETS TABLE (if exists)
-- =====================================================================

DO $$
BEGIN
  -- Only proceed if markets table exists
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'markets') THEN
    
    -- SELECT: Everyone can read
    DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;
    DROP POLICY IF EXISTS "markets_select_all" ON public.markets;
    EXECUTE 'CREATE POLICY "markets_select_all" ON public.markets FOR SELECT TO public USING (true)';
    
    -- INSERT: Verify creator_wallet matches JWT
    DROP POLICY IF EXISTS "markets_insert_authenticated" ON public.markets;
    DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;
    DROP POLICY IF EXISTS "markets_insert_verified_creator" ON public.markets;
    EXECUTE 'CREATE POLICY "markets_insert_verified_creator" ON public.markets
      FOR INSERT TO authenticated, anon
      WITH CHECK (
        creator_wallet = current_setting(''request.jwt.claims'', true)::json->>''sub''
        OR creator_wallet IS NULL
      )';
    
    -- UPDATE: Only creator can update
    DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;
    DROP POLICY IF EXISTS "markets_update_all" ON public.markets;
    DROP POLICY IF EXISTS "markets_update_creator_only" ON public.markets;
    EXECUTE 'CREATE POLICY "markets_update_creator_only" ON public.markets
      FOR UPDATE TO authenticated, anon
      USING (creator_wallet = current_setting(''request.jwt.claims'', true)::json->>''sub'')
      WITH CHECK (creator_wallet = current_setting(''request.jwt.claims'', true)::json->>''sub'')';
    
    -- DELETE: Nobody can delete
    DROP POLICY IF EXISTS "markets_delete_nobody" ON public.markets;
    EXECUTE 'CREATE POLICY "markets_delete_nobody" ON public.markets FOR DELETE TO public USING (false)';
    
    RAISE NOTICE '✅ Markets table: 4 policies created';
  ELSE
    RAISE WARNING '⚠️  Markets table does not exist - skipping';
  END IF;
END $$;

-- =====================================================================
-- 2. COMMENTS TABLE (if exists)
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'comments') THEN
    
    -- SELECT: Everyone can read
    DROP POLICY IF EXISTS "comments_select_all" ON public.comments;
    DROP POLICY IF EXISTS "Enable read access for all users" ON public.comments;
    EXECUTE 'CREATE POLICY "comments_select_all" ON public.comments FOR SELECT TO public USING (true)';
    
    -- INSERT: Verify user_id matches JWT (CAST TO UUID!)
    DROP POLICY IF EXISTS "comments_insert_anon" ON public.comments;
    DROP POLICY IF EXISTS "comments_insert_authenticated" ON public.comments;
    DROP POLICY IF EXISTS "comments_insert_verified_wallet" ON public.comments;
    EXECUTE 'CREATE POLICY "comments_insert_verified_wallet" ON public.comments
      FOR INSERT TO authenticated, anon
      WITH CHECK (user_id = (current_setting(''request.jwt.claims'', true)::json->>''sub'')::uuid)';
    
    -- UPDATE: Comments are immutable
    DROP POLICY IF EXISTS "comments_update_nobody" ON public.comments;
    EXECUTE 'CREATE POLICY "comments_update_nobody" ON public.comments FOR UPDATE TO public USING (false)';
    
    -- DELETE: Only comment owner can delete
    DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;
    EXECUTE 'CREATE POLICY "comments_delete_own" ON public.comments
      FOR DELETE TO authenticated, anon
      USING (user_id = (current_setting(''request.jwt.claims'', true)::json->>''sub'')::uuid)';
    
    RAISE NOTICE '✅ Comments table: 4 policies created';
  ELSE
    RAISE WARNING '⚠️  Comments table does not exist - skipping';
  END IF;
END $$;

-- =====================================================================
-- 3. USERS TABLE (if exists)
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
    
    -- SELECT: Everyone can read
    DROP POLICY IF EXISTS "users_select_all" ON public.users;
    DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.users;
    EXECUTE 'CREATE POLICY "users_select_all" ON public.users FOR SELECT TO public USING (true)';
    
    -- INSERT: Users can only insert their own profile
    DROP POLICY IF EXISTS "users_insert_own" ON public.users;
    DROP POLICY IF EXISTS "users_insert_all" ON public.users;
    DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
    EXECUTE 'CREATE POLICY "users_insert_own" ON public.users
      FOR INSERT TO authenticated, anon
      WITH CHECK (pubkey = current_setting(''request.jwt.claims'', true)::json->>''sub'')';
    
    -- UPDATE: Users can only update their own profile
    DROP POLICY IF EXISTS "users_update_own" ON public.users;
    DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
    EXECUTE 'CREATE POLICY "users_update_own" ON public.users
      FOR UPDATE TO authenticated, anon
      USING (pubkey = current_setting(''request.jwt.claims'', true)::json->>''sub'')
      WITH CHECK (pubkey = current_setting(''request.jwt.claims'', true)::json->>''sub'')';
    
    -- DELETE: Nobody can delete profiles
    DROP POLICY IF EXISTS "users_delete_nobody" ON public.users;
    EXECUTE 'CREATE POLICY "users_delete_nobody" ON public.users FOR DELETE TO public USING (false)';
    
    RAISE NOTICE '✅ Users table: 4 policies created';
  ELSE
    RAISE WARNING '⚠️  Users table does not exist - skipping';
  END IF;
END $$;

-- =====================================================================
-- 4. VERIFICATION
-- =====================================================================

DO $$
DECLARE
  policy_count int;
  tables_found text[] := ARRAY[]::text[];
BEGIN
  -- Check which tables exist
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'markets') THEN
    tables_found := array_append(tables_found, 'markets');
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'comments') THEN
    tables_found := array_append(tables_found, 'comments');
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
    tables_found := array_append(tables_found, 'users');
  END IF;
  
  -- Count policies for existing tables
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = ANY(tables_found)
    AND schemaname = 'public';
  
  RAISE NOTICE '📊 Tables found: %', array_to_string(tables_found, ', ');
  RAISE NOTICE '📊 Total policies created: %', policy_count;
  RAISE NOTICE '📊 Expected: % policies (4 per table)', array_length(tables_found, 1) * 4;
  
  IF policy_count >= array_length(tables_found, 1) * 4 THEN
    RAISE NOTICE '✅ RLS SECURITY HARDENING COMPLETE';
  ELSE
    RAISE WARNING '⚠️  Some policies may be missing';
  END IF;
END $$;

-- Show all policies for verification
SELECT 
  tablename,
  policyname,
  cmd AS command
FROM pg_policies
WHERE tablename IN ('markets', 'comments', 'users')
  AND schemaname = 'public'
ORDER BY tablename, 
  CASE 
    WHEN cmd = 'SELECT' THEN 1
    WHEN cmd = 'INSERT' THEN 2
    WHEN cmd = 'UPDATE' THEN 3
    WHEN cmd = 'DELETE' THEN 4
  END;

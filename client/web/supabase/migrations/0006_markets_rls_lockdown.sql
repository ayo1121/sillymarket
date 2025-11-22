-- =====================================================================
-- SUPABASE RLS LOCKDOWN - MARKETS TABLE
-- Migration: 0006_markets_rls_lockdown.sql
-- Purpose: Remove frontend ability to insert market metadata
-- Date: 2025-11-22
-- =====================================================================
--
-- SUMMARY OF CHANGES:
-- - Remove anon/authenticated INSERT permission on markets table
-- - Only service_role or backend (via DATABASE_URL) can insert markets
-- - Frontend remains read-only
--
-- This migration is idempotent and safe to run multiple times.
-- =====================================================================

-- Enable RLS if not already enabled
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;

-- Drop old insert-once policy that allowed anon/auth to insert
DROP POLICY IF EXISTS "markets_insert_once" ON public.markets;

-- ✅ SECURE: Read access for everyone (market metadata is public)
DROP POLICY IF EXISTS "markets_select_all" ON public.markets;
CREATE POLICY "markets_select_all"
ON public.markets
FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: NO INSERT for anon/authenticated (frontend blocked)
DROP POLICY IF EXISTS "markets_insert_service_only" ON public.markets;
CREATE POLICY "markets_insert_service_only"
ON public.markets
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

-- ✅ SECURE: Allow INSERT for service_role (Edge Functions)
DROP POLICY IF EXISTS "markets_insert_service_role" ON public.markets;
CREATE POLICY "markets_insert_service_role"
ON public.markets
FOR INSERT
TO authenticated
WITH CHECK (
  (auth.jwt() ->> 'role') = 'service_role'
);

-- ✅ SECURE: NO UPDATE allowed from frontend (keep existing policy)
-- Policy "markets_no_update" already exists from 0004_fix_rls_policies.sql

-- ✅ SECURE: NO DELETE allowed from frontend (keep existing policy)
-- Policy "markets_no_delete" already exists from 0004_fix_rls_policies.sql

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
--
-- SUMMARY:
-- ✅ Frontend (anon/authenticated) can only SELECT from markets
-- ✅ Frontend CANNOT INSERT/UPDATE/DELETE markets
-- ✅ Edge Functions (service_role) CAN INSERT markets
-- ✅ Backend (DATABASE_URL) CAN INSERT markets (bypasses RLS)
--
-- NEXT STEPS:
-- 1. Run this migration: supabase db push
-- 2. Verify frontend cannot insert markets
-- 3. Verify Edge Function CAN insert markets
-- 4. Update frontend to remove any market insert code
--
-- =====================================================================

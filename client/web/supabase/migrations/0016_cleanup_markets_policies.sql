-- Migration: Cleanup duplicate RLS policies on markets table
-- Created: 2025-11-29
-- Purpose: Remove redundant duplicate policies while maintaining same access level

-- Drop the older duplicate policies (keeping the newer, more descriptive ones)
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;

-- The following policies remain active and provide the same access:
-- - markets_insert_authenticated (INSERT for anon, authenticated)
-- - markets_select_all (SELECT for anon, authenticated)
-- 
-- Note: We keep markets_insert_authenticated and markets_select_all as they have
-- clearer naming and were added by migration 0014.

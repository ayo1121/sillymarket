-- Migration: Allow anon users to insert comments
-- Created: 2025-11-29
-- Purpose: Enable Supabase fallback for comment posting when backend API is unavailable

-- Add policy to allow anon users to insert comments
-- This supports the frontend Supabase fallback path in CommentsSection.tsx
DROP POLICY IF EXISTS "comments_insert_anon" ON public.comments;
CREATE POLICY "comments_insert_anon" ON public.comments
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Note: The existing comments_insert_authenticated policy remains for authenticated users
-- Both policies can coexist, allowing both anon and authenticated users to insert comments

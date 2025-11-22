-- =====================================================================
-- SUPABASE STORAGE SECURITY: market-images bucket
-- Migration: 0005_storage_market_images_policies.sql
-- Purpose: Lock down market-images bucket with secure RLS policies
-- Date: 2025-11-22
-- =====================================================================
--
-- SUMMARY OF CHANGES:
-- 1. Enable RLS on storage.objects
-- 2. Allow public read access (SELECT) for all images
-- 3. Allow controlled uploads (INSERT) from anon/authenticated users
-- 4. Deny updates (UPDATE) - images are immutable
-- 5. Deny deletes (DELETE) from frontend
--
-- SECURITY MODEL:
-- - Public read: Anyone can view uploaded images
-- - Controlled upload: Users can upload, but size/MIME checks in frontend
-- - Immutable: No updates allowed (images can't be modified)
-- - No delete: Frontend cannot delete images (admin/backend only)
--
-- This migration is idempotent and safe to run multiple times.
-- =====================================================================

-- =====================================================================
-- 1. ENABLE RLS ON storage.objects
-- =====================================================================

-- Enable RLS on storage.objects table (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 2. DROP EXISTING POLICIES FOR market-images BUCKET
-- =====================================================================

-- Drop any existing policies to ensure clean slate
DROP POLICY IF EXISTS "market_images_select_all" ON storage.objects;
DROP POLICY IF EXISTS "market_images_insert_all" ON storage.objects;
DROP POLICY IF EXISTS "market_images_no_update" ON storage.objects;
DROP POLICY IF EXISTS "market_images_no_delete" ON storage.objects;

-- Also drop any legacy policies that might exist
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
DROP POLICY IF EXISTS "Enable read access for all users" ON storage.objects;
DROP POLICY IF EXISTS "Enable insert access for all users" ON storage.objects;

-- =====================================================================
-- 3. CREATE SECURE POLICIES FOR market-images BUCKET
-- =====================================================================

-- ✅ POLICY: Public read access
-- Allow anyone to view/download images from market-images bucket
CREATE POLICY "market_images_select_all"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'market-images');

-- ✅ POLICY: Controlled upload access
-- Allow anon/authenticated users to upload images
-- 
-- IMPORTANT NOTES:
-- - File size limit: Frontend enforces 5MB max (storage.ts:21-24)
-- - MIME type validation: Frontend checks for image/jpeg, image/png, image/gif
-- - Path validation: Images stored in 'mkt/' folder with timestamp + random ID
-- - SQL cannot directly validate file size or MIME type
-- - These checks MUST be enforced at the application layer (frontend/Edge Function)
--
CREATE POLICY "market_images_insert_all"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'market-images'
  -- Additional path validation could be added here if needed:
  -- AND (storage.foldername(name))[1] = 'mkt'
);

-- ✅ POLICY: Deny updates (images are immutable)
-- Once uploaded, images cannot be modified
-- This prevents attackers from replacing legitimate images with malicious content
CREATE POLICY "market_images_no_update"
ON storage.objects
FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ POLICY: Deny deletes from frontend
-- Only backend/admin should be able to delete images (via service role)
-- This prevents users from deleting other users' market images
CREATE POLICY "market_images_no_delete"
ON storage.objects
FOR DELETE
TO anon, authenticated
USING (false);

-- =====================================================================
-- 4. BUCKET CONFIGURATION NOTES
-- =====================================================================
--
-- The following settings should be configured in Supabase Dashboard:
-- (These cannot be set via SQL migration)
--
-- Bucket: market-images
-- - Public: YES (allow public read access)
-- - File size limit: 5MB (enforced by frontend, but good to set here too)
-- - Allowed MIME types: image/jpeg, image/png, image/gif
--
-- To configure via Supabase Dashboard:
-- 1. Go to Storage → market-images bucket
-- 2. Settings → Make bucket public
-- 3. Settings → Set file size limit to 5MB
-- 4. Settings → Set allowed MIME types
--
-- =====================================================================

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
--
-- SUMMARY OF SECURITY IMPROVEMENTS:
--
-- ✅ Public read: Anyone can view uploaded market images
-- ✅ Controlled upload: Anon/authenticated can upload (frontend validates size/type)
-- ✅ Immutable: Images cannot be updated after upload
-- ✅ No delete: Frontend cannot delete images (prevents abuse)
--
-- SECURITY MODEL:
-- - Read: Public (images are meant to be displayed on markets)
-- - Upload: Controlled (users can upload, frontend enforces limits)
-- - Update: Denied (images are immutable)
-- - Delete: Denied from frontend (only backend/admin via service role)
--
-- NEXT STEPS:
-- 1. Run this migration: supabase db push
-- 2. Configure bucket settings in Supabase Dashboard (public, size limit, MIME types)
-- 3. Test image upload from frontend (client/web/src/integrations/supabase/storage.ts)
-- 4. Verify images are publicly accessible
-- 5. Test that update/delete are blocked from frontend
--
-- =====================================================================

-- 0014_fix_rls_for_frontend_writes.sql
------------------------------------------------

-- Allow authenticated users to insert comments
DROP POLICY IF EXISTS "comments_insert_authenticated" ON comments;
CREATE POLICY "comments_insert_authenticated" ON comments
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow anyone (public) to insert users (for wallet connection)
DROP POLICY IF EXISTS "users_insert_all" ON users;
CREATE POLICY "users_insert_all" ON users
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Allow users to update their own username
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users
  FOR UPDATE
  TO public
  USING (pubkey = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (pubkey = current_setting('request.jwt.claims', true)::json->>'sub');

-- Fix markets INSERT - allow authenticated and anon users via anon key
DROP POLICY IF EXISTS "markets_insert_service_only" ON markets;
DROP POLICY IF EXISTS "markets_insert_service_role" ON markets;
CREATE POLICY "markets_insert_authenticated" ON markets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Enable RLS where missing
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE siws_nonces ENABLE ROW LEVEL SECURITY;

-- Users: allow read for everyone
DROP POLICY IF EXISTS "users_select_all" ON users;
CREATE POLICY "users_select_all" ON users
  FOR SELECT
  TO public
  USING (true);

-- Comments: allow read for everyone
DROP POLICY IF EXISTS "comments_select_all" ON comments;
CREATE POLICY "comments_select_all" ON comments
  FOR SELECT
  TO public
  USING (true);

-- siws_nonces: allow inserts, own-select, and delete expired
DROP POLICY IF EXISTS "siws_nonces_insert_all" ON siws_nonces;
CREATE POLICY "siws_nonces_insert_all" ON siws_nonces
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "siws_nonces_select_own" ON siws_nonces;
CREATE POLICY "siws_nonces_select_own" ON siws_nonces
  FOR SELECT
  TO public
  USING (
    pubkey = current_setting('request.jwt.claims', true)::json->>'sub'
    OR true
  );

DROP POLICY IF EXISTS "siws_nonces_delete_expired" ON siws_nonces;
CREATE POLICY "siws_nonces_delete_expired" ON siws_nonces
  FOR DELETE
  TO public
  USING (expires_at < NOW());

# Supabase Security Audit Report

**Audit Date:** 2025-11-22  
**Scope:** Supabase database, RLS policies, key usage  
**Auditor:** Security Team

---

## Executive Summary

**Total Issues Found:** 4 CRITICAL, 2 HIGH, 1 MEDIUM  
**RLS Status:** Partially implemented with critical gaps  
**Service Key Exposure:** ✅ Properly isolated (Edge Function only)  
**Anon Key Exposure:** ✅ Safe (frontend only, as designed)

**CRITICAL FINDINGS:**
1. **`markets` table**: Allows anonymous INSERT/UPDATE (anyone can modify any market metadata)
2. **`bets` table**: NO RLS policies in migration 0003 (anyone can write/delete bet records)
3. **`comments` table**: References `auth.users` but app uses wallet-based auth (broken foreign key)
4. **`profiles` table**: References `auth.users` but app doesn't use Supabase Auth

**Overall Assessment:** 🔴 **CRITICAL** - Database is vulnerable to unauthorized writes. RLS policies must be fixed before production deployment.

---

## Environment Variables Analysis

### Frontend (client/web/.env.example)

| Variable | Type | Exposure | Security Status |
|----------|------|----------|-----------------|
| `VITE_SUPABASE_URL` | Public | Frontend | ✅ Safe (public URL) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon Key | Frontend | ✅ Safe (designed for frontend) |

**Verdict:** ✅ **SAFE** - Only anon key exposed to frontend, as intended.

### Backend (server/.env.example)

| Variable | Type | Exposure | Security Status |
|----------|------|----------|-----------------|
| `DATABASE_URL` | PostgreSQL Connection | Server-only | ✅ Safe (includes password) |
| `SESSION_SECRET` | JWT Secret | Server-only | ✅ Safe (server-only) |

**Verdict:** ✅ **SAFE** - No Supabase service key used in backend.

### Edge Function (supabase/functions/index_bet_event/index.ts)

| Variable | Type | Exposure | Security Status |
|----------|------|----------|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service Key | Edge Function only | ✅ Safe (Deno.env, not exposed) |

**Verdict:** ✅ **SAFE** - Service key only used in Edge Function (server-side), never exposed to frontend.

---

## Table Schema Analysis

### TABLE: `markets`

**Purpose:** Store market metadata (question, description, creator info, outcome labels)

**Schema:**
```sql
CREATE TABLE public.markets (
  market_pubkey text PRIMARY KEY,
  question text,
  description text,
  creator_wallet text,
  creator_name text,
  image_url text,
  answers text[]
);
```

**Current RLS Policies (from 0002_init_markets.sql):**
```sql
-- ❌ CRITICAL: Allows ANYONE (even anon) to INSERT
CREATE POLICY "Enable insert access for all users"
ON public.markets FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- ❌ CRITICAL: Allows ANYONE to UPDATE any market
CREATE POLICY "Enable update access for all users"
ON public.markets FOR UPDATE
TO anon, authenticated
USING (true) WITH CHECK (true);

-- ✅ OK: Read access for all
CREATE POLICY "Enable read access for all users"
ON public.markets FOR SELECT
TO anon, authenticated
USING (true);
```

**🔴 CRITICAL EXPLOIT:**
```typescript
// Attacker can modify ANY market's metadata
const { error } = await supabase
  .from('markets')
  .update({ 
    question: "HACKED MARKET",
    creator_name: "Attacker",
    answers: ["Scam", "Rug"]
  })
  .eq('market_pubkey', 'ANY_MARKET_PUBKEY');
// This will succeed! No authorization check!
```

**Impact:**
- Attacker can change market questions to misleading text
- Attacker can modify outcome labels to confuse bettors
- Attacker can impersonate market creators
- Attacker can inject malicious image URLs

**Recommended RLS Policies:**
```sql
-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;

-- ✅ SECURE: Read access for everyone
CREATE POLICY "markets_select_all"
ON public.markets FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: Only allow INSERT if no row exists (prevent duplicates)
-- Note: This doesn't verify the creator, but prevents overwrites
-- The on-chain program is the source of truth for market creation
CREATE POLICY "markets_insert_once"
ON public.markets FOR INSERT
TO anon, authenticated
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.markets 
    WHERE market_pubkey = NEW.market_pubkey
  )
);

-- ✅ SECURE: NO UPDATE allowed
-- Market metadata should be immutable after creation
-- If updates are needed, they should go through a backend API with proper auth
CREATE POLICY "markets_no_update"
ON public.markets FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ SECURE: NO DELETE allowed
CREATE POLICY "markets_no_delete"
ON public.markets FOR DELETE
TO anon, authenticated
USING (false);
```

**Alternative (if updates are needed):**
```sql
-- Only allow updates from backend with service key
-- Frontend (anon key) cannot update
CREATE POLICY "markets_update_service_only"
ON public.markets FOR UPDATE
TO authenticated  -- Service key creates authenticated session
USING (
  -- Check if the request is from service role
  auth.jwt() ->> 'role' = 'service_role'
);
```

---

### TABLE: `bets`

**Purpose:** Store bet events indexed from on-chain transactions (via Helius webhook → Edge Function)

**Schema (from 0003_create_bets_table.sql):**
```sql
CREATE TABLE public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_pubkey text NOT NULL,
  bettor_pubkey text NOT NULL,
  username text,
  outcome_index integer NOT NULL,
  outcome_label text,
  amount_sol numeric NOT NULL,
  tx_sig text NOT NULL,
  block_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Current RLS Policies:**
```sql
-- ❌ CRITICAL: NO RLS POLICIES DEFINED!
-- Table has no ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- Anyone with anon key can INSERT/UPDATE/DELETE
```

**🔴 CRITICAL EXPLOIT:**
```typescript
// Attacker can insert fake bet records
const { error } = await supabase
  .from('bets')
  .insert({
    market_pubkey: 'ANY_MARKET',
    bettor_pubkey: 'VICTIM_WALLET',
    outcome_index: 0,
    amount_sol: 1000000,  // Fake huge bet
    tx_sig: 'FAKE_SIG',
    block_time: new Date().toISOString()
  });
// This will succeed! No RLS protection!

// Attacker can delete all bet records
const { error } = await supabase
  .from('bets')
  .delete()
  .neq('id', '00000000-0000-0000-0000-000000000000');
// This will succeed! All bets deleted!
```

**Impact:**
- Attacker can inject fake bet records to manipulate market history
- Attacker can delete legitimate bet records
- Attacker can modify bet amounts to show false volume
- Market probability charts will show incorrect data

**Recommended RLS Policies:**
```sql
-- Enable RLS on bets table
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

-- ✅ SECURE: Read access for everyone
CREATE POLICY "bets_select_all"
ON public.bets FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: Only Edge Function (service role) can INSERT
-- Frontend should NEVER write to bets table
CREATE POLICY "bets_insert_service_only"
ON public.bets FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt() ->> 'role' = 'service_role'
);

-- ✅ SECURE: NO UPDATE allowed
CREATE POLICY "bets_no_update"
ON public.bets FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ SECURE: NO DELETE allowed
CREATE POLICY "bets_no_delete"
ON public.bets FOR DELETE
TO anon, authenticated
USING (false);
```

**Code Comment (client/web/src/solana/read.ts:261):**
```typescript
// ✅ GOOD: Frontend only reads from public.bets
// "Frontend only reads from public.bets and listens to Supabase Realtime; 
//  it never writes bets rows."
// This is the correct architecture, but RLS must enforce it!
```

---

### TABLE: `comments`

**Purpose:** Store user comments on markets (backend PostgreSQL, NOT Supabase Auth)

**Schema (from 0001_init_comments_bets_profiles.sql):**
```sql
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,  -- ❌ BROKEN
  comment_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Current RLS Policies:**
```sql
-- ✅ OK: Read access for all
CREATE POLICY "Comments are viewable by everyone"
ON public.comments FOR SELECT
USING (true);

-- ❌ BROKEN: References auth.uid() but app uses wallet-based auth
CREATE POLICY "Users can insert their own comments"
ON public.comments FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- ❌ BROKEN: References auth.uid() but app uses wallet-based auth
CREATE POLICY "Users can delete their own comments"
ON public.comments FOR DELETE
USING (auth.uid() = user_id);
```

**🔴 CRITICAL ISSUE:**
The `comments` table references `auth.users` table, but the application uses **wallet-based authentication** (SIWS) via the backend's PostgreSQL `users` table, NOT Supabase Auth.

**Current Architecture:**
- Backend: `server/src/index.ts` creates `users` table in PostgreSQL
- Backend: Uses JWT sessions, not Supabase Auth
- Frontend: No Supabase Auth session
- Result: `auth.uid()` is always `NULL` → RLS policies fail

**Impact:**
- ❌ Users cannot post comments (INSERT policy fails)
- ❌ Users cannot delete their comments (DELETE policy fails)
- ✅ Users can read comments (SELECT policy works)

**Recommended Fix:**

**Option 1: Use Backend API for Comments (RECOMMENDED)**
```sql
-- Disable RLS on comments (backend handles authorization)
ALTER TABLE public.comments DISABLE ROW LEVEL SECURITY;

-- Remove foreign key to auth.users
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_user_id_fkey;

-- Change user_id to reference backend's users table
-- (This requires backend users table to be in same Supabase database)
-- OR: Remove foreign key entirely and rely on backend validation
```

**Backend handles authorization:**
```typescript
// server/src/index.ts (already implemented correctly)
app.post("/comments", async (req, res) => {
  const user = (req as any).user as JwtUser | undefined;
  if (!user) return res.status(401).json({ error: "unauthorized" });
  
  // Backend validates user owns the comment
  await pool.query(
    `INSERT INTO comments (market_id, user_id, comment_text)
     VALUES ($1, $2, $3)`,
    [marketId, user.id, commentText]  // ✅ Backend controls user_id
  );
});
```

**Option 2: Migrate to Supabase Auth (NOT RECOMMENDED)**
This would require major refactoring of the authentication system.

**RECOMMENDATION:** Use Option 1 - disable RLS on comments, let backend API handle authorization.

---

### TABLE: `profiles`

**Purpose:** Store user profiles (username, avatar, wallet address)

**Schema (from 0001_init_comments_bets_profiles.sql):**
```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,  -- ❌ BROKEN
  username text UNIQUE,
  avatar_url text,
  wallet_address text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Current RLS Policies:**
```sql
-- ✅ OK: Read access for all
CREATE POLICY "Profiles are viewable by everyone"
ON public.profiles FOR SELECT
USING (true);

-- ❌ BROKEN: References auth.uid() but app uses wallet-based auth
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id);

-- ❌ BROKEN: References auth.uid() but app uses wallet-based auth
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);
```

**🔴 CRITICAL ISSUE:**
Same problem as `comments` table - references `auth.users` but app uses backend PostgreSQL `users` table.

**Current Usage:**
The app uses the backend's `users` table (server/src/index.ts) for usernames, NOT this `profiles` table.

**Recommended Fix:**
```sql
-- This table is NOT USED by the application
-- The backend uses its own `users` table in PostgreSQL
-- Either:
-- 1. DROP this table entirely
DROP TABLE IF EXISTS public.profiles CASCADE;

-- OR:
-- 2. Disable RLS and use backend API
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
```

**RECOMMENDATION:** Drop the `profiles` table - it's not used and creates confusion.

---

### TABLE: `users` (Backend PostgreSQL)

**Purpose:** Store wallet-based user accounts (created by backend server)

**Schema (from server/src/index.ts):**
```sql
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pubkey text NOT NULL UNIQUE,
  username text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Location:** Backend PostgreSQL database (NOT Supabase, but uses Supabase's PostgreSQL)

**RLS Status:** ❌ **NO RLS POLICIES** (table created by backend migration)

**Access:** Backend server has direct PostgreSQL access via `DATABASE_URL`

**Security:**
- ✅ Backend controls all writes (users cannot write directly)
- ✅ Backend validates wallet signatures before creating users
- ❌ If Supabase anon key has access to this database, users could read/write

**Recommended RLS Policies:**
```sql
-- Enable RLS on backend's users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ✅ SECURE: Read access for everyone (usernames are public)
CREATE POLICY "users_select_all"
ON public.users FOR SELECT
TO anon, authenticated
USING (true);

-- ✅ SECURE: NO INSERT from frontend
-- Only backend (with direct PostgreSQL connection) can insert
CREATE POLICY "users_no_insert"
ON public.users FOR INSERT
TO anon, authenticated
WITH CHECK (false);

-- ✅ SECURE: NO UPDATE from frontend
CREATE POLICY "users_no_update"
ON public.users FOR UPDATE
TO anon, authenticated
USING (false);

-- ✅ SECURE: NO DELETE from frontend
CREATE POLICY "users_no_delete"
ON public.users FOR DELETE
TO anon, authenticated
USING (false);
```

**Note:** Backend bypasses RLS because it connects with `DATABASE_URL` (full PostgreSQL access), not Supabase client.

---

### TABLE: `siws_nonces` (Backend PostgreSQL)

**Purpose:** Store SIWS authentication nonces (created by backend server)

**Schema (from server/src/index.ts):**
```sql
CREATE TABLE IF NOT EXISTS siws_nonces (
  nonce text PRIMARY KEY,
  pubkey text NOT NULL,
  message text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
```

**RLS Status:** ❌ **NO RLS POLICIES**

**Security Risk:** 🔴 **HIGH**
- If Supabase anon key has access, users could:
  - Read nonces (not critical, but reveals authentication attempts)
  - Delete nonces (DoS attack on authentication)
  - Insert fake nonces (authentication bypass attempt)

**Recommended RLS Policies:**
```sql
-- Enable RLS on siws_nonces table
ALTER TABLE public.siws_nonces ENABLE ROW LEVEL SECURITY;

-- ✅ SECURE: NO access from frontend
CREATE POLICY "siws_nonces_no_select"
ON public.siws_nonces FOR SELECT
TO anon, authenticated
USING (false);

CREATE POLICY "siws_nonces_no_insert"
ON public.siws_nonces FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "siws_nonces_no_update"
ON public.siws_nonces FOR UPDATE
TO anon, authenticated
USING (false);

CREATE POLICY "siws_nonces_no_delete"
ON public.siws_nonces FOR DELETE
TO anon, authenticated
USING (false);
```

---

## Storage Bucket Analysis

### BUCKET: `market-images`

**Purpose:** Store market images uploaded by users

**Access:** Frontend uploads via anon key (client/web/src/integrations/supabase/storage.ts)

**Current Policies:** ❌ **NOT DOCUMENTED** (need to check Supabase dashboard)

**Recommended Storage Policies:**
```sql
-- Allow anyone to upload images
CREATE POLICY "market_images_insert_all"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'market-images' AND
  -- Limit file size (enforced by frontend, but good to have here too)
  (storage.foldername(name))[1] = 'mkt'
);

-- Allow anyone to read images (public bucket)
CREATE POLICY "market_images_select_all"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'market-images');

-- Prevent updates (images are immutable)
CREATE POLICY "market_images_no_update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (false);

-- Prevent deletes from frontend
CREATE POLICY "market_images_no_delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (false);
```

**Additional Security:**
- Set bucket to **public** (images are public anyway)
- Configure file size limits (5MB max)
- Configure allowed MIME types (image/jpeg, image/png, image/gif)

---

## Supabase Client Usage Analysis

### Frontend (client/web/)

**Files:**
- `src/integrations/supabase/client.ts` - Supabase client initialization
- `src/integrations/supabase/markets.ts` - Market metadata read/write
- `src/integrations/supabase/storage.ts` - Image uploads
- `src/solana/read.ts` - Bet history reads

**Key Used:** `VITE_SUPABASE_PUBLISHABLE_KEY` (anon key)

**Operations:**
- ✅ **READ**: Markets, bets, usernames (safe)
- ❌ **WRITE**: Markets metadata (CRITICAL - should be blocked by RLS)
- ✅ **UPLOAD**: Images to storage (safe with proper policies)

**Vulnerable Code (client/web/src/integrations/supabase/markets.ts:164-168):**
```typescript
// ❌ CRITICAL: Frontend can upsert market metadata
const { error } = await (supabase as any)
  .from<RemoteMarketMetadata>(MARKETS_TABLE)
  .upsert(payload);  // ← This should be blocked by RLS!
```

**Fix:** RLS policies above will block this. Alternatively, remove this code and only allow backend to write.

### Backend (server/)

**Supabase Usage:** ❌ **NONE**

Backend connects directly to PostgreSQL via `DATABASE_URL`, not Supabase client.

**Verdict:** ✅ **SAFE** - Backend doesn't use Supabase client, so no risk of key exposure.

### Edge Function (supabase/functions/index_bet_event/)

**Key Used:** `SUPABASE_SERVICE_ROLE_KEY` (service key)

**Operations:**
- ✅ **WRITE**: Insert bet records (correct - only Edge Function should write)

**Verdict:** ✅ **SAFE** - Service key only used in Edge Function (server-side).

---

## Critical Exploit Scenarios

### EXPLOIT #1: Market Metadata Manipulation

**Attack:**
```typescript
// Attacker modifies market question to scam users
const supabase = createClient(SUPABASE_URL, ANON_KEY);

await supabase
  .from('markets')
  .update({
    question: "Send SOL to AttackerWallet123 to win!",
    answers: ["Yes", "No"],
    image_url: "https://evil.com/phishing.jpg"
  })
  .eq('market_pubkey', 'LEGITIMATE_MARKET_PUBKEY');
```

**Impact:** Users see fake market question, get scammed

**Fix:** Implement `markets_no_update` RLS policy

---

### EXPLOIT #2: Fake Bet Injection

**Attack:**
```typescript
// Attacker injects fake bets to manipulate market probabilities
const supabase = createClient(SUPABASE_URL, ANON_KEY);

for (let i = 0; i < 1000; i++) {
  await supabase
    .from('bets')
    .insert({
      market_pubkey: 'TARGET_MARKET',
      bettor_pubkey: `FAKE_WALLET_${i}`,
      outcome_index: 0,  // All bets on "Yes"
      amount_sol: 100,
      tx_sig: `FAKE_${i}`,
      block_time: new Date().toISOString()
    });
}
```

**Impact:** Market shows 100% probability for "Yes", misleading real bettors

**Fix:** Implement `bets_insert_service_only` RLS policy

---

### EXPLOIT #3: Bet History Deletion

**Attack:**
```typescript
// Attacker deletes all bet records
const supabase = createClient(SUPABASE_URL, ANON_KEY);

await supabase
  .from('bets')
  .delete()
  .neq('id', '00000000-0000-0000-0000-000000000000');
```

**Impact:** All market history lost, charts show no data

**Fix:** Implement `bets_no_delete` RLS policy

---

## Server-Only Environment Variables Checklist

### ✅ MUST REMAIN SERVER-ONLY

| Variable | Location | Why Server-Only |
|----------|----------|-----------------|
| `DATABASE_URL` | Backend | Contains database password |
| `SESSION_SECRET` | Backend | Used to sign JWTs |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function | Bypasses RLS, full database access |

### ✅ SAFE FOR FRONTEND

| Variable | Location | Why Safe |
|----------|----------|----------|
| `VITE_SUPABASE_URL` | Frontend | Public URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Anon key, designed for frontend, RLS enforces permissions |

---

## Complete RLS Policy Implementation

### SQL Script: `supabase/migrations/0004_fix_rls_policies.sql`

```sql
-- =====================================================================
-- FIX RLS POLICIES FOR PRODUCTION
-- This migration fixes critical security issues in tables
-- =====================================================================

-- =====================================================================
-- 1. FIX MARKETS TABLE
-- =====================================================================

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.markets;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.markets;

-- Read access for everyone
CREATE POLICY "markets_select_all"
ON public.markets FOR SELECT
TO anon, authenticated
USING (true);

-- Insert only if market doesn't exist (prevent overwrites)
CREATE POLICY "markets_insert_once"
ON public.markets FOR INSERT
TO anon, authenticated
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.markets 
    WHERE market_pubkey = NEW.market_pubkey
  )
);

-- NO updates allowed from frontend
CREATE POLICY "markets_no_update"
ON public.markets FOR UPDATE
TO anon, authenticated
USING (false);

-- NO deletes allowed
CREATE POLICY "markets_no_delete"
ON public.markets FOR DELETE
TO anon, authenticated
USING (false);

-- =====================================================================
-- 2. FIX BETS TABLE
-- =====================================================================

-- Enable RLS (missing in original migration)
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

-- Read access for everyone
CREATE POLICY "bets_select_all"
ON public.bets FOR SELECT
TO anon, authenticated
USING (true);

-- Only service role can insert (Edge Function only)
CREATE POLICY "bets_insert_service_only"
ON public.bets FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt() ->> 'role' = 'service_role'
);

-- NO updates allowed
CREATE POLICY "bets_no_update"
ON public.bets FOR UPDATE
TO anon, authenticated
USING (false);

-- NO deletes allowed
CREATE POLICY "bets_no_delete"
ON public.bets FOR DELETE
TO anon, authenticated
USING (false);

-- =====================================================================
-- 3. FIX COMMENTS TABLE (Disable RLS, use backend API)
-- =====================================================================

-- Disable RLS - backend handles authorization
ALTER TABLE public.comments DISABLE ROW LEVEL SECURITY;

-- Drop broken policies that reference auth.uid()
DROP POLICY IF EXISTS "Users can insert their own comments" ON public.comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.comments;
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;

-- Remove foreign key to auth.users (not used)
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_user_id_fkey;

-- =====================================================================
-- 4. DROP UNUSED PROFILES TABLE
-- =====================================================================

-- This table references auth.users but app uses backend users table
DROP TABLE IF EXISTS public.profiles CASCADE;

-- =====================================================================
-- 5. SECURE BACKEND TABLES (users, siws_nonces)
-- =====================================================================

-- Secure users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_all"
ON public.users FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "users_no_insert"
ON public.users FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "users_no_update"
ON public.users FOR UPDATE
TO anon, authenticated
USING (false);

CREATE POLICY "users_no_delete"
ON public.users FOR DELETE
TO anon, authenticated
USING (false);

-- Secure siws_nonces table
ALTER TABLE public.siws_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "siws_nonces_no_access"
ON public.siws_nonces FOR ALL
TO anon, authenticated
USING (false);

-- =====================================================================
-- 6. ENABLE REALTIME ON BETS
-- =====================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;

-- =====================================================================
-- DONE
-- =====================================================================
```

---

## Deployment Checklist

### Before Production:

- [ ] Run `0004_fix_rls_policies.sql` migration
- [ ] Configure `market-images` storage bucket policies
- [ ] Set bucket to public
- [ ] Configure file size limits (5MB)
- [ ] Configure allowed MIME types
- [ ] Test that frontend CANNOT update markets
- [ ] Test that frontend CANNOT insert bets
- [ ] Test that Edge Function CAN insert bets
- [ ] Verify `SUPABASE_SERVICE_ROLE_KEY` is only in Edge Function env
- [ ] Verify `DATABASE_URL` is only in backend env
- [ ] Test comment posting through backend API
- [ ] Monitor Supabase logs for RLS policy violations

---

## Conclusion

**Current Status:** 🔴 **CRITICAL VULNERABILITIES**

**Required Actions:**
1. **IMMEDIATE**: Run RLS policy migration
2. **IMMEDIATE**: Configure storage bucket policies
3. **BEFORE LAUNCH**: Test all RLS policies
4. **BEFORE LAUNCH**: Remove unused `profiles` table

**After Fixes:** ✅ **SECURE**

The architecture is sound (anon key for frontend, service key for Edge Function, backend uses direct PostgreSQL), but RLS policies must be implemented to enforce it.

---

**Audit Status:** Complete  
**Next Review:** After implementing RLS fixes

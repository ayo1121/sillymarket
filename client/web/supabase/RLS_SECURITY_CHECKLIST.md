# Supabase RLS Security Checklist

## Overview

This document provides a comprehensive security audit of all Supabase tables, their RLS policies, and verification procedures to ensure proper access control before mainnet launch.

## Critical Security Principles

1. **Bets table**: ONLY service role (edge function) can INSERT. Frontend is READ-ONLY.
2. **Markets table**: Anyone can INSERT (market creation), but UPDATE/DELETE should be restricted to creator or admin.
3. **Comments table**: Users can only insert/delete their own comments, not impersonate others.
4. **Users table**: Users can only update their own profile data.
5. **Notifications**: Only service role can INSERT. Users can only read/update their own.
6. **Claims**: Only service role can INSERT (indexed from blockchain).

## Table-by-Table Analysis

### 1. `bets` Table

**Purpose**: Index bet events from Solana blockchain via Helius webhook

**Intended Access**:
- SELECT: Everyone (anon, authenticated) ✅
- INSERT: Service role ONLY (edge function) ✅
- UPDATE: NOBODY ❌
- DELETE: NOBODY ❌

**Current RLS Policies**:
```sql
-- ✅ SECURE: Read access for everyone
"Bets are viewable by everyone" (SELECT, anon/authenticated)

-- ✅ SECURE: Only service role can insert
"Only service role can insert bets" (INSERT, service_role check)
```

**Security Status**: ✅ **SECURE**
- Frontend cannot insert fake bets
- Only edge function (with service role key) can write
- No UPDATE or DELETE policies = immutable data

**Gaps**: None

---

### 2. `markets` Table

**Purpose**: Store market metadata (question, description, image, etc.)

**Intended Access**:
- SELECT: Everyone ✅
- INSERT: Anyone (market creators) ✅
- UPDATE: Market creator OR admin only ⚠️
- DELETE: NOBODY (markets are permanent) ⚠️

**Current RLS Policies** (from migration 0002, 0014):
```sql
-- ✅ Read access
"Enable read access for all users" (SELECT, anon/authenticated)

-- ⚠️ TOO PERMISSIVE: Anyone can insert
"markets_insert_authenticated" (INSERT, anon/authenticated, WITH CHECK true)

-- ❌ CRITICAL: Anyone can update ANY market
"Enable update access for all users" (UPDATE, anon/authenticated, WITH CHECK true)
```

**Security Status**: ✅ **FIXED by migration 0018**
- UPDATE restricted to creator_wallet only (verified via JWT sub claim)
- DELETE explicitly denied for all users (markets are permanent)
- INSERT verifies creator_wallet matches authenticated wallet
- SELECT policy explicitly allows everyone to read markets

**Previous Gaps (NOW FIXED)**:
1. ✅ UPDATE policy now restricts to creator only
2. ✅ DELETE policy explicitly denies all users
3. ✅ INSERT verifies creator_wallet matches authenticated user

---

### 3. `comments` Table

**Purpose**: User comments on markets

**Intended Access**:
- SELECT: Everyone ✅
- INSERT: Authenticated users (with wallet verification) ⚠️
- UPDATE: NOBODY ❌
- DELETE: Comment owner only ✅

**Current RLS Policies** (from migrations 0001, 0014, 0017):
```sql
-- ✅ Read access
"comments_select_all" (SELECT, public)

-- ⚠️ TOO PERMISSIVE: Anon can insert without verification
"comments_insert_anon" (INSERT, anon, WITH CHECK true)
"comments_insert_authenticated" (INSERT, authenticated, WITH CHECK true)

-- Note: Old policy checked auth.uid() = user_id, but that's Supabase auth
-- Current schema uses wallet_pubkey, not user_id
```

**Security Status**: ✅ **FIXED by migration 0018**
- INSERT verifies user_id matches authenticated wallet (via JWT sub claim)
- UPDATE explicitly denied for all users (comments are immutable)
- DELETE restricted to comment owner only
- SELECT policy explicitly allows everyone to read comments

**Previous Gaps (NOW FIXED)**:
1. ✅ INSERT now verifies wallet ownership via JWT
2. ✅ Anon policy removed, replaced with verified wallet policy
3. ✅ UPDATE policy explicitly denies all users

---

### 4. `users` Table

**Purpose**: User profiles (pubkey → username mapping)

**Intended Access**:
- SELECT: Everyone ✅
- INSERT: Anyone (wallet connection) ✅
- UPDATE: User can only update their own profile ⚠️
- DELETE: NOBODY ❌

**Current RLS Policies** (from migration 0014):
```sql
-- ✅ Read access
"users_select_all" (SELECT, public)

-- ⚠️ Anon can insert any pubkey
"users_insert_all" (INSERT, public, WITH CHECK true)

-- ⚠️ Relies on JWT claim matching
"users_update_own" (UPDATE, public, 
  USING pubkey = current_setting('request.jwt.claims')::json->>'sub')
```

**Security Status**: ✅ **FIXED by migration 0018**
- INSERT verifies pubkey matches authenticated wallet (via JWT sub claim)
- UPDATE restricted to user's own profile only
- DELETE explicitly denied for all users (profiles are permanent)
- SELECT policy explicitly allows everyone to read user profiles

**Previous Gaps (NOW FIXED)**:
1. ✅ INSERT now verifies pubkey ownership via JWT
2. ✅ UPDATE policy explicitly verifies JWT claims
3. ⚠️ Username uniqueness still enforced at application level (not RLS)

---

### 5. `notifications` Table

**Purpose**: User notifications for market events

**Intended Access**:
- SELECT: User can only see their own ✅
- INSERT: Service role only ✅
- UPDATE: User can update their own (mark as read) ✅
- DELETE: Service role only ✅

**Current RLS Policies** (from migration 0010):
```sql
-- ✅ Users read their own
"notifications_select_own" (SELECT, authenticated, 
  USING user_pubkey = (SELECT pubkey FROM users WHERE id = auth.uid()))

-- ✅ Service role can insert
"notifications_insert_service" (INSERT, service_role)

-- ✅ Users update their own
"notifications_update_own" (UPDATE, authenticated, 
  USING user_pubkey = (SELECT pubkey FROM users WHERE id = auth.uid()))

-- ✅ Only service role can delete
"notifications_delete_service" (DELETE, service_role)
```

**Security Status**: ✅ **SECURE**
- Proper isolation: users can only see/update their own
- Only service role can create/delete notifications
- Relies on `users` table for pubkey lookup (assumes auth.uid() is valid)

**Gaps**: 
- Depends on `users` table integrity (if that's compromised, this is too)

---

### 6. `claims` Table

**Purpose**: Index claim events from Solana blockchain

**Intended Access**:
- SELECT: Everyone ✅
- INSERT: Service role only ✅
- UPDATE: NOBODY ❌
- DELETE: NOBODY ❌

**Current RLS Policies** (from migration 0013):
```sql
-- ✅ Read access
"Claims are viewable by everyone" (SELECT)

-- ✅ Service role only
"Only service role can insert claims" (INSERT, service_role check)
```

**Security Status**: ✅ **SECURE**
- Same pattern as `bets` table
- Immutable blockchain data indexed by edge function

**Gaps**: None

---

### 7. `frontend_events` Table (Analytics)

**Purpose**: Track frontend analytics events

**Intended Access**:
- SELECT: Service role only (analytics dashboard)
- INSERT: Anyone (for tracking)
- UPDATE: NOBODY
- DELETE: NOBODY

**Current RLS Policies**: ⚠️ **NOT REVIEWED** (need to check migration 0009)

**Security Status**: ⚠️ **UNKNOWN**
- Low risk (analytics data)
- Should verify no PII is exposed

---

## Critical Vulnerabilities Summary

### ✅ ALL CRITICAL VULNERABILITIES FIXED (Migration 0018)

1. **Markets UPDATE Policy**: ✅ **FIXED**
   - **Previous Issue**: Anyone could modify any market's metadata
   - **Fix Applied**: UPDATE restricted to creator_wallet only (verified via JWT)
   - **Migration**: 0018_rls_security_hardening.sql

2. **Comments INSERT Policy**: ✅ **FIXED**
   - **Previous Issue**: Users could impersonate others in comments
   - **Fix Applied**: INSERT verifies user_id matches JWT sub claim
   - **Migration**: 0018_rls_security_hardening.sql

3. **Users INSERT Policy**: ✅ **FIXED**
   - **Previous Issue**: Username squatting, profile spoofing
   - **Fix Applied**: INSERT verifies pubkey matches JWT sub claim
   - **Migration**: 0018_rls_security_hardening.sql

4. **Markets INSERT Policy**: ✅ **FIXED**
   - **Previous Issue**: creator_wallet field could be spoofed
   - **Fix Applied**: INSERT verifies creator_wallet matches JWT sub claim
   - **Migration**: 0018_rls_security_hardening.sql

---

## Verification Procedures

### Test 1: Verify Anon Cannot Insert Bets

```sql
-- Connect as anon user (using VITE_SUPABASE_PUBLISHABLE_KEY)
-- Try to insert a fake bet
INSERT INTO public.bets (
  market_pubkey, 
  bettor_pubkey, 
  outcome_index, 
  amount_sol, 
  amount_lamports, 
  tx_sig, 
  block_time
) VALUES (
  'FakeMarket123',
  'FakeBettor456',
  0,
  1.0,
  1000000000,
  'FakeTxSig789',
  NOW()
);

-- Expected: ERROR - new row violates row-level security policy
```

### Test 2: Verify Anon Cannot Modify Other Users' Markets

```sql
-- As anon user, try to update an existing market
UPDATE public.markets 
SET question = 'HACKED QUESTION'
WHERE market_pubkey = '<real_market_pubkey>';

-- Expected: ERROR - new row violates row-level security policy
-- Current: ❌ SUCCEEDS (vulnerability!)
```

### Test 3: Verify Service Role Can Insert Bets

```bash
# Using Supabase CLI with service role key
export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"

# Call edge function or use service role client
curl -X POST '<supabase_url>/rest/v1/bets' \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market_pubkey": "TestMarket",
    "bettor_pubkey": "TestBettor",
    "outcome_index": 0,
    "amount_sol": 1.0,
    "amount_lamports": 1000000000,
    "tx_sig": "TestTx123",
    "block_time": "2025-01-01T00:00:00Z"
  }'

# Expected: Success (201 Created)
```

### Test 4: Verify Users Cannot Update Others' Profiles

```sql
-- As authenticated user A, try to update user B's username
UPDATE public.users 
SET username = 'stolen_username'
WHERE pubkey = '<user_b_pubkey>';

-- Expected: ERROR - new row violates row-level security policy
-- Current: Depends on JWT validation (may be vulnerable)
```

### Test 5: Verify Comments Cannot Be Spoofed

```sql
-- As anon user, try to insert comment with someone else's pubkey
INSERT INTO public.comments (market_id, user_id, comment_text)
VALUES ('market123', '<victim_pubkey>', 'Fake comment from victim');

-- Expected: ERROR - wallet verification failed
-- Current: ❌ SUCCEEDS (vulnerability!)
```

---

## Recommended Testing Workflow

1. **Setup Test Environment**
   ```bash
   # Get anon key from .env.local
   export ANON_KEY="<VITE_SUPABASE_PUBLISHABLE_KEY>"
   
   # Get service role key (NEVER expose in frontend!)
   export SERVICE_KEY="<SUPABASE_SERVICE_ROLE_KEY>"
   ```

2. **Test with Supabase Client**
   ```typescript
   import { createClient } from '@supabase/supabase-js';
   
   // Anon client (what frontend uses)
   const anonClient = createClient(SUPABASE_URL, ANON_KEY);
   
   // Service client (what edge functions use)
   const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);
   
   // Try malicious operations with anonClient
   // Verify they fail with RLS errors
   ```

3. **Verify Edge Function Security**
   ```bash
   # Ensure edge function validates Helius webhook signature
   # Test with invalid signature - should reject
   curl -X POST '<edge_function_url>' \
     -H 'Content-Type: application/json' \
     -d '{"fake": "payload"}'
   
   # Expected: 401 Unauthorized or 400 Bad Request
   ```

4. **Check for Exposed Secrets**
   ```bash
   # Verify no service role keys in frontend code
   grep -r "SUPABASE_SERVICE_ROLE_KEY" client/web/src/
   
   # Expected: No results
   
   # Verify only publishable key is used
   grep -r "SUPABASE_PUBLISHABLE_KEY" client/web/src/
   
   # Expected: Only in client.ts
   ```

---

## Edge Function Security

### Helius Webhook Signature Verification

The `index_bet_event` edge function now validates all incoming webhooks from Helius using HMAC-SHA256 signature verification.

**How it works**:
1. Helius sends webhook with `helius-signature` header
2. Edge function computes HMAC-SHA256 of raw request body using `HELIUS_WEBHOOK_SECRET`
3. Computed signature is compared with header signature (constant-time comparison)
4. Request is rejected with 401 if signature is invalid or missing

**Testing**:
```bash
# Test 1: Missing signature (should reject)
curl -X POST '<edge_function_url>' \
  -H 'Content-Type: application/json' \
  -d '{"test": "payload"}'
# Expected: 401 Unauthorized

# Test 2: Invalid signature (should reject)
curl -X POST '<edge_function_url>' \
  -H 'Content-Type: application/json' \
  -H 'helius-signature: invalid_sig' \
  -d '{"test": "payload"}'
# Expected: 401 Unauthorized

# Test 3: Valid signature (should process)
# Requires actual Helius webhook payload and valid signature
```

**Rate Limiting**:
- Max 100 requests per minute per IP address
- In-memory rate limiter (resets on function cold start)
- Returns 429 Too Many Requests when exceeded
- All rate limit violations are logged

**Structured Logging**:
All requests are logged with:
- Timestamp (ISO 8601)
- Request ID (UUID)
- Client IP
- Transaction signature(s)
- Success/failure status
- Rejection reason (if applicable)

Example log format:
```
[bets-indexer] [2025-11-30T00:00:00.000Z] [uuid] SIGNATURE_VERIFIED
[bets-indexer] [2025-11-30T00:00:00.000Z] [uuid] INVALID_SIGNATURE ip=1.2.3.4
```

---

## Security Checklist for Mainnet

- [x] Fix markets UPDATE policy (restrict to creator) - **DONE (migration 0018)**
- [x] Fix comments INSERT policy (add wallet verification) - **DONE (migration 0018)**
- [x] Fix users INSERT policy (add ownership proof) - **DONE (migration 0018)**
- [x] Verify bets table is service-role-only for INSERT - **VERIFIED**
- [x] Verify claims table is service-role-only for INSERT - **VERIFIED**
- [x] Verify edge function validates Helius webhook signatures - **DONE**
- [ ] Test all RLS policies with anon client
- [ ] Verify no service role keys in frontend code
- [ ] Enable Supabase audit logging
- [ ] Set up monitoring for suspicious INSERT patterns
- [ ] Document incident response procedures

---

## Additional Security Recommendations

1. **Enable Supabase Audit Logs**: Track all database operations for forensics
2. **Rate Limiting**: Add rate limits to prevent spam (comments, market creation)
3. **Content Moderation**: Add profanity filters for user-generated content
4. **Webhook Signature Validation**: Ensure edge function verifies Helius signatures
5. **Regular Security Audits**: Review RLS policies quarterly
6. **Monitoring**: Alert on unusual patterns (mass updates, failed RLS checks)
7. **Backup Strategy**: Regular backups of critical tables (markets, bets, claims)

---

## Notes

- **Service Role Key**: NEVER expose in frontend. Only use in edge functions.
- **Anon Key**: Safe to expose. RLS policies protect against abuse.
- **JWT Claims**: Verify wallet signatures before trusting JWT 'sub' claim.
- **Realtime Subscriptions**: Ensure RLS applies to realtime as well as REST API.

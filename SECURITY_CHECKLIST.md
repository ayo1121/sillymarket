# Final Security Hardening Checklist - Pre-Production

**Last Updated:** 2025-11-22  
**Purpose:** Actionable checklist before mainnet deployment  
**Status Legend:** ✅ Satisfied | ⚠️ Requires Changes | 🔴 Critical

---

## On-Chain / Anchor Program

### 1. Program Deployment

- [ ] **Deploy to mainnet-beta with verified build**
  - **Status:** ⚠️ Requires deployment
  - **Action:** Run `anchor build --verifiable` and deploy to mainnet
  - **File:** `programs/yesno_markets/`
  - **Command:** `anchor deploy --provider.cluster mainnet`

- [ ] **Update program ID in all configs**
  - **Status:** ⚠️ Requires update
  - **Action:** Update `declare_id!()` in `programs/yesno_markets/src/lib.rs` with mainnet program ID
  - **Files:** 
    - `programs/yesno_markets/src/lib.rs:10`
    - `Anchor.toml`
    - `client/web/.env.local` (VITE_PROGRAM_ID)

- [ ] **Verify program authority is secure**
  - **Status:** ⚠️ Requires verification
  - **Action:** Ensure program upgrade authority is a multisig or hardware wallet
  - **Command:** `solana program show <PROGRAM_ID>`

### 2. Configuration Account

- [ ] **Initialize config with production values**
  - **Status:** ⚠️ Requires initialization
  - **Action:** Call `initialize_config` with production parameters
  - **Parameters:**
    - `authority`: Secure multisig wallet
    - `fee_wallet`: Treasury wallet
    - `min_bet_lamports`: 10_000_000 (0.01 SOL)
    - `max_bet_lamports`: 100_000_000_000_000 (100k SOL)
    - `admin_pre_cutoff`: false (disable admin early resolution)

- [ ] **Verify config authority is multisig**
  - **Status:** ⚠️ Requires setup
  - **Action:** Use Squads multisig for config authority
  - **Recommendation:** 3-of-5 multisig with team members

### 3. Security Validations

- [ ] **All arithmetic uses checked operations**
  - **Status:** ✅ Satisfied
  - **Verified:** All `checked_add()`, `checked_sub()`, `checked_mul()` used
  - **File:** `programs/yesno_markets/src/lib.rs`

- [ ] **Authorization checks on all instructions**
  - **Status:** ✅ Satisfied
  - **Verified:** 
    - `resolve`: Checks creator or authority
    - `claim_winnings`: Checks position owner
    - `set_authority`: Checks current authority

- [ ] **State validation prevents double-actions**
  - **Status:** ✅ Satisfied
  - **Verified:**
    - `place_bet`: Checks `state == STATE_ACTIVE`
    - `resolve`: Checks `state == STATE_ACTIVE`
    - `claim_winnings`: Checks `claimed == false`

- [ ] **Input validation on all parameters**
  - **Status:** ✅ Satisfied
  - **Verified:**
    - Cutoff time: `>= now + MIN_CUTOFF_SECS`
    - Bet amount: `>= min_bet && <= max_bet`
    - Outcome count: `<= MAX_ANSWERS`

### 4. Testing

- [ ] **Run full test suite on devnet**
  - **Status:** ⚠️ Requires execution
  - **Action:** Run `anchor test` with all scenarios
  - **File:** `tests/` directory

- [ ] **Run adversarial tests**
  - **Status:** ⚠️ Requires implementation
  - **Action:** Implement and run tests from `docs/attack_simulation_tests.md`
  - **File:** Create `programs/yesno_markets/tests/adversarial.rs`

- [ ] **Test with real mainnet conditions**
  - **Status:** ⚠️ Requires testing
  - **Action:** Deploy to devnet, test with realistic market scenarios
  - **Scenarios:** Large bets, multiple users, edge timing

---

## Backend / API

### 1. Environment Variables

- [ ] **Generate strong SESSION_SECRET**
  - **Status:** 🔴 Critical - Default is "dev-secret"
  - **Action:** Generate 32+ character random string
  - **Command:** `openssl rand -base64 32`
  - **File:** Railway environment variables
  - **Reference:** `docs/config_deployment_audit.md`

- [ ] **Set NODE_ENV=production**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set in Railway environment variables
  - **Impact:** Enables secure cookies (SameSite=None; Secure)

- [ ] **Configure APP_ORIGIN with all frontend URLs**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set comma-separated list of allowed origins
  - **Example:** `https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app`
  - **File:** Railway environment variables

- [ ] **Set DATABASE_URL with production Supabase**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Get connection string from Supabase dashboard
  - **File:** Railway environment variables

### 2. Rate Limiting

- [ ] **Implement rate limiting on auth endpoints**
  - **Status:** 🔴 Critical - Not implemented
  - **Action:** Add `express-rate-limit` middleware
  - **File:** `server/src/index.ts`
  - **Code:** See `docs/backend_security_audit.md` Issue #1
  - **Endpoints:** `/auth/siws/start`, `/auth/siws/finish`
  - **Limit:** 10 requests per 15 minutes

- [ ] **Implement rate limiting on comment endpoint**
  - **Status:** 🔴 Critical - Not implemented
  - **Action:** Add rate limiter to `/comments` POST
  - **Limit:** 5 comments per minute per user

- [ ] **Implement general API rate limiting**
  - **Status:** ⚠️ Recommended
  - **Action:** Add global rate limiter
  - **Limit:** 100 requests per minute per IP

### 3. Input Validation

- [ ] **Validate pubkey format**
  - **Status:** ⚠️ Requires strengthening
  - **Action:** Add base58 format validation
  - **File:** `server/src/index.ts:149-157`
  - **Code:** See `docs/backend_security_audit.md` Issue #2

- [ ] **Add comment length limit**
  - **Status:** ⚠️ Requires implementation
  - **Action:** Add max 1000 character limit
  - **File:** `server/src/index.ts:253`
  - **Code:** See `docs/backend_security_audit.md` Issue #3

- [ ] **Validate all Zod schemas**
  - **Status:** ✅ Satisfied
  - **Verified:** All endpoints use Zod validation

### 4. CORS Configuration

- [ ] **Harden CORS for production**
  - **Status:** ⚠️ Requires update
  - **Action:** Reject requests with no origin in production
  - **File:** `server/src/index.ts:127-141`
  - **Code:** See `docs/backend_security_audit.md` Issue #4

- [ ] **Verify CORS credentials enabled**
  - **Status:** ✅ Satisfied
  - **Verified:** `credentials: true` set

### 5. Cookie Security

- [ ] **Verify httpOnly flag**
  - **Status:** ✅ Satisfied
  - **Verified:** `httpOnly: true` in `setSession()`

- [ ] **Verify SameSite=None in production**
  - **Status:** ✅ Satisfied
  - **Verified:** `sameSite: isProduction ? "none" : "lax"`

- [ ] **Verify Secure flag in production**
  - **Status:** ✅ Satisfied
  - **Verified:** `secure: isProduction`

### 6. JWT Security

- [ ] **Explicitly restrict JWT algorithm**
  - **Status:** ⚠️ Requires update
  - **Action:** Add `algorithms: ['HS256']` to `jwt.verify()`
  - **File:** `server/src/index.ts:120`
  - **Code:** See `docs/backend_security_audit.md` Issue #7

- [ ] **Verify JWT expiration**
  - **Status:** ✅ Satisfied
  - **Verified:** `expiresIn: "14d"` set

### 7. Error Handling

- [ ] **Sanitize error messages**
  - **Status:** ⚠️ Requires implementation
  - **Action:** Implement error sanitization
  - **File:** Create `server/src/lib/errorHandling.ts`
  - **Code:** See `docs/backend_security_audit.md` Issue #5

- [ ] **Remove sensitive data from logs**
  - **Status:** ⚠️ Requires review
  - **Action:** Audit all `console.log()` statements
  - **File:** `server/src/index.ts`
  - **Code:** See `docs/backend_security_audit.md` Issue #5

### 8. Database Security

- [ ] **Use parameterized queries**
  - **Status:** ✅ Satisfied
  - **Verified:** All queries use `$1`, `$2` placeholders

- [ ] **Implement nonce cleanup**
  - **Status:** ⚠️ Requires implementation
  - **Action:** Add cron job to delete expired nonces
  - **File:** `server/src/index.ts`
  - **Code:** See `docs/backend_security_audit.md` Issue #6

### 9. Security Headers

- [ ] **Add Helmet middleware**
  - **Status:** ⚠️ Recommended
  - **Action:** Install and configure `helmet`
  - **File:** `server/src/index.ts`
  - **Command:** `npm install helmet`

### 10. Monitoring

- [ ] **Add request ID tracking**
  - **Status:** ⚠️ Recommended
  - **Action:** Add request ID middleware
  - **File:** `server/src/index.ts`

- [ ] **Set up error tracking (Sentry)**
  - **Status:** ⚠️ Recommended
  - **Action:** Integrate Sentry for error monitoring

---

## Frontend / Client

### 1. Environment Variables

- [ ] **Set VITE_API_URL to production backend**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set to Railway URL in Vercel
  - **Example:** `https://your-app.up.railway.app`
  - **File:** Vercel environment variables

- [ ] **Set VITE_RPC_URL to mainnet RPC**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Use Helius or QuickNode mainnet RPC
  - **Example:** `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
  - **File:** Vercel environment variables

- [ ] **Set VITE_PROGRAM_ID to mainnet program**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set to deployed mainnet program ID
  - **File:** Vercel environment variables

- [ ] **Disable debug features**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set `VITE_DEBUG_DOCK=0`
  - **File:** Vercel environment variables

### 2. Error Handling

- [ ] **Implement error sanitization**
  - **Status:** ⚠️ Requires implementation
  - **Action:** Create `errorHandling.ts` utility
  - **File:** Create `client/web/src/lib/errorHandling.ts`
  - **Code:** See `docs/frontend_security_audit.md` Issue #1

- [ ] **Implement safe API client**
  - **Status:** ⚠️ Requires implementation
  - **Action:** Create centralized API client
  - **File:** Create `client/web/src/lib/apiClient.ts`
  - **Code:** See `docs/frontend_security_audit.md` Issue #3

### 3. XSS Protection

- [ ] **Verify React JSX auto-escaping**
  - **Status:** ✅ Satisfied
  - **Verified:** All user content rendered via JSX (auto-escaped)

- [ ] **Review dangerouslySetInnerHTML usage**
  - **Status:** ✅ Satisfied
  - **Verified:** Only used in `chart.tsx` for CSS (safe)

### 4. Authorization UI

- [ ] **Document UI-only authorization checks**
  - **Status:** ⚠️ Requires documentation
  - **Action:** Add comments clarifying on-chain enforcement
  - **File:** `client/web/src/pages/MarketDetails.tsx:576-593`
  - **Code:** See `docs/frontend_security_audit.md` Issue #2

### 5. Build Verification

- [ ] **Verify no secrets in build**
  - **Status:** ⚠️ Requires verification
  - **Action:** Run `npm run build` and inspect bundle
  - **Command:** `grep -r "SECRET\|PASSWORD" dist/`

- [ ] **Test production build locally**
  - **Status:** ⚠️ Requires testing
  - **Action:** Run `npm run build && npm run preview`

---

## Supabase / Database

### 1. RLS Policies

- [ ] **Run RLS policy migration**
  - **Status:** 🔴 Critical - Policies are overly permissive
  - **Action:** Run `0004_fix_rls_policies.sql` migration
  - **File:** See `docs/supabase_security_audit.md`
  - **SQL:** Complete migration provided in audit

- [ ] **Verify markets table RLS**
  - **Status:** 🔴 Critical - Allows anonymous INSERT/UPDATE
  - **Action:** Apply `markets_no_update` and `markets_insert_once` policies
  - **Impact:** Prevents market metadata manipulation

- [ ] **Verify bets table RLS**
  - **Status:** 🔴 Critical - No RLS enabled
  - **Action:** Enable RLS and apply `bets_insert_service_only` policy
  - **Impact:** Prevents fake bet injection

- [ ] **Disable RLS on comments table**
  - **Status:** ⚠️ Requires change
  - **Action:** Disable RLS (backend handles authorization)
  - **Reason:** App uses wallet auth, not Supabase Auth

- [ ] **Drop unused profiles table**
  - **Status:** ⚠️ Recommended
  - **Action:** Run `DROP TABLE public.profiles CASCADE;`
  - **Reason:** Not used by application

- [ ] **Secure backend tables (users, siws_nonces)**
  - **Status:** ⚠️ Requires RLS
  - **Action:** Enable RLS and block frontend access
  - **Impact:** Prevents nonce manipulation

### 2. Storage Bucket

- [ ] **Configure market-images bucket policies**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set up storage policies in Supabase dashboard
  - **Policies:**
    - Allow INSERT for anon/authenticated
    - Allow SELECT for all (public bucket)
    - Deny UPDATE and DELETE from frontend

- [ ] **Set bucket to public**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Enable public access in Supabase dashboard

- [ ] **Configure file size limits**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set 5MB max file size
  - **Location:** Supabase dashboard → Storage → Settings

- [ ] **Configure allowed MIME types**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Allow only image/jpeg, image/png, image/gif

### 3. Database Connection

- [ ] **Verify connection pooling**
  - **Status:** ✅ Satisfied
  - **Verified:** Backend uses `pg.Pool`

- [ ] **Test connection from Railway**
  - **Status:** ⚠️ Requires testing
  - **Action:** Deploy backend and verify database connectivity

### 4. Secrets Management

- [ ] **Verify service key not in frontend**
  - **Status:** ✅ Satisfied
  - **Verified:** Only anon key in frontend

- [ ] **Verify service key only in Edge Function**
  - **Status:** ✅ Satisfied
  - **Verified:** `SUPABASE_SERVICE_ROLE_KEY` only in Edge Function env

---

## Infrastructure / Deployment

### 1. Vercel (Frontend)

- [ ] **Set all environment variables**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Add all VITE_* variables in Vercel dashboard
  - **Reference:** `docs/config_deployment_audit.md`

- [ ] **Configure custom domain**
  - **Status:** ⚠️ Requires setup
  - **Action:** Add custom domain in Vercel settings
  - **Verify:** HTTPS enabled (automatic)

- [ ] **Enable automatic deployments**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Connect GitHub repo to Vercel

- [ ] **Test production deployment**
  - **Status:** ⚠️ Requires testing
  - **Action:** Deploy and test all features

### 2. Railway (Backend)

- [ ] **Set all environment variables**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Add all variables in Railway dashboard
  - **Variables:** NODE_ENV, APP_ORIGIN, DATABASE_URL, SESSION_SECRET
  - **Reference:** `docs/config_deployment_audit.md`

- [ ] **Configure health checks**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Set health check endpoint to `/health`

- [ ] **Enable auto-deploy from GitHub**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Connect GitHub repo to Railway

- [ ] **Configure custom domain (optional)**
  - **Status:** ⚠️ Optional
  - **Action:** Add custom domain for API

- [ ] **Test production deployment**
  - **Status:** ⚠️ Requires testing
  - **Action:** Deploy and test all endpoints

### 3. RPC Provider

- [ ] **Set up mainnet RPC (Helius/QuickNode)**
  - **Status:** ⚠️ Requires setup
  - **Action:** Create account and get API key
  - **Recommendation:** Helius for Solana-specific features

- [ ] **Configure rate limits**
  - **Status:** ⚠️ Requires configuration
  - **Action:** Monitor usage and set appropriate tier

- [ ] **Set up monitoring/alerts**
  - **Status:** ⚠️ Recommended
  - **Action:** Enable RPC usage alerts

### 4. Helius Webhook (Bet Indexing)

- [ ] **Configure webhook for BetPlaced events**
  - **Status:** ⚠️ Requires setup
  - **Action:** Set up webhook in Helius dashboard
  - **Endpoint:** Supabase Edge Function URL
  - **Events:** Program logs for BetPlaced

- [ ] **Verify Edge Function deployed**
  - **Status:** ⚠️ Requires deployment
  - **Action:** Deploy `supabase/functions/index_bet_event/`
  - **Command:** `supabase functions deploy index_bet_event`

- [ ] **Test webhook with devnet**
  - **Status:** ⚠️ Requires testing
  - **Action:** Place test bet and verify indexing

### 5. Monitoring & Logging

- [ ] **Set up uptime monitoring**
  - **Status:** ⚠️ Recommended
  - **Action:** Use UptimeRobot or similar
  - **Endpoints:** Frontend, backend, health check

- [ ] **Set up error tracking**
  - **Status:** ⚠️ Recommended
  - **Action:** Integrate Sentry for both frontend and backend

- [ ] **Set up analytics**
  - **Status:** ⚠️ Optional
  - **Action:** Add Google Analytics or Plausible

### 6. DNS & SSL

- [ ] **Configure DNS records**
  - **Status:** ⚠️ Requires setup
  - **Action:** Point domain to Vercel
  - **Records:** A/CNAME records

- [ ] **Verify SSL certificates**
  - **Status:** ⚠️ Requires verification
  - **Action:** Vercel auto-provisions SSL
  - **Verify:** HTTPS works on custom domain

### 7. Backup & Recovery

- [ ] **Set up database backups**
  - **Status:** ⚠️ Recommended
  - **Action:** Enable Supabase automatic backups
  - **Location:** Supabase dashboard → Database → Backups

- [ ] **Document recovery procedures**
  - **Status:** ⚠️ Recommended
  - **Action:** Create runbook for disaster recovery

---

## Pre-Launch Testing

### 1. End-to-End Testing

- [ ] **Test complete user flow**
  - **Status:** ⚠️ Requires testing
  - **Flow:**
    1. Connect wallet
    2. Create market
    3. Place bet
    4. Resolve market
    5. Claim winnings

- [ ] **Test with multiple wallets**
  - **Status:** ⚠️ Requires testing
  - **Action:** Test with different wallet providers (Phantom, Solflare, etc.)

- [ ] **Test cross-origin cookies**
  - **Status:** ⚠️ Requires testing
  - **Action:** Verify authentication works from Vercel to Railway

### 2. Security Testing

- [ ] **Run adversarial tests**
  - **Status:** ⚠️ Requires execution
  - **Action:** Execute tests from `docs/attack_simulation_tests.md`

- [ ] **Penetration testing**
  - **Status:** ⚠️ Recommended
  - **Action:** Hire security firm or run automated scans

- [ ] **Audit smart contract**
  - **Status:** ⚠️ Recommended
  - **Action:** Get professional audit from OtterSec, Neodyme, etc.

### 3. Performance Testing

- [ ] **Load test backend API**
  - **Status:** ⚠️ Recommended
  - **Action:** Use k6 or Artillery to test rate limits

- [ ] **Test with high transaction volume**
  - **Status:** ⚠️ Recommended
  - **Action:** Simulate multiple concurrent bets

### 4. Monitoring Setup

- [ ] **Set up logging**
  - **Status:** ⚠️ Requires setup
  - **Action:** Configure Railway logs retention

- [ ] **Set up alerts**
  - **Status:** ⚠️ Recommended
  - **Action:** Alert on errors, high latency, downtime

---

## Documentation

- [ ] **Update README with production URLs**
  - **Status:** ⚠️ Requires update
  - **File:** `README.md`

- [ ] **Document deployment process**
  - **Status:** ⚠️ Requires documentation
  - **File:** `DEPLOYMENT.md`

- [ ] **Create incident response plan**
  - **Status:** ⚠️ Recommended
  - **Action:** Document procedures for security incidents

- [ ] **Create user documentation**
  - **Status:** ⚠️ Recommended
  - **Action:** How to use the platform, FAQ

---

## Final Verification

- [ ] **Review all security audit reports**
  - **Files:**
    - `docs/backend_security_audit.md`
    - `docs/frontend_security_audit.md`
    - `docs/supabase_security_audit.md`
    - `docs/config_deployment_audit.md`
    - `docs/attack_simulation_tests.md`

- [ ] **Verify all critical issues resolved**
  - **Status:** ⚠️ Requires verification
  - **Action:** Go through each 🔴 Critical item above

- [ ] **Get team sign-off**
  - **Status:** ⚠️ Requires approval
  - **Action:** Review checklist with team

- [ ] **Prepare rollback plan**
  - **Status:** ⚠️ Recommended
  - **Action:** Document how to revert if issues arise

---

## Summary

**Total Items:** 100+  
**Critical (🔴):** 5  
**Requires Changes (⚠️):** 70+  
**Satisfied (✅):** 25+

**Critical Items (Must Fix Before Launch):**
1. Generate strong SESSION_SECRET
2. Implement rate limiting on auth endpoints
3. Run Supabase RLS policy migration
4. Fix markets table RLS (prevent anonymous updates)
5. Fix bets table RLS (enable and restrict to service role)

**High Priority:**
- Configure all production environment variables
- Deploy and test on mainnet
- Implement error sanitization
- Test end-to-end user flows
- Set up monitoring and alerts

**Recommended:**
- Professional smart contract audit
- Penetration testing
- Error tracking (Sentry)
- Uptime monitoring

---

**Next Steps:**
1. Address all 🔴 Critical items
2. Work through ⚠️ items systematically
3. Test thoroughly on devnet/testnet
4. Deploy to production
5. Monitor closely for first 48 hours

**Estimated Time:** 2-3 days for critical items, 1-2 weeks for complete checklist

# YesNo Markets - Mainnet Security Checklist

**Purpose**: Final security verification before deploying to Solana mainnet.

**Last Updated**: 2025-11-30

---

## ✅ Pre-Deployment Checklist

### 1. Anchor Program Security

**Run Locally**:
```bash
cd yesno_markets

# Format check
cargo fmt --all -- --check

# Linting (strict)
cargo clippy --all-targets --all-features -- -D warnings

# Build
anchor build

# Unit tests
cd programs/yesno_markets && cargo test --lib

# Dependency audit
cargo audit
```

**Manual Verification**:
- [ ] Config authority is set to correct multisig/admin wallet
- [ ] Platform fee wallet is correct (verify in `initialize_config`)
- [ ] MIN_BET and MAX_BET values are reasonable (check `lib.rs` constants)
- [ ] Fee percentages are correct (PLATFORM_FEE_BPS, CREATOR_FEE_BPS)
- [ ] Program ID in `Anchor.toml` matches deployed program

---

### 2. Frontend Security

**Run Locally**:
```bash
cd client/web

# TypeScript check
npx tsc --noEmit

# Security linting
npm run lint:security

# All linting
npm run lint

# Tests (45 tests)
npm test -- --run

# Production build
npm run build
```

**Manual UI Testing** (on Devnet first):
- [ ] Connect wallet successfully
- [ ] Create a test market (verify on-chain)
- [ ] Place a bet (YES and NO)
- [ ] Resolve market as creator
- [ ] Claim winnings
- [ ] Verify no console errors in browser DevTools

---

### 3. Supabase Security

**Apply Migration**:
```bash
cd client/web
npx supabase db push
```

**Verify RLS Policies**:
```sql
-- Run in Supabase SQL Editor
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE tablename IN ('markets', 'comments', 'users')
ORDER BY tablename, cmd;

-- Expected: 12 policies (4 per table: SELECT, INSERT, UPDATE, DELETE)
```

**Test RLS Policies**:
```sql
-- Test 1: Anon cannot update other's market
SET ROLE anon;
SET request.jwt.claims = '{"sub": "FakeWallet123"}';
UPDATE markets SET question = 'HACKED' WHERE market_pubkey = '<real_market>';
-- Expected: ERROR - row-level security policy violation

-- Test 2: Anon cannot insert comment with fake user_id
INSERT INTO comments (market_id, user_id, comment_text)
VALUES ('market123', 'VictimWallet456', 'Fake comment');
-- Expected: ERROR - row-level security policy violation
```

**Edge Function Security**:
- [ ] `HELIUS_WEBHOOK_SECRET` configured in Supabase secrets
- [ ] Edge function deployed: `npx supabase functions deploy index_bet_event`
- [ ] Test with invalid signature (should return 401)
- [ ] Verify Helius webhook URL matches edge function URL

**Manual Checks**:
- [ ] No service role keys in frontend code (`grep -r "SERVICE_ROLE" client/web/src/`)
- [ ] Supabase publishable key (not service role) in `.env`
- [ ] RLS enabled on all tables (`bets`, `markets`, `comments`, `users`, `claims`, `notifications`)

---

### 4. CI Status

**GitHub Actions**:
- [ ] Security CI Gate is **GREEN** on the commit you're deploying
- [ ] All 4 jobs passed: Anchor Security, Frontend Security, Supabase Security, Config Security
- [ ] No warnings in advisory checks (cargo audit, npm audit)

**Verify**:
```bash
# Check latest commit status
git log -1 --oneline
# Go to GitHub Actions and verify workflow passed for this commit
```

---

### 5. Environment Configuration

**Production Environment Variables**:
```bash
# Frontend (.env.production)
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable_key>  # NOT service role!
VITE_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
VITE_PROGRAM_ID=<deployed_program_id>

# Supabase Secrets (via Supabase dashboard)
HELIUS_WEBHOOK_SECRET=<secret>
HELIUS_API_KEY=<api_key>
YESNO_PROGRAM_ID=<deployed_program_id>
```

**Verify**:
- [ ] No `.env` files committed to repo
- [ ] `.env.example` exists with placeholder values
- [ ] Production RPC endpoint is reliable (Helius, QuickNode, or Alchemy)

---

### 6. Deployment Steps

**Anchor Program**:
```bash
# 1. Build for mainnet
anchor build

# 2. Deploy to mainnet
anchor deploy --provider.cluster mainnet

# 3. Verify deployment
solana program show <program_id> --url mainnet-beta

# 4. Initialize config (ONE TIME ONLY)
anchor run initialize-mainnet-config
```

**Frontend**:
```bash
# 1. Build for production
npm run build

# 2. Deploy to Vercel/Netlify
vercel --prod
# OR
netlify deploy --prod
```

**Supabase**:
```bash
# 1. Apply migrations to production
npx supabase db push --db-url <production_url>

# 2. Deploy edge function
npx supabase functions deploy index_bet_event --project-ref <project_ref>

# 3. Configure Helius webhook
# Go to Helius dashboard → Webhooks → Create webhook
# URL: https://<project-ref>.supabase.co/functions/v1/index_bet_event
# Secret: <HELIUS_WEBHOOK_SECRET>
```

---

## 📊 Post-Deploy Monitoring (First 24 Hours)

**Critical Metrics to Watch**:

1. **Solana Program**:
   - [ ] Monitor transaction success rate (should be >95%)
   - [ ] Check for failed transactions (investigate errors)
   - [ ] Verify fees are being collected correctly

2. **Supabase**:
   - [ ] Monitor RLS policy violations (should be 0 or very low)
   - [ ] Check edge function logs for `INVALID_SIGNATURE` events
   - [ ] Verify bets are being indexed (check `bets` table)

3. **Frontend**:
   - [ ] Monitor Sentry/error tracking for JavaScript errors
   - [ ] Check Vercel/Netlify logs for build/deployment issues
   - [ ] Verify wallet connections work (Phantom, Solflare)

4. **Edge Function**:
   - [ ] Check Supabase logs for edge function errors
   - [ ] Monitor rate limit violations (`RATE_LIMIT_EXCEEDED`)
   - [ ] Verify webhook signature verification is working

5. **User Experience**:
   - [ ] Test full flow: create market → bet → resolve → claim
   - [ ] Verify UI displays correct probabilities and pools
   - [ ] Check comments and user profiles load correctly

---

## 🚨 Rollback Plan

**If Critical Issues Found**:

1. **Pause Frontend**: Set maintenance mode or revert deployment
2. **Disable Webhooks**: Pause Helius webhook to stop bet indexing
3. **Investigate**: Check logs (Solana, Supabase, Vercel)
4. **Fix**: Apply hotfix and re-deploy
5. **Verify**: Test on devnet first, then re-deploy to mainnet

**Emergency Contacts**:
- Solana RPC: <rpc_provider_support>
- Supabase: <supabase_support>
- Helius: <helius_support>

---

## ✅ Final Sign-Off

Before deploying to mainnet, confirm:

- [ ] All automated tests pass (CI green)
- [ ] Manual testing completed on devnet
- [ ] RLS policies verified
- [ ] Edge function security verified
- [ ] Environment variables configured
- [ ] Monitoring and alerts set up
- [ ] Rollback plan documented
- [ ] Team notified of deployment

**Deployment Approved By**: _______________  
**Date**: _______________  
**Commit SHA**: _______________

---

**🚀 Ready for Mainnet!**

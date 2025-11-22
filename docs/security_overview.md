# Security Architecture Overview - sillymarket

**Version:** 1.0  
**Date:** 2025-11-22  
**Status:** Production Deployment

---

## Executive Summary

sillymarket is a Solana-based prediction market platform with three primary components:
1. **On-chain Program** (Anchor/Rust) - Handles betting, market resolution, and fund custody
2. **Backend API** (Node.js/TypeScript) - Provides wallet authentication and social features
3. **Frontend** (React/Vite) - User interface for wallet interaction and market participation

**Critical Assets:**
- User funds (SOL) held in on-chain market PDAs
- Platform fees collected in designated wallets
- User authentication sessions (JWT cookies)
- Market metadata and user-generated content (Supabase)

---

## 1. Architecture

### 1.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vercel)                        │
│                     client/web/ (React/Vite)                     │
│  - Wallet adapter (Phantom, Solflare)                           │
│  - Solana transaction signing                                    │
│  - HTTP API client                                               │
└───────────┬─────────────────────────────────┬───────────────────┘
            │                                 │
            │ HTTPS                           │ RPC (WebSocket)
            │                                 │
┌───────────▼─────────────────┐   ┌──────────▼──────────────────┐
│   BACKEND API (Railway)     │   │   SOLANA DEVNET/MAINNET     │
│   server/ (Express/TS)      │   │   (External RPC Provider)    │
│                             │   │                              │
│  Routes:                    │   │  Program:                    │
│  - POST /auth/siws/start    │   │  - programs/yesno_markets/   │
│  - POST /auth/siws/finish   │   │                              │
│  - POST /auth/logout        │   │  Instructions:               │
│  - GET  /me                 │   │  - initialize                │
│  - POST /user/username      │   │  - create_market             │
│  - GET  /comments           │   │  - place_bet                 │
│  - POST /comments           │   │  - resolve                   │
│  - GET  /health             │   │  - claim_winnings            │
│                             │   │  - void_expired              │
│  Auth: JWT cookies (SIWS)   │   │  - close_position            │
│  CORS: Multi-origin         │   │  - set_fee_wallet            │
└──────────┬──────────────────┘   │  - set_authority             │
           │                      └──────────────────────────────┘
           │ SQL
           │
┌──────────▼──────────────────┐
│   SUPABASE (PostgreSQL)     │
│   (External Service)        │
│                             │
│  Tables (Backend-managed):  │
│  - users                    │
│  - siws_nonces              │
│  - comments                 │
│                             │
│  Tables (Supabase-managed): │
│  - markets (metadata)       │
│  - storage.objects (images) │
└─────────────────────────────┘
```

### 1.2 Entrypoints

#### On-Chain Instructions (programs/yesno_markets/src/lib.rs)

| Instruction | Signer Required | Authority Check | Description |
|-------------|----------------|-----------------|-------------|
| `initialize` | Authority | First-time only | Initialize global config PDA |
| `set_fee_wallet` | Config authority | `config.authority` | Update platform fee wallet |
| `set_authority` | Current authority or fee_wallet | `config.authority` or `config.fee_wallet` | Transfer admin control |
| `create_market` | Creator | None (pays fee) | Create new prediction market |
| `place_bet` | Bettor | None | Place bet on market outcome |
| `resolve` | Creator or Admin | `market.creator` or `config.authority` | Resolve market winner |
| `void_expired` | Anyone | Time-based (7 days post-cutoff) | Auto-void abandoned markets |
| `claim_winnings` | Position owner | `position.owner` | Claim winnings after resolution |
| `close_position` | Position owner | `position.owner` + `position.claimed` | Reclaim rent after claiming |

#### Backend HTTP Routes (server/src/index.ts)

| Route | Method | Auth Required | Description |
|-------|--------|---------------|-------------|
| `/health` | GET | No | Health check |
| `/me` | GET | No (optional) | Get current user session |
| `/auth/siws/start` | POST | No | Initiate Sign-In With Solana |
| `/auth/siws/finish` | POST | No | Complete SIWS with signature verification |
| `/auth/logout` | POST | No | Clear session cookie |
| `/user/username` | POST | Yes (JWT) | Set/update username |
| `/comments` | GET | No | Fetch comments for market |
| `/comments` | POST | Yes (JWT) | Post comment on market |

#### Client-Side Actions (client/web/src/solana/)

| File | Key Functions | Security Relevance |
|------|---------------|-------------------|
| `actions.ts` | Transaction builders | Constructs unsigned transactions |
| `tx.ts` | Transaction submission | Signs and sends to RPC |
| `wallet.tsx` | Wallet connection | Manages wallet adapter state |
| `pdas.ts` | PDA derivation | Derives program addresses |
| `read.ts` | Account fetching | Reads on-chain state |

### 1.3 External Services

| Service | Purpose | Trust Level | Data Exposed |
|---------|---------|-------------|--------------|
| **Solana RPC** (api.devnet.solana.com) | Blockchain access | High (public network) | All on-chain data (public) |
| **Supabase PostgreSQL** | Database | Medium (managed service) | User profiles, comments, market metadata |
| **Supabase Storage** | Image hosting | Medium (managed service) | Market images (public URLs) |
| **Wallet Extensions** (Phantom, Solflare) | Transaction signing | High (user-controlled) | Private keys (never leaves wallet) |

---

## 2. Trust Boundaries

### 2.1 Critical Trust Boundaries

```
┌────────────────────────────────────────────────────────────┐
│                    UNTRUSTED ZONE                          │
│  - User browsers                                           │
│  - Wallet extensions (user-controlled)                     │
│  - Public internet                                         │
└─────────────────┬──────────────────────────────────────────┘
                  │
         ┌────────▼─────────┐
         │   TLS/HTTPS      │  ← Encryption boundary
         └────────┬─────────┘
                  │
┌─────────────────▼──────────────────────────────────────────┐
│              SEMI-TRUSTED ZONE                             │
│  - Backend API (Railway)                                   │
│    • JWT verification                                      │
│    • CORS enforcement                                      │
│    • Input validation                                      │
│  - Supabase (managed PostgreSQL)                           │
│    • Row-level security (if enabled)                       │
└─────────────────┬──────────────────────────────────────────┘
                  │
         ┌────────▼─────────┐
         │  Solana Program  │  ← Strongest trust boundary
         │  (On-chain)      │     (Immutable, auditable)
         └──────────────────┘
                  │
┌─────────────────▼──────────────────────────────────────────┐
│                  TRUSTED ZONE                              │
│  - On-chain program accounts (PDAs)                        │
│  - User funds in market escrow                             │
│  - Platform fee wallets                                    │
└────────────────────────────────────────────────────────────┘
```

### 2.2 Key Security Boundaries

1. **Wallet Signature Verification** (Frontend → On-chain)
   - User signs transactions with private key
   - Solana runtime verifies signature
   - **Breach Impact:** Complete fund loss for user

2. **SIWS Authentication** (Frontend → Backend)
   - User signs message with wallet
   - Backend verifies signature with `tweetnacl`
   - Issues JWT cookie for session
   - **Breach Impact:** Session hijacking, unauthorized comments/username changes

3. **CORS Policy** (Backend)
   - Restricts API access to whitelisted origins
   - Prevents CSRF attacks
   - **Breach Impact:** Unauthorized API access from malicious sites

4. **PDA Derivation** (On-chain)
   - Deterministic address generation
   - Prevents account substitution attacks
   - **Breach Impact:** Fund theft if PDAs can be spoofed

---

## 3. Assets

### 3.1 High-Value Assets

| Asset | Location | Value | Protection Mechanism |
|-------|----------|-------|---------------------|
| **User SOL in markets** | On-chain PDAs | Variable (up to 10M SOL cap per market) | Anchor constraints, PDA seeds |
| **Platform fees** | `config.fee_wallet` | Cumulative 1% of all bets | Authority-controlled |
| **Creator fees** | `market.creator` wallets | Cumulative 1% of all bets | Per-market resolution |
| **Private keys** | User wallets (browser extension) | Unlimited | Never transmitted, wallet-managed |
| **Session tokens** | HTTP cookies | Limited (14-day expiry) | HttpOnly, Secure, SameSite |
| **Database credentials** | Railway env vars | Full DB access | Environment variable isolation |
| **SESSION_SECRET** | Railway env vars | Session forgery | Environment variable isolation |

### 3.2 Medium-Value Assets

| Asset | Location | Value | Protection Mechanism |
|-------|----------|-------|---------------------|
| **Usernames** | PostgreSQL `users` table | Reputation | Unique constraint, authenticated updates |
| **Comments** | PostgreSQL `comments` table | Social proof | Foreign key to users, authenticated creation |
| **Market metadata** | Supabase `markets` table | Discovery | Public read, controlled write |
| **Market images** | Supabase Storage | UX quality | Public URLs, size limits |

### 3.3 Low-Value Assets

| Asset | Location | Value | Protection Mechanism |
|-------|----------|-------|---------------------|
| **SIWS nonces** | PostgreSQL `siws_nonces` | One-time use | 5-minute expiry, consumed on use |
| **Health endpoint** | `/health` | Monitoring | Public, no sensitive data |

---

## 4. Threats

### 4.1 Attacker Personas

#### Persona 1: Malicious User
**Capabilities:**
- Can connect wallet
- Can sign transactions
- Can call public API endpoints
- Can inspect frontend code

**Allowed Actions:**
- Create markets (pays 0.02 SOL fee)
- Place bets (within min/max limits)
- Resolve own markets (after cutoff)
- Claim winnings
- Post comments (authenticated)

**Prohibited Actions:**
- ❌ Steal funds from other users
- ❌ Manipulate market outcomes (except own markets)
- ❌ Bypass betting limits
- ❌ Forge signatures
- ❌ Access other users' sessions
- ❌ Modify other users' comments/usernames

#### Persona 2: Market Creator (Malicious)
**Capabilities:**
- All Malicious User capabilities
- Can resolve own markets
- Receives 50% of fees from own markets

**Allowed Actions:**
- Resolve market to any valid outcome
- Resolve to VOID (under specific conditions)

**Prohibited Actions:**
- ❌ Resolve before cutoff (unless admin)
- ❌ Resolve to non-existent outcome
- ❌ Steal bets from market
- ❌ Re-resolve after first resolution
- ❌ Bypass fee collection

#### Persona 3: Platform Admin
**Capabilities:**
- Controls `config.authority` wallet
- Can update `config.fee_wallet`
- Can resolve any market
- Can transfer authority

**Allowed Actions:**
- Update platform fee wallet
- Resolve markets pre-cutoff (if `admin_pre_cutoff` enabled)
- Force VOID resolution
- Transfer admin authority

**Prohibited Actions:**
- ❌ Steal user funds directly
- ❌ Bypass fee collection
- ❌ Modify resolved markets
- ❌ Access user private keys

#### Persona 4: RPC-Level Attacker
**Capabilities:**
- Controls Solana RPC endpoint
- Can censor transactions
- Can provide false account data

**Allowed Actions:**
- Deny service (DoS)
- Front-run transactions
- Provide stale data

**Prohibited Actions:**
- ❌ Forge on-chain state (consensus prevents)
- ❌ Steal funds (program logic prevents)
- ❌ Modify program code (immutable)

#### Persona 5: Database Compromiser
**Capabilities:**
- Full access to PostgreSQL database
- Can read/write all tables

**Allowed Actions:**
- Read all usernames, comments, nonces
- Modify usernames, comments
- Delete data

**Prohibited Actions:**
- ❌ Steal on-chain funds (not in database)
- ❌ Forge wallet signatures (private keys not in DB)
- ❌ Bypass on-chain program logic

#### Persona 6: Supabase Key Leaker
**Capabilities:**
- Has `VITE_SUPABASE_PUBLISHABLE_KEY` (public key)

**Allowed Actions:**
- Read public market metadata
- Upload images (if storage policy allows)

**Prohibited Actions:**
- ❌ Modify data (requires service role key)
- ❌ Access backend-managed tables (separate connection)
- ❌ Steal funds (not in Supabase)

---

## 4.2 Threat Scenarios

### High-Severity Threats

#### T1: Reentrancy Attack on claim_winnings
**Likelihood:** Low  
**Impact:** Critical (fund theft)  
**Mitigation:**
- ✅ Anchor's `#[account(mut)]` prevents concurrent access
- ✅ `position.claimed` flag set before transfer
- ✅ PDA transfer uses CPI, not raw invoke

**Residual Risk:** Minimal (Anchor framework protection)

#### T2: Integer Overflow in Bet Calculations
**Likelihood:** Low  
**Impact:** Critical (fund loss/creation)  
**Mitigation:**
- ✅ All arithmetic uses `checked_add`, `checked_sub`, `checked_mul`
- ✅ Explicit overflow error handling
- ✅ Pool cap enforced (10M SOL)

**Residual Risk:** Minimal (comprehensive checks)

#### T3: PDA Seed Collision
**Likelihood:** Very Low  
**Impact:** Critical (account substitution)  
**Mitigation:**
- ✅ Market PDA uses: `[MARKET_SEED, creator, cutoff_ts, question_hash]`
- ✅ Position PDA uses: `[POS_SEED, market, user]`
- ✅ Config PDA uses: `[CONFIG_SEED]` (singleton)
- ✅ All seeds include unique identifiers

**Residual Risk:** Negligible (cryptographic collision resistance)

#### T4: Unauthorized Market Resolution
**Likelihood:** Low  
**Impact:** High (outcome manipulation)  
**Mitigation:**
- ✅ Only creator or admin can resolve
- ✅ Time-based constraints (must be after cutoff)
- ✅ Auto-void if winner pool is zero
- ✅ Cannot re-resolve (state check)

**Residual Risk:** Low (requires compromised admin key)

#### T5: Session Hijacking (JWT)
**Likelihood:** Medium  
**Impact:** Medium (unauthorized comments/username)  
**Mitigation:**
- ✅ HttpOnly cookies (no JavaScript access)
- ✅ Secure flag in production (HTTPS only)
- ✅ SameSite=none for cross-origin (with Secure)
- ✅ 14-day expiry
- ⚠️ No session revocation mechanism

**Residual Risk:** Medium (stolen cookie valid until expiry)

### Medium-Severity Threats

#### T6: CORS Bypass
**Likelihood:** Low  
**Impact:** Medium (unauthorized API access)  
**Mitigation:**
- ✅ Origin whitelist enforced
- ✅ Credentials required for authenticated endpoints
- ⚠️ No origin allowed for curl/Postman (convenience vs security)

**Residual Risk:** Low (requires misconfiguration)

#### T7: SQL Injection
**Likelihood:** Very Low  
**Impact:** High (database compromise)  
**Mitigation:**
- ✅ Parameterized queries throughout (`$1`, `$2`, etc.)
- ✅ No string concatenation in SQL
- ✅ Zod validation on inputs

**Residual Risk:** Minimal (best practices followed)

#### T8: Comment Spam
**Likelihood:** High  
**Impact:** Low (UX degradation)  
**Mitigation:**
- ✅ Authentication required
- ⚠️ No rate limiting implemented
- ⚠️ No content moderation

**Residual Risk:** High (easy to spam)

#### T9: Username Squatting
**Likelihood:** High  
**Impact:** Low (namespace pollution)  
**Mitigation:**
- ✅ Unique constraint on username
- ✅ Case-insensitive uniqueness
- ⚠️ No reserved username list
- ⚠️ No username reclamation policy

**Residual Risk:** Medium (first-come-first-served)

### Low-Severity Threats

#### T10: Front-Running
**Likelihood:** High (public mempool)  
**Impact:** Low (MEV extraction)  
**Mitigation:**
- ⚠️ No MEV protection
- ⚠️ Transactions visible before confirmation

**Residual Risk:** High (inherent to public blockchain)

#### T11: Dust Attack
**Likelihood:** Medium  
**Impact:** Very Low (minor fund lock)  
**Mitigation:**
- ✅ Minimum bet enforced (0.01 SOL)
- ✅ Last claimer gets dust (rounds to winner)

**Residual Risk:** Low (economically insignificant)

---

## 5. High-Risk Areas

### 5.1 Critical Code Paths

#### 1. Fund Custody (programs/yesno_markets/src/lib.rs)

**Lines 354-414: `place_bet`**
- Transfers user SOL to market PDA
- Updates pools and position
- **Risk:** Arithmetic overflow, incorrect pool accounting
- **Controls:** Checked arithmetic, pool cap, balance verification

**Lines 566-625: `claim_winnings`**
- Transfers winnings from market to user
- **Risk:** Reentrancy, double-claim, incorrect payout calculation
- **Controls:** `claimed` flag, PDA transfer, proportional math

**Lines 416-529: `resolve`**
- Collects and distributes fees
- Sets winning outcome
- **Risk:** Fee theft, unauthorized resolution, state corruption
- **Controls:** Authority checks, atomic fee transfer, state validation

#### 2. Authentication (server/src/index.ts)

**Lines 183-202: `/auth/siws/start`**
- Generates nonce for signature challenge
- **Risk:** Nonce reuse, predictable nonces
- **Controls:** UUID generation, 5-minute expiry, database storage

**Lines 204-244: `/auth/siws/finish`**
- Verifies wallet signature
- Issues JWT session
- **Risk:** Signature forgery, replay attacks, timing attacks
- **Controls:** `tweetnacl` verification, nonce consumption, expiry check

**Lines 99-108: `setSession`**
- Creates JWT cookie
- **Risk:** Weak secret, insecure cookie flags
- **Controls:** HS256 algorithm, environment-based security flags

#### 3. Input Validation (programs/yesno_markets/src/lib.rs)

**Lines 286-308: Market creation validation**
- Sanitizes question, answers, image URL
- **Risk:** XSS, injection, DoS via large inputs
- **Controls:** ASCII-only, length limits, trim, duplicate detection

### 5.2 Dependency Risks

| Dependency | Version | Known Vulnerabilities | Mitigation |
|------------|---------|----------------------|------------|
| `@solana/web3.js` | 1.98.4 | None known | Keep updated |
| `@coral-xyz/anchor` | 0.32.1 | None known | Monitor advisories |
| `express` | 4.19.2 | None known | Keep updated |
| `jsonwebtoken` | 9.0.2 | None known | Use HS256 only |
| `pg` | 8.12.0 | None known | Parameterized queries |
| `tweetnacl` | 1.0.3 | None known (audited) | Standard library |

### 5.3 Configuration Risks

| Configuration | Risk | Mitigation |
|---------------|------|------------|
| `SESSION_SECRET` | Weak/default secret | ✅ Documented to generate strong secret |
| `APP_ORIGIN` | Misconfigured CORS | ✅ Comma-separated validation |
| `DATABASE_URL` | Exposed in logs/errors | ✅ Masked in error messages |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public exposure | ✅ Designed to be public (anon key) |
| `NODE_ENV` | Not set to production | ✅ Documented in deployment guide |

---

## 6. Recommendations

### 6.1 Immediate Actions (Pre-Production)

1. **Implement Rate Limiting**
   - Add rate limiting to comment endpoints
   - Prevent spam and DoS attacks
   - Suggested: 10 comments per minute per user

2. **Add Session Revocation**
   - Implement logout-all-sessions functionality
   - Store session IDs in database
   - Allow users to revoke compromised sessions

3. **Enable Supabase RLS**
   - Configure Row-Level Security policies
   - Restrict direct Supabase access
   - Enforce backend-only writes

4. **Audit Admin Keys**
   - Verify `config.authority` wallet security
   - Use hardware wallet for admin operations
   - Document key rotation procedure

### 6.2 Short-Term Improvements (Post-Launch)

5. **Add Content Moderation**
   - Implement comment flagging
   - Admin review queue
   - Automated spam detection

6. **Implement Username Policies**
   - Reserve admin/system usernames
   - Add profanity filter
   - Username reclamation for inactive accounts

7. **Enhanced Monitoring**
   - Alert on large bets (>10 SOL)
   - Monitor failed authentication attempts
   - Track unusual market resolution patterns

8. **Security Headers**
   - Add CSP (Content Security Policy)
   - Enable HSTS
   - Implement X-Frame-Options

### 6.3 Long-Term Enhancements

9. **Formal Security Audit**
   - Engage third-party auditor for Anchor program
   - Focus on fund custody and arithmetic
   - Publish audit report

10. **Bug Bounty Program**
    - Incentivize responsible disclosure
    - Define scope and rewards
    - Use platform like Immunefi

11. **Multi-Sig Admin**
    - Require multiple signatures for admin actions
    - Use Squads Protocol or similar
    - Reduce single-point-of-failure risk

12. **MEV Protection**
    - Explore private mempool solutions
    - Implement commit-reveal for sensitive operations
    - Consider Jito bundles for atomic execution

---

## 7. Incident Response

### 7.1 Critical Incident Procedures

**On-Chain Exploit Detected:**
1. Pause market creation (if possible via admin)
2. Alert users via frontend banner
3. Document exploit details
4. Engage security auditor
5. Prepare patch and upgrade path

**Backend Compromise:**
1. Rotate `SESSION_SECRET` immediately
2. Invalidate all sessions
3. Audit database for unauthorized changes
4. Review access logs
5. Restore from backup if needed

**Wallet Key Compromise (Admin):**
1. Transfer authority to new wallet
2. Update `config.fee_wallet` if needed
3. Audit recent admin actions
4. Notify users of authority change

### 7.2 Contact Information

- **Security Email:** security@sillymarket.fun (to be created)
- **Emergency Contact:** [Admin wallet address]
- **Audit Firm:** [To be determined]

---

## 8. Compliance

### 8.1 Data Privacy

- **User Data Collected:** Wallet addresses, usernames, comments
- **Data Retention:** Indefinite (blockchain immutable)
- **Data Deletion:** Username/comments can be deleted from database
- **GDPR Compliance:** Wallet addresses are pseudonymous, not PII

### 8.2 Financial Regulations

- **Gambling Laws:** Prediction markets may be regulated in some jurisdictions
- **KYC/AML:** Not implemented (decentralized, wallet-based)
- **User Responsibility:** Users must comply with local laws

---

## Appendix A: Security Checklist

- [x] All arithmetic uses checked operations
- [x] PDA seeds prevent collisions
- [x] Authentication uses cryptographic signatures
- [x] SQL queries are parameterized
- [x] CORS configured for production domains
- [x] Cookies use HttpOnly and Secure flags
- [x] Input validation on all user inputs
- [x] Fee collection is atomic
- [ ] Rate limiting implemented
- [ ] Session revocation available
- [ ] Supabase RLS enabled
- [ ] Security audit completed
- [ ] Bug bounty program active

---

## Appendix B: File Reference

**On-Chain Program:**
- `programs/yesno_markets/src/lib.rs` - Main program logic

**Backend API:**
- `server/src/index.ts` - Express server and routes
- `server/.env.example` - Environment variable template

**Frontend:**
- `client/web/src/solana/actions.ts` - Transaction builders
- `client/web/src/solana/tx.ts` - Transaction submission
- `client/web/src/lib/http.ts` - API client
- `client/web/src/lib/config.ts` - Configuration management

**Documentation:**
- `DEPLOYMENT.md` - Deployment guide
- `docs/security_overview.md` - This document

---

**Document Owner:** Security Team  
**Last Review:** 2025-11-22  
**Next Review:** Before mainnet launch

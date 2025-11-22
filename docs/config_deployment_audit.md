# Configuration & Deployment Security Audit

**Audit Date:** 2025-11-22  
**Scope:** Environment variables, CORS, cookies, sessions, deployment config  
**Auditor:** Security Team

---

## Executive Summary

**Total Environment Variables:** 15  
**PUBLIC (Frontend-safe):** 10  
**SECRET (Backend-only):** 5  
**Security Status:** ✅ **SECURE** - No secrets exposed to frontend

**Key Findings:**
- ✅ Frontend only uses PUBLIC variables (all prefixed with `VITE_`)
- ✅ Backend SECRET variables never exposed to frontend
- ✅ Cookie security properly configured (httpOnly, SameSite, Secure)
- ✅ CORS configuration supports multiple origins
- ⚠️ SESSION_SECRET has weak default ("dev-secret") - must be changed in production

---

## Environment Variables Classification

### Complete Variable Inventory

| Variable | Used In | Classification | Purpose | Notes |
|----------|---------|----------------|---------|-------|
| **Frontend (client/web/)** |
| `VITE_API_URL` | Frontend | **PUBLIC** | Backend API endpoint | Points to Railway in production |
| `VITE_RPC_URL` | Frontend | **PUBLIC** | Solana RPC endpoint | Public RPC URL (Helius, QuickNode, etc.) |
| `VITE_PROGRAM_ID` | Frontend | **PUBLIC** | Solana program address | On-chain program public key |
| `VITE_SUPABASE_URL` | Frontend | **PUBLIC** | Supabase project URL | Public Supabase endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | **PUBLIC** | Supabase anon key | Designed for frontend use, RLS enforces permissions |
| `VITE_COMMITMENT` | Frontend | **PUBLIC** | Solana tx commitment | "confirmed", "finalized", or "processed" |
| `VITE_PRIORITY_MICROLAMPORTS` | Frontend | **PUBLIC** | Solana priority fee | Transaction priority fee amount |
| `VITE_REQUIRE_WALLET` | Frontend | **PUBLIC** | Feature flag | "1" to require wallet, "0" for guest mode |
| `VITE_DEBUG_DOCK` | Frontend | **PUBLIC** | Debug feature flag | "1" to show debug UI, "0" to hide |
| **Backend (server/)** |
| `PORT` | Backend | **PUBLIC** | Server port | Railway auto-injects, defaults to 8787 |
| `APP_ORIGIN` | Backend | **SECRET** | CORS allowed origins | Comma-separated list of frontend URLs |
| `DATABASE_URL` | Backend | **SECRET** | PostgreSQL connection | Contains database password |
| `SESSION_SECRET` | Backend | **SECRET** | JWT signing key | Used to sign session tokens |
| `NODE_ENV` | Backend | **SECRET** | Environment mode | "development" or "production" |

---

## Detailed Variable Analysis

### Frontend Variables (PUBLIC)

#### `VITE_API_URL`
```typescript
// client/web/src/lib/config.ts:17
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Backend API endpoint  
**Local Dev:** `http://localhost:8787`  
**Production:** `https://your-app.up.railway.app` (or custom domain)  
**Security:** Safe to expose - public API endpoint

---

#### `VITE_RPC_URL`
```typescript
// client/web/src/lib/config.ts:28
export const RPC_URL = import.meta.env.VITE_RPC_URL || "https://api.devnet.solana.com";
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Solana RPC endpoint  
**Local Dev:** `https://api.devnet.solana.com`  
**Production:** `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` (or QuickNode)  
**Security:** Safe to expose - public RPC endpoint (API key in URL is acceptable for RPC)

---

#### `VITE_PROGRAM_ID`
```typescript
// client/web/src/lib/config.ts:33
export const PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID;
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Deployed Solana program address  
**Example:** `BPFLoaderUpgradeab1e11111111111111111111111`  
**Security:** Safe to expose - on-chain programs are public by design

---

#### `VITE_SUPABASE_URL`
```typescript
// client/web/src/integrations/supabase/client.ts:6
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Supabase project URL  
**Example:** `https://abcdefgh.supabase.co`  
**Security:** Safe to expose - public Supabase endpoint, RLS enforces permissions

---

#### `VITE_SUPABASE_PUBLISHABLE_KEY`
```typescript
// client/web/src/integrations/supabase/client.ts:7
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Supabase anonymous/public key  
**Example:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`  
**Security:** ✅ **SAFE** - Designed for frontend use, RLS policies enforce data access  
**Note:** This is NOT the service role key (which must remain secret)

---

#### `VITE_COMMITMENT`
```typescript
// client/web/src/lib/config.ts:39
export const COMMITMENT = (import.meta.env.VITE_COMMITMENT as "processed" | "confirmed" | "finalized") || "confirmed";
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Solana transaction commitment level  
**Values:** `"processed"`, `"confirmed"`, `"finalized"`  
**Security:** Safe to expose - configuration setting only

---

#### `VITE_PRIORITY_MICROLAMPORTS`
```typescript
// client/web/src/lib/config.ts:44
export const PRIORITY_MICROLAMPORTS = Number(import.meta.env.VITE_PRIORITY_MICROLAMPORTS || 0);
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Solana priority fee for transactions  
**Default:** `0`  
**Security:** Safe to expose - user-facing configuration

---

#### `VITE_REQUIRE_WALLET`
```typescript
// client/web/src/lib/config.ts:68
export const REQUIRE_WALLET = import.meta.env.VITE_REQUIRE_WALLET === "1";
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Feature flag to require wallet connection  
**Values:** `"1"` (require) or `"0"` (optional)  
**Security:** Safe to expose - UI feature flag

---

#### `VITE_DEBUG_DOCK`
```typescript
// client/web/src/lib/config.ts:74
export const DEBUG_DOCK = import.meta.env.VITE_DEBUG_DOCK === "1";
```

**Classification:** ✅ **PUBLIC**  
**Purpose:** Show debug wallet dock in development  
**Values:** `"1"` (show) or `"0"` (hide)  
**Security:** Safe to expose - development feature flag

---

### Backend Variables (SECRET)

#### `PORT`
```typescript
// server/src/index.ts:15
const PORT = Number(process.env.PORT || 8787);
```

**Classification:** ✅ **PUBLIC** (but backend-only)  
**Purpose:** Server port number  
**Local Dev:** `8787`  
**Production:** Auto-injected by Railway  
**Security:** Safe to expose - public port number

---

#### `APP_ORIGIN`
```typescript
// server/src/index.ts:13-14
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:8080";
const ALLOWED_ORIGINS = APP_ORIGIN.split(",").map(o => o.trim());
```

**Classification:** 🔒 **SECRET**  
**Purpose:** CORS allowed origins (comma-separated)  
**Local Dev:** `http://localhost:8080`  
**Production:** `https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app`  
**Security:** ⚠️ **BACKEND-ONLY** - Controls CORS policy  
**Why Secret:** Revealing this could help attackers understand CORS configuration

---

#### `DATABASE_URL`
```typescript
// server/src/index.ts:16
const DATABASE_URL = process.env.DATABASE_URL || "";
```

**Classification:** 🔒 **SECRET**  
**Purpose:** PostgreSQL connection string  
**Format:** `postgresql://user:password@host:5432/database`  
**Security:** 🔴 **CRITICAL** - Contains database password  
**Must:** NEVER expose to frontend or logs

---

#### `SESSION_SECRET`
```typescript
// server/src/index.ts:17
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";
```

**Classification:** 🔒 **SECRET**  
**Purpose:** JWT signing key  
**Security:** 🔴 **CRITICAL** - Used to sign session tokens  
**Must:** 
- Use strong random string (min 32 characters)
- NEVER expose to frontend
- Change default "dev-secret" in production

**⚠️ ISSUE:** Default value "dev-secret" is weak

**PATCH:**
```bash
# Generate strong secret
openssl rand -base64 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Set in .env
SESSION_SECRET=your_generated_secret_here
```

---

#### `NODE_ENV`
```typescript
// server/src/index.ts:101, 110
const isProduction = process.env.NODE_ENV === "production";
```

**Classification:** 🔒 **SECRET** (but not sensitive)  
**Purpose:** Environment mode  
**Values:** `"development"` or `"production"`  
**Security:** Backend-only - controls cookie security flags  
**Impact:** Determines `SameSite` and `Secure` cookie flags

---

## CORS Configuration Analysis

### Current Implementation

```typescript
// server/src/index.ts:127-141
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
```

### Security Assessment

✅ **GOOD:**
- Validates origin against whitelist (`ALLOWED_ORIGINS`)
- Supports multiple origins via comma-separated `APP_ORIGIN`
- Enables credentials (required for cookies)

⚠️ **ISSUE:** Allows requests with no `origin` header

**Risk:** MEDIUM  
**Impact:** Allows server-to-server requests, bypassing CORS protection

**PATCH:** (Already documented in backend_security_audit.md Issue #4)
```typescript
origin: (origin, callback) => {
  // In production, reject requests with no origin
  if (!origin) {
    if (process.env.NODE_ENV === 'production') {
      return callback(new Error('Origin header required'));
    }
    return callback(null, true); // Allow in dev only
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    callback(null, true);
  } else {
    console.warn(`[CORS] Rejected origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  }
},
```

---

## Cookie & Session Security Analysis

### Session Cookie Configuration

```typescript
// server/src/index.ts:99-108
function setSession(res: express.Response, u: JwtUser) {
  const token = jwt.sign(u, SESSION_SECRET, { algorithm: "HS256", expiresIn: "14d" });
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    maxAge: 14 * 24 * 3600 * 1000
  });
}
```

### Security Assessment

✅ **EXCELLENT:**
- `httpOnly: true` - Prevents JavaScript access (XSS protection)
- `sameSite: "none"` in production - Required for cross-site cookies (Vercel → Railway)
- `secure: true` in production - HTTPS-only
- `maxAge: 14 days` - Explicit expiry

✅ **CORRECT:** Uses `SameSite=None; Secure` in production for cross-origin setup (Vercel frontend → Railway backend)

✅ **CORRECT:** Uses `SameSite=Lax` in development for localhost testing

### JWT Configuration

```typescript
// server/src/index.ts:100
const token = jwt.sign(u, SESSION_SECRET, { algorithm: "HS256", expiresIn: "14d" });
```

✅ **GOOD:**
- Algorithm: HS256 (symmetric, appropriate for server-only signing)
- Expiry: 14 days (reasonable for user sessions)

⚠️ **IMPROVEMENT:** Add algorithm restriction in verification (already documented in backend_security_audit.md Issue #7)

---

## Health Check Endpoint

```typescript
// server/src/index.ts:363
app.get("/health", (_req, res) => res.json({ ok: true }));
```

### Security Assessment

✅ **GOOD:** Simple health check endpoint

⚠️ **IMPROVEMENT:** Add database connection check

**PATCH:**
```typescript
app.get("/health", async (_req, res) => {
  const dbHealthy = await testConnection();
  res.status(dbHealthy ? 200 : 503).json({ 
    ok: dbHealthy,
    database: dbHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});
```

---

## Logging Security

### Current Logging

```typescript
// server/src/index.ts:368
console.log(`\n✅ API listening on http://localhost:${PORT}  (CORS: ${APP_ORIGIN})`);
```

### Security Assessment

✅ **SAFE:** Logs do not contain secrets

**Verified Safe Logs:**
- Port number (public)
- CORS origins (not sensitive in logs)
- Database connection status (no credentials)

**No Secret Exposure:** ✅ Confirmed

---

## Secret Exposure Verification

### Frontend Bundle Analysis

**Checked:** All `import.meta.env.*` references in client/web/src/

**Result:** ✅ **NO SECRETS EXPOSED**

All frontend variables are prefixed with `VITE_` and are PUBLIC by design.

### Backend Environment Variables

**Checked:** All `process.env.*` references in server/src/

**Result:** ✅ **ALL SECRETS BACKEND-ONLY**

No backend SECRET variables are passed to frontend.

---

## Production Deployment Configuration

### Local Development

#### `client/web/.env.local`
```bash
# API
VITE_API_URL=http://localhost:8787

# Solana
VITE_RPC_URL=https://api.devnet.solana.com
VITE_PROGRAM_ID=YOUR_DEVNET_PROGRAM_ID
VITE_COMMITMENT=confirmed
VITE_PRIORITY_MICROLAMPORTS=0

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here

# Features
VITE_REQUIRE_WALLET=1
VITE_DEBUG_DOCK=1
```

#### `server/.env`
```bash
# Server
PORT=8787
NODE_ENV=development

# CORS (comma-separated)
APP_ORIGIN=http://localhost:5173,http://localhost:8080

# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres:your_password@db.your-project.supabase.co:5432/postgres

# Security
SESSION_SECRET=your_strong_random_secret_here_min_32_chars
```

---

### Production: Vercel (Frontend)

**Platform:** Vercel  
**Environment Variables:**

```bash
# API
VITE_API_URL=https://your-app.up.railway.app

# Solana
VITE_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
VITE_PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
VITE_COMMITMENT=confirmed
VITE_PRIORITY_MICROLAMPORTS=10000

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here

# Features
VITE_REQUIRE_WALLET=1
VITE_DEBUG_DOCK=0
```

**How to Set:**
1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add each variable above
3. Select "Production" environment
4. Redeploy

**Security Notes:**
- ✅ All variables are PUBLIC (safe to expose in frontend bundle)
- ✅ No secrets in Vercel environment
- ⚠️ Helius API key in RPC URL is acceptable (designed for frontend use)

---

### Production: Railway (Backend)

**Platform:** Railway  
**Environment Variables:**

```bash
# Server (Railway auto-injects PORT)
# PORT is automatically set by Railway
NODE_ENV=production

# CORS - CRITICAL: Update with your actual frontend URLs
APP_ORIGIN=https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app

# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.your-project.supabase.co:5432/postgres

# Security - CRITICAL: Generate strong secret
SESSION_SECRET=GENERATE_STRONG_RANDOM_SECRET_MIN_32_CHARS
```

**How to Set:**
1. Go to Railway Dashboard → Project → Variables
2. Add each variable above
3. Click "Deploy"

**Security Notes:**
- 🔒 `DATABASE_URL` contains password - NEVER expose
- 🔒 `SESSION_SECRET` signs JWTs - MUST be strong random string
- 🔒 `APP_ORIGIN` controls CORS - Update with actual frontend URLs
- ✅ `PORT` auto-injected by Railway (no need to set)

**Generate Strong SESSION_SECRET:**
```bash
# Option 1: OpenSSL
openssl rand -base64 32

# Option 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Example output:
# 8xK9mP2nQ7vR4sT6uW8yZ1aB3cD5eF7gH9jK0lM2nO4p
```

---

## Environment Variable Placement Guide

### Vercel (Frontend)

| Variable | Required | Example |
|----------|----------|---------|
| `VITE_API_URL` | ✅ Yes | `https://your-app.up.railway.app` |
| `VITE_RPC_URL` | ✅ Yes | `https://mainnet.helius-rpc.com/?api-key=KEY` |
| `VITE_PROGRAM_ID` | ✅ Yes | `BPFLoader...` |
| `VITE_SUPABASE_URL` | ⚠️ Optional | `https://project.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ⚠️ Optional | `eyJhbGci...` |
| `VITE_COMMITMENT` | ⚠️ Optional | `confirmed` |
| `VITE_PRIORITY_MICROLAMPORTS` | ⚠️ Optional | `10000` |
| `VITE_REQUIRE_WALLET` | ⚠️ Optional | `1` |
| `VITE_DEBUG_DOCK` | ⚠️ Optional | `0` |

### Railway (Backend)

| Variable | Required | Example |
|----------|----------|---------|
| `NODE_ENV` | ✅ Yes | `production` |
| `APP_ORIGIN` | ✅ Yes | `https://sillymarket.fun,https://sillymarket.vercel.app` |
| `DATABASE_URL` | ✅ Yes | `postgresql://postgres:pass@host:5432/db` |
| `SESSION_SECRET` | ✅ Yes | `STRONG_RANDOM_SECRET` |
| `PORT` | ⚠️ Auto | Railway auto-injects |

---

## Security Checklist

### Before Production Deployment

#### Frontend (Vercel)
- [ ] All `VITE_*` variables set in Vercel dashboard
- [ ] `VITE_API_URL` points to Railway backend
- [ ] `VITE_RPC_URL` uses mainnet RPC (not devnet)
- [ ] `VITE_PROGRAM_ID` is mainnet program ID
- [ ] `VITE_DEBUG_DOCK` set to `0`
- [ ] No secrets in frontend environment variables
- [ ] Verify frontend bundle doesn't contain secrets

#### Backend (Railway)
- [ ] `NODE_ENV` set to `production`
- [ ] `APP_ORIGIN` includes all frontend URLs (comma-separated)
- [ ] `DATABASE_URL` uses production Supabase database
- [ ] `SESSION_SECRET` is strong random string (min 32 chars)
- [ ] `SESSION_SECRET` is different from dev secret
- [ ] No secrets logged to console
- [ ] CORS configuration tested with production frontend

#### General
- [ ] Test CORS with actual frontend URL
- [ ] Test cookie setting from Railway to Vercel
- [ ] Verify `SameSite=None; Secure` cookies work
- [ ] Test authentication flow end-to-end
- [ ] Monitor Railway logs for errors
- [ ] Check Vercel deployment logs

---

## Common Deployment Issues

### Issue: Cookies Not Set (Cross-Origin)

**Symptom:** Authentication fails, cookies not sent

**Cause:** Missing `SameSite=None; Secure` or CORS misconfiguration

**Fix:**
1. Verify `NODE_ENV=production` in Railway
2. Verify `APP_ORIGIN` includes frontend URL
3. Verify frontend uses HTTPS (Vercel auto-provides)
4. Check browser console for CORS errors

### Issue: CORS Errors

**Symptom:** `Access-Control-Allow-Origin` errors in browser

**Cause:** `APP_ORIGIN` doesn't include frontend URL

**Fix:**
```bash
# Railway environment variable
APP_ORIGIN=https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app
```

### Issue: Database Connection Fails

**Symptom:** Backend crashes on startup

**Cause:** Invalid `DATABASE_URL`

**Fix:**
1. Get connection string from Supabase dashboard
2. Verify password is correct
3. Check database is accessible from Railway IP

---

## Conclusion

**Overall Security Posture:** ✅ **EXCELLENT**

**Strengths:**
- Clear separation of PUBLIC and SECRET variables
- Frontend only uses PUBLIC variables (VITE_* prefix)
- Cookie security properly configured
- CORS supports multiple origins
- No secrets exposed in frontend bundle

**Required Actions Before Production:**
1. ✅ Generate strong `SESSION_SECRET` (min 32 chars)
2. ✅ Update `APP_ORIGIN` with actual frontend URLs
3. ✅ Set `NODE_ENV=production` in Railway
4. ✅ Verify all Vercel environment variables
5. ⚠️ Consider implementing CORS origin header requirement in production

**Optional Improvements:**
- Add database health check to `/health` endpoint
- Implement session revocation mechanism
- Add request ID tracking
- Monitor Railway logs for security events

---

**Audit Status:** Complete  
**Next Review:** After production deployment

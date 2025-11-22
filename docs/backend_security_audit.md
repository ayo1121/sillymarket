# Backend Security Audit Report - server/

**Audit Date:** 2025-11-22  
**Scope:** server/src/index.ts (Backend API)  
**Auditor:** Security Team

---

## Executive Summary

**Total Issues Found:** 7  
**High Severity:** 2  
**Medium Severity:** 3  
**Low Severity:** 2

**Overall Assessment:** The backend has a solid foundation with proper signature verification and parameterized SQL queries. However, several security improvements are needed before production deployment, particularly around rate limiting, input validation, and error handling.

---

## Route Classification

| Route | Method | Auth Level | Input Sources | Description |
|-------|--------|------------|---------------|-------------|
| `/health` | GET | Public | None | Health check |
| `/me` | GET | Public (optional auth) | Cookie (sid) | Get current user |
| `/auth/siws/start` | POST | Public | Body (pubkey) | Initiate wallet auth |
| `/auth/siws/finish` | POST | Public | Body (pubkey, nonce, signature) | Complete wallet auth |
| `/auth/logout` | POST | Public | Cookie (sid) | Clear session |
| `/user/username` | POST | **Authenticated** | Cookie (sid), Body (username) | Set username |
| `/comments` | GET | Public | Query (marketId) | Fetch comments |
| `/comments` | POST | **Authenticated** | Cookie (sid), Body (marketId, commentText) | Post comment |

---

## Identified Vulnerabilities

### ISSUE #1: No Rate Limiting on Authentication Endpoints

**RISK:** HIGH  
**LOCATION:** Lines 183-244 (`/auth/siws/start`, `/auth/siws/finish`)

**Description:**  
The authentication endpoints have no rate limiting, allowing attackers to:
- Brute-force nonce generation (DoS attack on database)
- Attempt signature verification attacks
- Exhaust database connections
- Fill the `siws_nonces` table with garbage

**Current Code:**
```typescript
app.post("/auth/siws/start", async (req, res) => {
  // No rate limiting
  const schema = z.object({ pubkey: z.string().min(10) });
  // ...
});
```

**PATCH:**

Install rate limiting middleware:
```bash
npm install express-rate-limit
```

Add to server/src/index.ts:
```typescript
import rateLimit from 'express-rate-limit';

// After line 10 (imports)
// Create rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window per IP
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const commentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 comments per minute per IP
  message: { error: 'Too many comments, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to routes (after line 182)
app.post("/auth/siws/start", authLimiter, async (req, res) => {
  // existing code
});

app.post("/auth/siws/finish", authLimiter, async (req, res) => {
  // existing code
});

app.post("/comments", commentLimiter, async (req, res) => {
  // existing code
});
```

---

### ISSUE #2: Weak Pubkey Validation

**RISK:** HIGH  
**LOCATION:** Lines 184, 206 (Zod schemas)

**Description:**  
The pubkey validation only checks minimum length (10 characters), but doesn't validate:
- Base58 encoding format
- Solana public key length (32 bytes = 44 base58 characters)
- Invalid characters

This allows malformed input to reach the signature verification step, wasting CPU cycles.

**Current Code:**
```typescript
const schema = z.object({ pubkey: z.string().min(10) });
```

**PATCH:**

```typescript
// Add helper function after line 148
function isValidSolanaPubkey(pubkey: string): boolean {
  try {
    const decoded = bs58.decode(pubkey);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

// Update schemas (lines 184, 206)
// For /auth/siws/start
const schema = z.object({ 
  pubkey: z.string()
    .length(44, "Invalid pubkey length") // Solana pubkeys are exactly 44 base58 chars
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Invalid base58 characters")
    .refine(isValidSolanaPubkey, "Invalid Solana public key")
});

// For /auth/siws/finish
const schema = z.object({
  pubkey: z.string()
    .length(44)
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .refine(isValidSolanaPubkey, "Invalid Solana public key"),
  nonce: z.string()
    .length(32, "Invalid nonce length") // UUID without hyphens
    .regex(/^[a-f0-9]{32}$/, "Invalid nonce format"),
  signatureBase58: z.string()
    .min(64)
    .max(88) // Ed25519 signatures are 64 bytes = 88 base58 chars
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Invalid signature format")
});
```

---

### ISSUE #3: No Maximum Length on Comment Text

**RISK:** MEDIUM  
**LOCATION:** Line 316 (comment validation)

**Description:**  
While there's a minimum length check, there's no maximum length validation on `commentText`. This allows:
- Database bloat
- DoS via extremely large comments
- Potential memory exhaustion

**Current Code:**
```typescript
const schema = z.object({
  marketId: z.string().min(1),
  commentText: z.string().min(1)
});
```

**PATCH:**

```typescript
const schema = z.object({
  marketId: z.string()
    .min(1, "Market ID required")
    .max(100, "Market ID too long"),
  commentText: z.string()
    .min(1, "Comment cannot be empty")
    .max(500, "Comment must be less than 500 characters")
});
```

---

### ISSUE #4: CORS Allows Requests with No Origin

**RISK:** MEDIUM  
**LOCATION:** Lines 129-131 (CORS configuration)

**Description:**  
The CORS configuration allows requests with no `origin` header for "convenience" (curl, Postman). However, this also allows:
- Server-to-server attacks (SSRF)
- Bypassing origin restrictions
- Potential abuse from non-browser clients

**Current Code:**
```typescript
origin: (origin, callback) => {
  // Allow requests with no origin (mobile apps, curl, Postman)
  if (!origin) return callback(null, true);
  // ...
}
```

**PATCH:**

```typescript
// Replace CORS configuration (lines 127-141)
app.use(
  cors({
    origin: (origin, callback) => {
      // In production, reject requests with no origin
      // In development, allow for testing
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
    credentials: true,
    maxAge: 86400, // Cache preflight for 24 hours
  })
);
```

---

### ISSUE #5: Sensitive Data Logged in Error Messages

**RISK:** MEDIUM  
**LOCATION:** Lines 178, 305, 357 (error logging)

**Description:**  
Database errors are logged with `console.error`, which may expose:
- SQL query details
- Database connection strings
- User IDs or sensitive data

In production, these logs may be sent to centralized logging (Railway logs), potentially exposing sensitive information.

**Current Code:**
```typescript
console.error("[GET /me] Database error:", e);
console.error("Error fetching comments:", e);
console.error("Error creating comment:", e);
```

**PATCH:**

```typescript
// Add sanitized error logger after line 148
function logError(context: string, error: any) {
  // Only log safe error details
  const safeError = {
    message: error?.message || 'Unknown error',
    code: error?.code,
    // Never log: stack traces, query details, connection strings
  };
  console.error(`[${context}]`, safeError);
}

// Replace error logging (lines 178, 305, 357)
// Line 178
logError('GET /me', e);

// Line 305
logError('GET /comments', e);

// Line 357
logError('POST /comments', e);
```

---

### ISSUE #6: No Cleanup of Expired Nonces

**RISK:** LOW  
**LOCATION:** Lines 67-78 (nonces table creation)

**Description:**  
While an index exists on `expires_at`, there's no automated cleanup job for expired nonces. Over time, the `siws_nonces` table will accumulate garbage, leading to:
- Database bloat
- Slower queries
- Wasted storage

**Current Code:**
```typescript
// Create index for cleanup of expired nonces
await pool.query(`CREATE INDEX IF NOT EXISTS siws_nonces_expires_at_idx ON siws_nonces (expires_at);`);
// No cleanup job
```

**PATCH:**

```typescript
// Add cleanup function after line 95
async function cleanupExpiredNonces() {
  try {
    const result = await pool.query(
      `DELETE FROM siws_nonces WHERE expires_at < NOW()`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[Cleanup] Removed ${result.rowCount} expired nonces`);
    }
  } catch (e) {
    logError('Nonce cleanup', e);
  }
}

// Schedule cleanup (after line 374, inside migrate().then())
app.listen(PORT, () => {
  console.log(`\n✅ API listening on http://localhost:${PORT}  (CORS: ${APP_ORIGIN})`);
  // ... existing logs
  
  // Run cleanup every hour
  setInterval(cleanupExpiredNonces, 60 * 60 * 1000);
  cleanupExpiredNonces(); // Run immediately on startup
});
```

---

### ISSUE #7: JWT Algorithm Not Explicitly Restricted

**RISK:** LOW  
**LOCATION:** Line 120 (JWT verification)

**Description:**  
While `setSession` uses `HS256`, the `jwt.verify` call doesn't explicitly restrict algorithms. This could allow algorithm confusion attacks if an attacker can modify the JWT header.

**Current Code:**
```typescript
try { (req as any).user = jwt.verify(tok, SESSION_SECRET) as JwtUser; } catch { }
```

**PATCH:**

```typescript
// Line 120 - Add algorithm restriction
try { 
  (req as any).user = jwt.verify(tok, SESSION_SECRET, { 
    algorithms: ['HS256'] 
  }) as JwtUser; 
} catch { 
  // Invalid token, treat as guest
}
```

---

## Hardened CORS Configuration

For production deployment, use this configuration:

```typescript
// server/src/index.ts (lines 127-141)
import cors from 'cors';

// Strict CORS for production
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Reject requests with no origin in production
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('Origin header required'));
      }
      // Allow in development for testing
      return callback(null, true);
    }

    // Check against whitelist
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Rejected origin: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  
  // Only allow credentials with whitelisted origins
  credentials: true,
  
  // Allowed methods
  methods: ['GET', 'POST'],
  
  // Allowed headers
  allowedHeaders: ['Content-Type', 'Authorization'],
  
  // Expose headers
  exposedHeaders: ['Set-Cookie'],
  
  // Cache preflight requests for 24 hours
  maxAge: 86400,
  
  // Don't pass CORS preflight to next handler
  preflightContinue: false,
  
  // Provide successful status for preflight
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
```

**Railway Environment Variable:**
```bash
APP_ORIGIN=https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app
NODE_ENV=production
```

---

## Wallet-Based Authentication Checklist

### Request Structure Validation

- [x] **Pubkey Format**
  - Must be exactly 44 base58 characters
  - Must decode to 32 bytes
  - Must contain only valid base58 characters (1-9, A-H, J-N, P-Z, a-k, m-z)

- [x] **Nonce Format**
  - Must be exactly 32 hexadecimal characters
  - Must exist in database
  - Must not be expired
  - Must match the pubkey it was issued to

- [x] **Signature Format**
  - Must be 64-88 base58 characters (Ed25519 signature)
  - Must be valid base58
  - Must decode successfully

### Signature Verification Steps

1. **Retrieve Nonce from Database**
   ```typescript
   const nonce = await pool.query(
     'SELECT message, expires_at, pubkey FROM siws_nonces WHERE nonce = $1',
     [nonceFromRequest]
   );
   ```

2. **Validate Nonce**
   - Nonce exists in database
   - Nonce not expired (`expires_at > NOW()`)
   - Nonce pubkey matches request pubkey

3. **Verify Signature**
   ```typescript
   const msgBytes = new TextEncoder().encode(storedMessage);
   const sig = bs58.decode(signatureBase58);
   const pk = bs58.decode(pubkey);
   const valid = nacl.sign.detached.verify(msgBytes, sig, pk);
   ```

4. **Consume Nonce**
   ```typescript
   await pool.query('DELETE FROM siws_nonces WHERE nonce = $1', [nonce]);
   ```

### Replay Protection

- [x] **Nonce Single-Use**
  - Nonce deleted immediately after successful verification
  - Cannot be reused

- [x] **Time-Based Expiry**
  - Nonces expire after 5 minutes
  - Prevents delayed replay attacks

- [ ] **IP-Based Rate Limiting** (RECOMMENDED)
  - Limit authentication attempts per IP
  - Prevents brute-force attacks

### Session Security

- [x] **JWT Configuration**
  - Algorithm: HS256 (symmetric)
  - Expiry: 14 days
  - Secret: Strong random string (min 32 bytes)

- [x] **Cookie Flags**
  - `httpOnly: true` - No JavaScript access
  - `secure: true` (production) - HTTPS only
  - `sameSite: 'none'` (production) - Cross-origin support
  - `maxAge: 14 days` - Explicit expiry

- [ ] **Session Revocation** (RECOMMENDED)
  - Store session IDs in database
  - Allow users to revoke sessions
  - Implement logout-all functionality

---

## Additional Recommendations

### 1. Add Request ID Tracking

```typescript
import { randomUUID } from 'node:crypto';

// Middleware to add request ID
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});
```

### 2. Add Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

### 3. Implement Graceful Shutdown

```typescript
// Handle shutdown signals
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});
```

### 4. Add Health Check Details

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

## Summary of Required Changes

### High Priority (Before Production)
1. ✅ Add rate limiting to auth endpoints
2. ✅ Strengthen pubkey validation
3. ✅ Add maximum length to comment text
4. ✅ Restrict CORS to reject no-origin requests in production

### Medium Priority (Before Production)
5. ✅ Sanitize error logging
6. ✅ Add JWT algorithm restriction

### Low Priority (Post-Launch)
7. ✅ Implement nonce cleanup job
8. ⚠️ Add session revocation mechanism
9. ⚠️ Add security headers (helmet)
10. ⚠️ Implement request ID tracking

---

## Testing Checklist

Before deploying to production:

- [ ] Test rate limiting with multiple rapid requests
- [ ] Attempt authentication with invalid pubkey formats
- [ ] Try posting comments >500 characters
- [ ] Verify CORS rejects non-whitelisted origins
- [ ] Confirm no sensitive data in production logs
- [ ] Test nonce expiry and cleanup
- [ ] Verify JWT algorithm restriction
- [ ] Test session expiry after 14 days
- [ ] Confirm cookies have correct flags in production

---

**Audit Status:** Complete  
**Next Review:** After implementing high-priority fixes

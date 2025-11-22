import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { Pool } from "pg";
import nacl from "tweetnacl";
import bs58 from "bs58";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

// =====================================================================
// ENVIRONMENT VARIABLES
// =====================================================================

const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:8080";
const ALLOWED_ORIGINS = APP_ORIGIN.split(",").map(o => o.trim());
const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// =====================================================================
// SECURITY HELPERS
// =====================================================================

/**
 * Validate Solana public key format
 * - Must be valid base58
 * - Must decode to exactly 32 bytes
 */
function isValidSolanaPubkey(pubkey: string): boolean {
  try {
    const decoded = bs58.decode(pubkey);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Sanitized error logging
 * Logs only safe error information, not full stack traces or sensitive data
 */
function logError(context: string, err: any) {
  const safeError = {
    message: err?.message || "Unknown error",
    code: err?.code,
    name: err?.name,
  };
  console.error(`[${context}]`, safeError);
}

// =====================================================================
// DATABASE CONNECTION
// =====================================================================

const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  connectionTimeoutMillis: 5000,
});

// Test database connection
async function testConnection() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (e) {
    logError("Database connection test", e);
    return false;
  }
}

// =====================================================================
// DATABASE MIGRATIONS
// =====================================================================

async function migrate() {
  // Check if DATABASE_URL has placeholder values
  if (!DATABASE_URL || DATABASE_URL.includes("REPLACE_WITH")) {
    console.warn("⚠️  DATABASE_URL contains placeholders. Server will start but database features will not work.");
    console.warn("   Please update server/.env with your actual database credentials.");
    return; // Allow server to start without database
  }

  const connected = await testConnection();
  if (!connected) {
    throw new Error(`Cannot connect to PostgreSQL at ${DATABASE_URL ? new URL(DATABASE_URL).host : "localhost:5432"}. Make sure PostgreSQL is running.`);
  }

  try {
    // Create users table (for SIWS authentication)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pubkey    text NOT NULL UNIQUE,
        username  text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_pubkey_idx ON users (pubkey);`);

    // Create SIWS nonces table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS siws_nonces (
        nonce      text PRIMARY KEY,
        pubkey     text NOT NULL,
        message    text NOT NULL,
        issued_at  timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS siws_nonces_expires_at_idx ON siws_nonces (expires_at);`);

    // Create comments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        market_id   text NOT NULL,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_text text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS comments_market_id_idx ON comments (market_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS comments_user_id_idx ON comments (user_id);`);
  } catch (e) {
    logError("Database migration", e);
    throw e;
  }
}

// =====================================================================
// NONCE CLEANUP JOB
// =====================================================================

/**
 * Delete expired nonces from the database
 * Runs periodically to prevent table bloat
 */
async function cleanupExpiredNonces() {
  try {
    const result = await pool.query(
      `DELETE FROM siws_nonces WHERE expires_at < NOW()`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[Nonce Cleanup] Removed ${result.rowCount} expired nonce(s)`);
    }
  } catch (e) {
    logError("Nonce cleanup", e);
  }
}

// =====================================================================
// AUTHENTICATION
// =====================================================================

type JwtUser = { id: string; pubkey: string };

function setSession(res: express.Response, u: JwtUser) {
  const token = jwt.sign(u, SESSION_SECRET, { algorithm: "HS256", expiresIn: "14d" });
  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "none" : "lax",
    secure: IS_PRODUCTION,
    maxAge: 14 * 24 * 3600 * 1000
  });
}

function clearSession(res: express.Response) {
  res.clearCookie("sid", {
    httpOnly: true,
    sameSite: IS_PRODUCTION ? "none" : "lax",
    secure: IS_PRODUCTION
  });
}

function authMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const tok = req.cookies?.sid;
  if (tok) {
    try {
      // ✅ SECURITY: Explicitly restrict JWT algorithm to HS256
      (req as any).user = jwt.verify(tok, SESSION_SECRET, { algorithms: ["HS256"] }) as JwtUser;
    } catch {
      // Invalid token - continue as guest
    }
  }
  next();
}

// =====================================================================
// RATE LIMITING
// =====================================================================

// General API rate limiter (100 requests per minute)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication rate limiter (10 requests per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use IP + user agent for better tracking
    return `${req.ip}-${req.get("user-agent")}`;
  },
});

// Comment rate limiter (5 comments per minute)
const commentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: "Too many comments, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

// =====================================================================
// EXPRESS APP SETUP
// =====================================================================

const app = express();

// ✅ SECURITY: Add helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for API responses
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
}));

// ✅ SECURITY: Apply general rate limiting to all routes
app.use(generalLimiter);

// ✅ SECURITY: Hardened CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // ✅ SECURITY: In production, reject requests with no origin header
      if (!origin) {
        if (IS_PRODUCTION) {
          console.warn("[CORS] Rejected request with no origin header");
          return callback(new Error("Origin header required"));
        }
        // Allow in development for testing (curl, Postman, etc.)
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Rejected origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(authMiddleware);

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

const now = () => new Date();
const addMinutes = (d: Date, mins: number) => new Date(d.getTime() + mins * 60000);

function buildMessage(origin: string, pubkey: string, nonce: string, issuedAtISO: string) {
  return [
    "yesno.fun wants you to sign in with your Solana wallet.",
    "",
    `URI: ${origin}`,
    `Wallet: ${pubkey}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAtISO}`
  ].join("\n");
}

// =====================================================================
// VALIDATION SCHEMAS
// =====================================================================

// Base58 regex (Solana addresses use base58 encoding)
const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;

// ✅ SECURITY: Strengthened pubkey validation
const pubkeySchema = z.string()
  .length(44) // Solana pubkeys are exactly 44 characters in base58
  .regex(base58Regex, "Invalid base58 format")
  .refine(isValidSolanaPubkey, "Invalid Solana public key");

// ✅ SECURITY: Nonce validation (32 hex characters)
const nonceSchema = z.string()
  .length(32)
  .regex(/^[0-9a-f]{32}$/, "Invalid nonce format");

// ✅ SECURITY: Signature validation
const signatureSchema = z.string()
  .regex(base58Regex, "Invalid signature format")
  .min(87) // Ed25519 signatures are typically 87-88 chars in base58
  .max(88);

// =====================================================================
// ROUTES
// =====================================================================

// GET /me - Get current user info
app.get("/me", async (req, res) => {
  const u = (req as any).user as JwtUser | undefined;
  if (!u) {
    return res.status(200).json({ ok: true, user: null });
  }

  try {
    const row = await pool.query(
      `SELECT id, pubkey, username, created_at FROM users WHERE id = $1`,
      [u.id]
    );
    if (!row.rowCount) {
      return res.status(200).json({ ok: true, user: null });
    }
    res.json({ ok: true, user: row.rows[0] });
  } catch (e) {
    logError("GET /me", e);
    return res.status(200).json({ ok: true, user: null });
  }
});

// POST /auth/siws/start - Start SIWS authentication
app.post("/auth/siws/start", authLimiter, async (req, res) => {
  const schema = z.object({
    pubkey: pubkeySchema
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid public key" });
  }
  const { pubkey } = parsed.data;

  const nonce = randomUUID().replace(/-/g, "");
  const issuedAt = now().toISOString();
  const message = buildMessage(APP_ORIGIN, pubkey, nonce, issuedAt);
  const expires = addMinutes(now(), 5).toISOString();

  try {
    await pool.query(
      `INSERT INTO siws_nonces (nonce, pubkey, message, expires_at, issued_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nonce) DO UPDATE SET pubkey = EXCLUDED.pubkey, message = EXCLUDED.message, expires_at = EXCLUDED.expires_at`,
      [nonce, pubkey, message, expires, issuedAt]
    );

    res.json({ nonce, message });
  } catch (e) {
    logError("POST /auth/siws/start", e);
    res.status(500).json({ error: "Failed to create nonce" });
  }
});

// POST /auth/siws/finish - Complete SIWS authentication
app.post("/auth/siws/finish", authLimiter, async (req, res) => {
  const schema = z.object({
    pubkey: pubkeySchema,
    nonce: nonceSchema,
    signatureBase58: signatureSchema
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid parameters" });
  }
  const { pubkey, nonce, signatureBase58 } = parsed.data;

  try {
    const q = await pool.query(
      `SELECT message, expires_at, pubkey AS npk FROM siws_nonces WHERE nonce = $1`,
      [nonce]
    );
    if (!q.rowCount) {
      return res.status(400).json({ error: "Nonce not found" });
    }

    const row = q.rows[0];
    if (row.npk !== pubkey) {
      return res.status(400).json({ error: "Nonce/pubkey mismatch" });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Nonce expired" });
    }

    const msgBytes = new TextEncoder().encode(row.message);
    const sig = bs58.decode(signatureBase58);
    const pk = bs58.decode(pubkey);

    const ok = nacl.sign.detached.verify(msgBytes, sig, pk);
    if (!ok) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Upsert user
    let userId: string | undefined;
    const u = await pool.query(`SELECT id FROM users WHERE pubkey = $1`, [pubkey]);
    if (u.rowCount) {
      userId = u.rows[0].id;
    } else {
      userId = randomUUID();
      await pool.query(`INSERT INTO users (id, pubkey) VALUES ($1, $2)`, [userId, pubkey]);
    }

    // Consume nonce
    await pool.query(`DELETE FROM siws_nonces WHERE nonce = $1`, [nonce]);

    // Set session
    setSession(res, { id: userId!, pubkey });
    const full = await pool.query(
      `SELECT id, pubkey, username, created_at FROM users WHERE id = $1`,
      [userId]
    );
    res.json({ ok: true, user: full.rows[0] });
  } catch (e) {
    logError("POST /auth/siws/finish", e);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// POST /auth/logout - Logout
app.post("/auth/logout", async (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// POST /user/username - Set username
app.post("/user/username", async (req, res) => {
  const user = (req as any).user as JwtUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const schema = z.object({
    username: z.string().regex(/^[a-z0-9_]{3,20}$/i)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid username" });
  }

  const name = parsed.data.username.trim();
  try {
    await pool.query(`UPDATE users SET username = $1 WHERE id = $2`, [name, user.id]);
    const full = await pool.query(
      `SELECT id, pubkey, username, created_at FROM users WHERE id = $1`,
      [user.id]
    );
    res.json({ ok: true, user: full.rows[0] });
  } catch (e: any) {
    if (e?.code === "23505") {
      return res.status(409).json({ error: "Username taken" });
    }
    logError("POST /user/username", e);
    res.status(500).json({ error: "Failed to update username" });
  }
});

// GET /comments - Get comments for a market
app.get("/comments", async (req, res) => {
  const marketId = req.query.marketId as string;
  if (!marketId || typeof marketId !== "string" || marketId.trim().length === 0) {
    return res.status(400).json({ error: "marketId query parameter is required" });
  }

  // ✅ SECURITY: Validate marketId length
  if (marketId.length > 100) {
    return res.status(400).json({ error: "marketId too long" });
  }

  try {
    const result = await pool.query(
      `SELECT 
        c.id,
        c.market_id as "marketId",
        c.comment_text as "commentText",
        c.created_at as "createdAt",
        u.username,
        u.pubkey as "walletAddress"
      FROM comments c
      INNER JOIN users u ON c.user_id = u.id
      WHERE c.market_id = $1
      ORDER BY c.created_at ASC`,
      [marketId.trim()]
    );

    res.json({
      comments: result.rows.map(row => ({
        id: row.id,
        marketId: row.marketId,
        commentText: row.commentText,
        createdAt: row.createdAt.toISOString(),
        username: row.username,
        walletAddress: row.walletAddress
      }))
    });
  } catch (e) {
    logError("GET /comments", e);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// POST /comments - Create a comment
app.post("/comments", commentLimiter, async (req, res) => {
  const user = (req as any).user as JwtUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ✅ SECURITY: Strengthened validation with length limits
  const schema = z.object({
    marketId: z.string().min(1).max(100),
    commentText: z.string().min(1).max(500)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid marketId or commentText" });
  }

  const { marketId, commentText } = parsed.data;
  const trimmedText = commentText.trim();
  const trimmedMarketId = marketId.trim();

  if (trimmedText.length === 0) {
    return res.status(400).json({ error: "Comment cannot be empty" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO comments (market_id, user_id, comment_text)
       VALUES ($1, $2, $3)
       RETURNING id, market_id, comment_text, created_at`,
      [trimmedMarketId, user.id, trimmedText]
    );

    const userResult = await pool.query(
      `SELECT username, pubkey FROM users WHERE id = $1`,
      [user.id]
    );

    const comment = result.rows[0];
    const userRow = userResult.rows[0];

    res.json({
      id: comment.id,
      marketId: comment.market_id,
      commentText: comment.comment_text,
      createdAt: comment.created_at.toISOString(),
      username: userRow.username,
      walletAddress: userRow.pubkey
    });
  } catch (e) {
    logError("POST /comments", e);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// GET /health - Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// =====================================================================
// SERVER STARTUP
// =====================================================================

migrate().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ API listening on http://localhost:${PORT}  (CORS: ${APP_ORIGIN})`);
    if (DATABASE_URL && !DATABASE_URL.includes("REPLACE_WITH")) {
      console.log(`✅ Database: connected`);
    } else {
      console.log(`⚠️  Database: not configured (update DATABASE_URL in .env)`);
    }
    console.log("");

    // ✅ SECURITY: Start nonce cleanup job
    // Run immediately on startup
    cleanupExpiredNonces();
    // Run every hour
    setInterval(cleanupExpiredNonces, 60 * 60 * 1000);
    console.log("✅ Nonce cleanup job: started (runs hourly)");
  });
}).catch((e) => {
  console.error("\n❌ Migration failed:", e.message);
  console.error("\nTo fix this:");
  console.error("1. Update DATABASE_URL in server/.env with your Supabase connection string");
  console.error("2. Make sure REPLACE_WITH_DB_PASSWORD is replaced with your actual password");
  console.error("3. Then restart the server: npm run dev\n");
  process.exit(1);
});

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { Pool } from "pg";
import nacl from "tweetnacl";
import bs58 from "bs58";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

// --- env
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:8080";
const ALLOWED_ORIGINS = APP_ORIGIN.split(",").map(o => o.trim());
const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

// --- db
const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  // Retry connection on failure
  connectionTimeoutMillis: 5000,
});

// Test database connection
async function testConnection() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (e) {
    console.error("Database connection failed:", e);
    return false;
  }
}

// create tables on boot
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

  // Create users table (for SIWS authentication)
  // Note: This is separate from Supabase's profiles table
  // We use pubkey as the unique identifier for wallet-based auth
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pubkey    text NOT NULL UNIQUE,
      username  text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // case-insensitive uniqueness
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_pubkey_idx ON users (pubkey);`);

  // Create SIWS nonces table for authentication flow
  await pool.query(`
    CREATE TABLE IF NOT EXISTS siws_nonces (
      nonce      text PRIMARY KEY,
      pubkey     text NOT NULL,
      message    text NOT NULL,
      issued_at  timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `);

  // Create index for cleanup of expired nonces
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

  // Create index for faster queries by market_id
  await pool.query(`CREATE INDEX IF NOT EXISTS comments_market_id_idx ON comments (market_id);`);
  // Create index for faster queries by user_id
  await pool.query(`CREATE INDEX IF NOT EXISTS comments_user_id_idx ON comments (user_id);`);
}

type JwtUser = { id: string; pubkey: string };

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
function clearSession(res: express.Response) {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("sid", {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction
  });
}
function authMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const tok = req.cookies?.sid;
  if (tok) {
    try { (req as any).user = jwt.verify(tok, SESSION_SECRET) as JwtUser; } catch { }
  }
  next();
}

// --- app
const app = express();
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
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(authMiddleware);

// util
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

// --- routes
app.get("/me", async (req, res) => {
  const u = (req as any).user as JwtUser | undefined;
  if (!u) {
    // No auth - return guest state, never 401
    return res.status(200).json({ ok: true, user: null });
  }

  try {
    const row = await pool.query(`SELECT id, pubkey, username, created_at FROM users WHERE id = $1`, [u.id]);
    if (!row.rowCount) {
      // User in token but not in DB - treat as guest
      return res.status(200).json({ ok: true, user: null });
    }
    res.json({ ok: true, user: row.rows[0] });
  } catch (e) {
    // Database error - treat as guest rather than failing
    console.error("[GET /me] Database error:", e);
    return res.status(200).json({ ok: true, user: null });
  }
});

app.post("/auth/siws/start", async (req, res) => {
  const schema = z.object({ pubkey: z.string().min(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad pubkey" });
  const { pubkey } = parsed.data;

  const nonce = randomUUID().replace(/-/g, "");
  const issuedAt = now().toISOString();
  const message = buildMessage(APP_ORIGIN, pubkey, nonce, issuedAt);
  const expires = addMinutes(now(), 5).toISOString();

  await pool.query(
    `INSERT INTO siws_nonces (nonce, pubkey, message, expires_at, issued_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nonce) DO UPDATE SET pubkey = EXCLUDED.pubkey, message = EXCLUDED.message, expires_at = EXCLUDED.expires_at`,
    [nonce, pubkey, message, expires, issuedAt]
  );

  res.json({ nonce, message });
});

app.post("/auth/siws/finish", async (req, res) => {
  const schema = z.object({
    pubkey: z.string().min(10),
    nonce: z.string().min(8),
    signatureBase58: z.string().min(10)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad params" });
  const { pubkey, nonce, signatureBase58 } = parsed.data;

  const q = await pool.query(`SELECT message, expires_at, pubkey AS npk FROM siws_nonces WHERE nonce = $1`, [nonce]);
  if (!q.rowCount) return res.status(400).json({ error: "nonce not found" });
  const row = q.rows[0];
  if (row.npk !== pubkey) return res.status(400).json({ error: "nonce/pubkey mismatch" });
  if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: "nonce expired" });

  const msgBytes = new TextEncoder().encode(row.message);
  const sig = bs58.decode(signatureBase58);
  const pk = bs58.decode(pubkey);

  const ok = nacl.sign.detached.verify(msgBytes, sig, pk);
  if (!ok) return res.status(400).json({ error: "invalid signature" });

  // upsert user
  let userId: string | undefined;
  const u = await pool.query(`SELECT id FROM users WHERE pubkey = $1`, [pubkey]);
  if (u.rowCount) {
    userId = u.rows[0].id;
  } else {
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, pubkey) VALUES ($1, $2)`, [userId, pubkey]);
  }

  // consume nonce
  await pool.query(`DELETE FROM siws_nonces WHERE nonce = $1`, [nonce]);

  // set session
  setSession(res, { id: userId!, pubkey });
  const full = await pool.query(`SELECT id, pubkey, username, created_at FROM users WHERE id = $1`, [userId]);
  res.json({ ok: true, user: full.rows[0] });
});

app.post("/auth/logout", async (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.post("/user/username", async (req, res) => {
  const user = (req as any).user as JwtUser | undefined;
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const schema = z.object({ username: z.string().regex(/^[a-z0-9_]{3,20}$/i) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid username" });

  const name = parsed.data.username.trim();
  try {
    await pool.query(`UPDATE users SET username = $1 WHERE id = $2`, [name, user.id]);
  } catch (e: any) {
    // unique violation
    if (e?.code === "23505") return res.status(409).json({ error: "username taken" });
    throw e;
  }
  const full = await pool.query(`SELECT id, pubkey, username, created_at FROM users WHERE id = $1`, [user.id]);
  res.json({ ok: true, user: full.rows[0] });
});

// Comments endpoints
app.get("/comments", async (req, res) => {
  const marketId = req.query.marketId as string;
  if (!marketId || typeof marketId !== "string" || marketId.trim().length === 0) {
    return res.status(400).json({ error: "marketId query parameter is required" });
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
  } catch (e: any) {
    console.error("Error fetching comments:", e);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

app.post("/comments", async (req, res) => {
  const user = (req as any).user as JwtUser | undefined;
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const schema = z.object({
    marketId: z.string().min(1),
    commentText: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "marketId and commentText are required and must be non-empty" });
  }

  const { marketId, commentText } = parsed.data;
  const trimmedText = commentText.trim();
  const trimmedMarketId = marketId.trim();

  if (trimmedText.length === 0) {
    return res.status(400).json({ error: "commentText cannot be empty" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO comments (market_id, user_id, comment_text)
       VALUES ($1, $2, $3)
       RETURNING id, market_id, comment_text, created_at`,
      [trimmedMarketId, user.id, trimmedText]
    );

    // Fetch the user info to include in response
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
  } catch (e: any) {
    console.error("Error creating comment:", e);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// boot
migrate().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ API listening on http://localhost:${PORT}  (CORS: ${APP_ORIGIN})`);
    if (DATABASE_URL && !DATABASE_URL.includes("REPLACE_WITH")) {
      console.log(`✅ Database: connected`);
    } else {
      console.log(`⚠️  Database: not configured (update DATABASE_URL in .env)`);
    }
    console.log("");
  });
}).catch((e) => {
  console.error("\n❌ Migration failed:", e.message);
  console.error("\nTo fix this:");
  console.error("1. Update DATABASE_URL in server/.env with your Supabase connection string");
  console.error("2. Make sure REPLACE_WITH_DB_PASSWORD is replaced with your actual password");
  console.error("3. Then restart the server: npm run dev\n");
  process.exit(1);
});


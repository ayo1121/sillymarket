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
export const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Validate SESSION_SECRET in production
if (IS_PRODUCTION && (!SESSION_SECRET || SESSION_SECRET === "dev-secret")) {
    throw new Error("SESSION_SECRET must be set to a strong value in production");
}
if (!IS_PRODUCTION && SESSION_SECRET === "dev-secret") {
    console.warn("⚠️  Using weak SESSION_SECRET in development. Set SESSION_SECRET in .env for production.");
}

// =====================================================================
// ENVIRONMENT VALIDATION
// =====================================================================

function validateEnv() {
    const required = ["DATABASE_URL", "SESSION_SECRET", "APP_ORIGIN"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        // Only warn in test environment to avoid crashing tests if env not fully set
        if (process.env.NODE_ENV !== 'test') {
            throw new Error(
                `Missing required environment variables: ${missing.join(", ")}`
            );
        }
    }
}

validateEnv();

// =====================================================================
// SECURITY HELPERS
// =====================================================================

function isValidSolanaPubkey(pubkey: string): boolean {
    try {
        const decoded = bs58.decode(pubkey);
        return decoded.length === 32;
    } catch {
        return false;
    }
}

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

export const pool = new Pool({
    connectionString: DATABASE_URL || undefined,
    connectionTimeoutMillis: 5000,
});

export async function testConnection() {
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

export async function migrate() {
    if (!DATABASE_URL || DATABASE_URL.includes("REPLACE_WITH")) {
        console.warn("⚠️  DATABASE_URL contains placeholders. Server will start but database features will not work.");
        return;
    }

    // Skip connection test in test environment if no DB URL
    if (process.env.NODE_ENV === 'test' && !DATABASE_URL) return;

    const connected = await testConnection();
    if (!connected) {
        throw new Error(`Cannot connect to PostgreSQL at ${DATABASE_URL ? new URL(DATABASE_URL).host : "localhost:5432"}. Make sure PostgreSQL is running.`);
    }

    try {
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

export async function cleanupExpiredNonces() {
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

const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many authentication attempts, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
});

const commentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: "Too many comments, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
});

// =====================================================================
// EXPRESS APP SETUP
// =====================================================================

const app = express();

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
    },
}));

app.use(generalLimiter);

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) {
                if (IS_PRODUCTION) {
                    console.warn("[CORS] Rejected request with no origin header");
                    return callback(new Error("Origin header required"));
                }
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

const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;

const pubkeySchema = z.string()
    .length(44)
    .regex(base58Regex, "Invalid base58 format")
    .refine(isValidSolanaPubkey, "Invalid Solana public key");

const nonceSchema = z.string()
    .length(32)
    .regex(/^[0-9a-f]{32}$/, "Invalid nonce format");

const signatureSchema = z.string()
    .regex(base58Regex, "Invalid signature format")
    .min(87)
    .max(88);

// =====================================================================
// ROUTES
// =====================================================================

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

        let userId: string | undefined;
        const u = await pool.query(`SELECT id FROM users WHERE pubkey = $1`, [pubkey]);
        if (u.rowCount) {
            userId = u.rows[0].id;
        } else {
            userId = randomUUID();
            await pool.query(`INSERT INTO users (id, pubkey) VALUES ($1, $2)`, [userId, pubkey]);
        }

        await pool.query(`DELETE FROM siws_nonces WHERE nonce = $1`, [nonce]);

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

app.post("/auth/logout", async (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
});

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

app.get("/comments", async (req, res) => {
    const marketId = req.query.marketId as string;
    if (!marketId || typeof marketId !== "string" || marketId.trim().length === 0) {
        return res.status(400).json({ error: "marketId query parameter is required" });
    }

    if (marketId.length > 100) {
        return res.status(400).json({ error: "marketId too long" });
    }

    // Pagination support
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

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
      ORDER BY c.created_at ASC
      LIMIT $2 OFFSET $3`,
            [marketId.trim(), limit, offset]
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

app.post("/comments", commentLimiter, async (req, res) => {
    const user = (req as any).user as JwtUser | undefined;
    if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const schema = z.object({
        marketId: z.string().min(1).max(100),
        commentText: z.string().min(1).max(500)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid marketId or commentText" });
    }

    const { marketId, commentText } = parsed.data;
    // Strip HTML tags for XSS protection
    const sanitizedText = commentText.replace(/<[^>]*>/g, '').trim();
    const trimmedMarketId = marketId.trim();

    if (sanitizedText.length === 0) {
        return res.status(400).json({ error: "Comment cannot be empty" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO comments (market_id, user_id, comment_text)
       VALUES ($1, $2, $3)
       RETURNING id, market_id, comment_text, created_at`,
            [trimmedMarketId, user.id, sanitizedText]
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

// =====================================================================
// ANALYTICS EVENTS
// =====================================================================

const eventsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 50, // 50 events per minute per IP
    message: { error: "Too many events, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post("/events", eventsLimiter, async (req, res) => {
    const user = (req as any).user as JwtUser | undefined;

    const schema = z.object({
        eventType: z.string().min(1).max(100),
        eventProperties: z.record(z.any()).optional(),
        page: z.string().max(500).optional(),
        marketPubkey: z.string().max(100).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid event data" });
    }

    const { eventType, eventProperties, page, marketPubkey } = parsed.data;

    try {
        // Get session ID from cookie or generate one
        let sessionId = req.cookies?.session_id;
        if (!sessionId) {
            sessionId = randomUUID();
            res.cookie("session_id", sessionId, {
                httpOnly: true,
                sameSite: IS_PRODUCTION ? "none" : "lax",
                secure: IS_PRODUCTION,
                maxAge: 30 * 24 * 3600 * 1000 // 30 days
            });
        }

        // Insert event into database
        await pool.query(
            `INSERT INTO frontend_events (user_pubkey, event_type, event_properties, page, market_pubkey, session_id, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                user?.pubkey || null,
                eventType,
                eventProperties ? JSON.stringify(eventProperties) : null,
                page || null,
                marketPubkey || null,
                sessionId,
                req.headers["user-agent"] || null
            ]
        );

        res.json({ ok: true });
    } catch (e) {
        logError("POST /events", e);
        res.status(500).json({ error: "Failed to log event" });
    }
});

// =====================================================================
// MARKET METADATA
// =====================================================================

const marketMetadataLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 market metadata writes per minute
    message: { error: "Too many market creations, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post("/markets/metadata", marketMetadataLimiter, async (req, res) => {
    const user = (req as any).user as JwtUser | undefined;

    if (!user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const schema = z.object({
        marketPubkey: z.string().min(32).max(44),
        question: z.string().min(1).max(500),
        creatorWallet: z.string().refine(isValidSolanaPubkey, "Invalid Solana pubkey"),
        creatorName: z.string().max(100).optional(),
        imageUrl: z.string().max(1000).optional(),
        answers: z.array(z.string().max(200)).min(2).max(10),
        description: z.string().max(2000).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid market metadata", details: parsed.error.errors });
    }

    const { marketPubkey, question, creatorWallet, creatorName, imageUrl, answers, description } = parsed.data;

    // Verify creator wallet matches authenticated user
    if (creatorWallet !== user.pubkey) {
        return res.status(403).json({ error: "Creator wallet must match authenticated user" });
    }

    try {
        await pool.query(
            `INSERT INTO markets (market_pubkey, question, creator_wallet, creator_name, image_url, answers, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (market_pubkey) DO UPDATE
       SET question = EXCLUDED.question,
           creator_name = EXCLUDED.creator_name,
           image_url = EXCLUDED.image_url,
           answers = EXCLUDED.answers,
           description = EXCLUDED.description`,
            [
                marketPubkey,
                question,
                creatorWallet,
                creatorName || null,
                imageUrl || null,
                JSON.stringify(answers),
                description || null
            ]
        );

        res.json({ ok: true });
    } catch (e) {
        logError("POST /markets/metadata", e);
        res.status(500).json({ error: "Failed to save market metadata" });
    }
});

// =====================================================================
// NOTIFICATIONS
// =====================================================================

app.get("/notifications", async (req, res) => {
    const user = (req as any).user as JwtUser | undefined;

    if (!user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try {
        const result = await pool.query(
            `SELECT id, type, title, body, metadata, is_read, created_at
       FROM notifications
       WHERE user_pubkey = $1
       ORDER BY created_at DESC
       LIMIT 100`,
            [user.pubkey]
        );

        const notifications = result.rows.map(row => ({
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            metadata: row.metadata || {},
            is_read: row.is_read,
            created_at: row.created_at
        }));

        res.json({ notifications });
    } catch (e) {
        logError("GET /notifications", e);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});

const notificationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 mark-read operations per minute
    message: { error: "Too many requests" },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post("/notifications/mark-read", notificationLimiter, async (req, res) => {
    const user = (req as any).user as JwtUser | undefined;

    if (!user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const schema = z.object({
        id: z.string().uuid(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid notification ID" });
    }

    const { id } = parsed.data;

    try {
        // Verify notification belongs to user and update
        const result = await pool.query(
            `UPDATE notifications
       SET is_read = true
       WHERE id = $1 AND user_pubkey = $2
       RETURNING id`,
            [id, user.pubkey]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Notification not found or access denied" });
        }

        res.json({ ok: true });
    } catch (e) {
        logError("POST /notifications/mark-read", e);
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

export default app;

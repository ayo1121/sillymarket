/**
 * HTTP Wrapper for Silly Character Soul
 * 
 * This server wraps the OpenSouls engine and exposes a simple HTTP API
 * for the main SillyMarket backend to communicate with the soul.
 * 
 * Endpoints:
 * - GET /health -> { ok: true }
 * - POST /chat -> { sessionId, message } -> { sessionId, reply }
 */

import { Soul, said } from "@opensouls/soul";

const PORT = Number(process.env.PORT) || 4310;
const SOUL_ENGINE_TOKEN = process.env.SOUL_ENGINE_TOKEN || "";

// Store active soul sessions
const sessions = new Map<string, Soul>();

// Validate auth header
function validateAuth(request: Request): boolean {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !SOUL_ENGINE_TOKEN) return false;

    const [type, token] = authHeader.split(" ");
    return type === "Bearer" && token === SOUL_ENGINE_TOKEN;
}

// Get or create a soul session
async function getOrCreateSession(sessionId: string): Promise<Soul> {
    let soul = sessions.get(sessionId);

    if (!soul) {
        soul = new Soul({
            organization: "sillymarket",
            blueprint: "silly-character",
            soulId: sessionId,
            local: true,
            debug: false,
        });

        await soul.connect();
        sessions.set(sessionId, soul);
    }

    return soul;
}

// Generate a simple session ID
function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Main server
const server = Bun.serve({
    port: PORT,

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // CORS headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        // Handle preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Health check (no auth required)
        if (url.pathname === "/health" && request.method === "GET") {
            return Response.json({ ok: true }, { headers: corsHeaders });
        }

        // All other endpoints require auth
        if (!validateAuth(request)) {
            return Response.json(
                { error: "Unauthorized" },
                { status: 401, headers: corsHeaders }
            );
        }

        // Chat endpoint
        if (url.pathname === "/chat" && request.method === "POST") {
            try {
                const body = await request.json() as {
                    sessionId?: string;
                    userId?: string;
                    message: string;
                };

                if (!body.message || typeof body.message !== "string") {
                    return Response.json(
                        { error: "message is required" },
                        { status: 400, headers: corsHeaders }
                    );
                }

                const sessionId = body.sessionId || generateSessionId();
                const soul = await getOrCreateSession(sessionId);

                // Send user message to soul
                soul.dispatch(said("User", body.message));

                // Wait for soul response (with timeout)
                const reply = await new Promise<string>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        resolve("hmm, I'm having trouble thinking right now. try again? 🤔");
                    }, 15000);

                    soul.on("says", async (event) => {
                        clearTimeout(timeout);
                        const content = await event.content();
                        resolve(content);
                    });
                });

                return Response.json(
                    { sessionId, reply },
                    { headers: corsHeaders }
                );
            } catch (error) {
                console.error("Chat error:", error);
                return Response.json(
                    { error: "Internal server error" },
                    { status: 500, headers: corsHeaders }
                );
            }
        }

        // 404 for unknown routes
        return Response.json(
            { error: "Not found" },
            { status: 404, headers: corsHeaders }
        );
    },
});

console.log(`🧠 Silly Character Soul Server running on http://localhost:${PORT}`);
console.log(`   Health: GET /health`);
console.log(`   Chat:   POST /chat`);

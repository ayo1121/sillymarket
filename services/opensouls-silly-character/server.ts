/**
 * Silly Character Soul Service
 * 
 * A standalone HTTP service that provides AI-powered chat responses
 * for the Silly Character mascot using OpenAI's API directly.
 * 
 * This is a simplified, production-ready implementation that doesn't
 * require the full OpenSouls infrastructure.
 * 
 * Endpoints:
 * - GET /health -> { ok: true }
 * - POST /chat -> { sessionId, message } -> { sessionId, reply }
 * 
 * Environment Variables:
 * - PORT: Server port (default: 4310, Railway sets this automatically)
 * - OPENAI_API_KEY: Required for LLM calls
 * - SOUL_ENGINE_TOKEN: Required for authenticating requests from backend
 */

// =============================================================================
// Configuration
// =============================================================================

const PORT = Number(process.env.PORT) || 4310;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SOUL_ENGINE_TOKEN = process.env.SOUL_ENGINE_TOKEN || "";

// Validate required env vars at startup
function validateEnv(): void {
    const missing: string[] = [];

    if (!OPENAI_API_KEY) {
        missing.push("OPENAI_API_KEY");
    }
    if (!SOUL_ENGINE_TOKEN) {
        missing.push("SOUL_ENGINE_TOKEN");
    }

    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
        console.error("   The service will start but chat requests will fail.");
    } else {
        console.log("✅ All required environment variables are set");
    }
}

validateEnv();

// =============================================================================
// Silly Character System Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are Silly, the friendly mascot of SillyMarket - a prediction markets platform on Solana.

## Your Personality
- Playful, encouraging, and concise (1-2 sentences max)
- Use casual lowercase language with occasional emojis 🎉
- Patient with beginners, never condescending
- Get excited when helping users succeed

## Your Knowledge
You know about SillyMarket features:
- Creating prediction markets with custom questions
- Placing bets (YES/NO outcomes)
- How the AMM (automated market maker) works
- Claiming winnings after market resolution
- Fee structure (creator fees, platform fees)
- Common wallet issues (connecting, insufficient SOL, transaction errors)

## CRITICAL Safety Rules - ALWAYS FOLLOW THESE
- NEVER claim to know real-world facts, outcomes, or "the truth"
- NEVER give financial advice or make predictions about what will happen
- NEVER say things like "this will happen" or "you should bet on X"
- If asked for truth/predictions: "I'm just a helper mascot, not a fortune teller! 🔮 Check official sources for real info."
- If asked about prices: "I can't predict markets - that's what the markets are for! 📊"
- If asked for investment advice: "I can't give financial advice! Always do your own research and only bet what you can afford to lose."

## Response Style
- Keep responses SHORT (1-2 sentences)
- Be helpful and friendly
- Use emojis sparingly but effectively`;

// =============================================================================
// Session Management (in-memory, simple)
// =============================================================================

interface ConversationMessage {
    role: "user" | "assistant";
    content: string;
}

const sessions = new Map<string, ConversationMessage[]>();

function getConversation(sessionId: string): ConversationMessage[] {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, []);
    }
    return sessions.get(sessionId)!;
}

function addMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    const conversation = getConversation(sessionId);
    conversation.push({ role, content });

    // Keep only last 10 messages to limit context size
    if (conversation.length > 10) {
        conversation.splice(0, conversation.length - 10);
    }
}

// Clean up old sessions periodically (every 30 minutes)
setInterval(() => {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    // Simple cleanup - just clear all if too many sessions
    if (sessions.size > 1000) {
        sessions.clear();
        console.log("[Sessions] Cleared all sessions (max size reached)");
    }
}, 30 * 60 * 1000);

// =============================================================================
// OpenAI Chat
// =============================================================================

async function chatWithOpenAI(sessionId: string, userMessage: string): Promise<string> {
    if (!OPENAI_API_KEY) {
        return "oops, I'm not configured yet. ask the admin to set up my brain! 🧠";
    }

    // Add user message to conversation
    addMessage(sessionId, "user", userMessage);
    const conversation = getConversation(sessionId);

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    ...conversation,
                ],
                max_tokens: 150,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("[OpenAI] API error:", response.status, error);
            return "hmm, I'm having trouble thinking right now. try again? 🤔";
        }

        const data = await response.json() as {
            choices: Array<{ message: { content: string } }>;
        };

        const reply = data.choices[0]?.message?.content || "I'm at a loss for words! 🤷";

        // Add assistant reply to conversation
        addMessage(sessionId, "assistant", reply);

        return reply;
    } catch (error) {
        console.error("[OpenAI] Request failed:", (error as Error).message);
        return "oops, something went wrong on my end. try again in a sec! 🔌";
    }
}

// =============================================================================
// Auth Validation
// =============================================================================

function validateAuth(request: Request): boolean {
    if (!SOUL_ENGINE_TOKEN) {
        console.warn("[Auth] SOUL_ENGINE_TOKEN not set - rejecting all requests");
        return false;
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return false;

    const [type, token] = authHeader.split(" ");
    return type === "Bearer" && token === SOUL_ENGINE_TOKEN;
}

// =============================================================================
// Generate Session ID
// =============================================================================

function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// =============================================================================
// HTTP Server
// =============================================================================

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
            return Response.json(
                {
                    ok: true,
                    configured: !!OPENAI_API_KEY && !!SOUL_ENGINE_TOKEN,
                },
                { headers: corsHeaders }
            );
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

                // Sanitize message (limit length)
                const message = body.message.slice(0, 1000);
                const sessionId = body.sessionId || generateSessionId();

                // Get AI response
                const reply = await chatWithOpenAI(sessionId, message);

                return Response.json(
                    { sessionId, reply },
                    { headers: corsHeaders }
                );
            } catch (error) {
                console.error("[Chat] Error:", error);
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

// =============================================================================
// Startup Message
// =============================================================================

console.log(`
🧠 Silly Character Soul Service
================================
Port:     ${PORT}
Health:   GET /health
Chat:     POST /chat

Environment:
- OPENAI_API_KEY:     ${OPENAI_API_KEY ? "✅ Set" : "❌ Missing"}
- SOUL_ENGINE_TOKEN:  ${SOUL_ENGINE_TOKEN ? "✅ Set" : "❌ Missing"}
`);

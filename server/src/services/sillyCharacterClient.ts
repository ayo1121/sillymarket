/**
 * Silly Character Client
 * 
 * HTTP client for communicating with the OpenSouls Silly Character service.
 * This client is fail-safe - it returns a graceful fallback on any error.
 */

const SOUL_ENGINE_URL = process.env.SOUL_ENGINE_URL || "http://localhost:4310";
const SOUL_ENGINE_TOKEN = process.env.SOUL_ENGINE_TOKEN || "";
const ENABLE_SILLY_CHARACTER = process.env.ENABLE_SILLY_CHARACTER === "true";

// Timeout for soul service requests (8 seconds)
const REQUEST_TIMEOUT_MS = 8000;

export interface ChatRequest {
    sessionId?: string;
    userId?: string;
    message: string;
}

export interface ChatResponse {
    sessionId: string;
    reply: string;
    disabled?: boolean;
}

/**
 * Check if the Silly Character feature is enabled and configured
 */
export function isEnabled(): boolean {
    return ENABLE_SILLY_CHARACTER && !!SOUL_ENGINE_URL && !!SOUL_ENGINE_TOKEN;
}

/**
 * Check the health of the soul service
 * Returns true if healthy, false otherwise
 */
export async function healthCheck(): Promise<boolean> {
    if (!isEnabled()) return false;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(`${SOUL_ENGINE_URL}/health`, {
            method: "GET",
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Send a chat message to the Silly Character
 * Always returns a response - never throws
 */
export async function chat(request: ChatRequest): Promise<ChatResponse> {
    // Return disabled response if feature is off
    if (!isEnabled()) {
        return {
            sessionId: request.sessionId || "disabled",
            reply: "Silly Character is currently offline.",
            disabled: true,
        };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(`${SOUL_ENGINE_URL}/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SOUL_ENGINE_TOKEN}`,
            },
            body: JSON.stringify(request),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[SillyCharacter] Soul service returned ${response.status}`);
            return {
                sessionId: request.sessionId || "error",
                reply: "oops, I'm having a little trouble right now. try again in a moment? 🤔",
                disabled: false,
            };
        }

        const data = await response.json() as { sessionId: string; reply: string };
        return {
            sessionId: data.sessionId,
            reply: data.reply,
            disabled: false,
        };
    } catch (error) {
        // Log error but don't expose details
        console.error("[SillyCharacter] Failed to reach soul service:", (error as Error).message);
        return {
            sessionId: request.sessionId || "error",
            reply: "hmm, I'm having some connection issues. try again in a sec! 🔌",
            disabled: false,
        };
    }
}

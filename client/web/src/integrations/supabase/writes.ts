import { supabase } from "./client";

/**
 * Save market metadata to Supabase after creating on-chain.
 */
export async function saveMarketMetadata(params: {
    marketPubkey: string;
    question: string;
    description: string;
    creatorWallet: string;
    creatorName: string | null;
    imageUrl: string | null;
    answers: string;
    outcomeLabels: Record<string, string>;
}) {
    const { error } = await supabase.from("markets").insert({
        market_pubkey: params.marketPubkey,
        question: params.question,
        description: params.description || null, // DB allows null
        creator_wallet: params.creatorWallet || null, // DB allows null
        creator_name: params.creatorName,
        image_url: params.imageUrl,
        answers: params.answers,
        outcome_labels: params.outcomeLabels,
    });

    if (error) {
        console.error("[Supabase] saveMarketMetadata error:", {
            message: error.message,
            code: error.code,
            details: error.details,
            marketPubkey: params.marketPubkey
        });
        throw error;
    }

    console.log("[Supabase] Market metadata saved:", params.marketPubkey);
}


/**
 * Upsert user profile when a wallet connects / username changes.
 */
export async function upsertUser(pubkey: string, username?: string) {
    // NOTE: We are NOT checking for a session here because we use custom SIWS
    // and RLS policies are set to allow/deny based on other factors (or disabled for now).
    // For 'users' table, we might not have anon write access, so we catch errors gracefully.

    const payload: any = { pubkey };
    if (username) {
        payload.username = username;
    }

    const { error } = await supabase
        .from("users")
        .upsert(
            payload,
            { onConflict: "pubkey" },
        );

    if (error) {
        // Log but don't throw, as this is often expected if RLS denies anon writes
        console.warn("[Supabase] upsertUser failed (likely RLS denied):", {
            message: error.message,
            code: error.code,
            details: error.details
        });
        return;
    }

    console.log("[Supabase] upsertUser success for", pubkey);
}

/**
 * Post a comment on a market.
 */
export async function postComment(params: {
    marketId: string;
    userId: string;
    commentText: string;
}) {
    const { error } = await supabase.from("comments").insert({
        market_id: params.marketId,
        user_id: params.userId,
        comment_text: params.commentText,
    });

    if (error) {
        console.error("[Supabase] postComment error:", {
            message: error.message,
            code: error.code,
            details: error.details,
            marketId: params.marketId
        });
        throw error;
    }
}

/**
 * Create a notification entry.
 */
export async function createNotification(params: {
    userPubkey: string;
    type: string;
    title: string;
    body?: string;
    metadata?: Record<string, any>;
}) {
    // NOTE: No session check here. Relying on RLS.

    const { error } = await supabase.from("notifications").insert({
        user_pubkey: params.userPubkey,
        type: params.type,
        title: params.title,
        body: params.body || null,
        metadata: params.metadata || {},
        is_read: false,
    });

    if (error) {
        console.warn("[Supabase] createNotification failed (likely RLS denied):", {
            message: error.message,
            code: error.code
        });
        // Don't throw, notifications are non-critical
    }
}

/**
 * Track a frontend analytics event (non-critical).
 */
export async function trackEvent(params: {
    eventType: string;
    userPubkey?: string;
    metadata?: Record<string, any>;
    page?: string;
    marketPubkey?: string;
}) {
    const { error } = await supabase.from("frontend_events").insert({
        event_type: params.eventType,
        user_pubkey: params.userPubkey || null,
        metadata: params.metadata || {},
        page: params.page || null,
        market_pubkey: params.marketPubkey || null,
        session_id: typeof window !== "undefined"
            ? window.sessionStorage.getItem("session_id")
            : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    if (error) {
        console.error("[Supabase] Failed to track event:", error);
        // Do not throw: analytics failures must not break UX
    }
}

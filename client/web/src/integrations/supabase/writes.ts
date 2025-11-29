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
        console.error("[Supabase] Failed to save market metadata:", error);
        throw error;
    }

    console.log("[Supabase] Market metadata saved:", params.marketPubkey);
}


/**
 * Upsert user profile when a wallet connects / username changes.
 */
export async function upsertUser(pubkey: string, username?: string) {
    const { error } = await supabase
        .from("users")
        .upsert(
            {
                pubkey,
                username: username || null,
            },
            { onConflict: "pubkey" },
        );

    if (error) {
        console.error("[Supabase] Failed to upsert user:", error);
        throw error;
    }
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
        console.error("[Supabase] Failed to post comment:", error);
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
    const { error } = await supabase.from("notifications").insert({
        user_pubkey: params.userPubkey,
        type: params.type,
        title: params.title,
        body: params.body || null,
        metadata: params.metadata || {},
        is_read: false,
    });

    if (error) {
        console.error("[Supabase] Failed to create notification:", error);
        throw error;
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

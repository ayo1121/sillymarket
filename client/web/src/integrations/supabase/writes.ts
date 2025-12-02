import { supabase, isSupabaseConfigured } from "./client";

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

    if (!isSupabaseConfigured()) {
        console.warn(
            "[supabase][writes] Supabase not configured – skipping upsertUser"
        );
        return;
    }

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

    if (!isSupabaseConfigured()) {
        console.warn(
            "[supabase][writes] Supabase not configured – skipping createNotification"
        );
        return;
    }

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

/**
 * Save a bet to Supabase (Client-side fallback)
 * Used when Edge Function indexing is not available/configured.
 */
export async function saveBet(params: {
    signature: string;
    marketPubkey: string;
    bettorPubkey: string;
    outcomeIndex: number;
    outcomeLabel?: string;
    amountLamports: number;
    poolsAfter?: number[] | null;
    probsAfter?: number[] | null;
}) {
    if (!isSupabaseConfigured()) {
        console.warn("[supabase][writes] Supabase not configured – skipping saveBet");
        return;
    }

    const { error } = await supabase.from("bets").insert({
        tx_sig: params.signature,
        market_pubkey: params.marketPubkey,
        bettor_pubkey: params.bettorPubkey,
        outcome_index: params.outcomeIndex,
        outcome_label: params.outcomeLabel || null,
        amount_lamports: params.amountLamports,
        amount_sol: params.amountLamports / 1_000_000_000,
        pools_after: params.poolsAfter || null,
        probs_after: params.probsAfter || null,
        block_time: new Date().toISOString(),
    });

    if (error) {
        // Ignore duplicate key errors (if Edge Function already indexed it)
        if (error.code === "23505") {
            console.log("[Supabase] Bet already indexed (duplicate)");
            return;
        }
        console.error("[Supabase] saveBet failed:", error);
        // Don't throw, as on-chain bet succeeded
    } else {
        console.log("[Supabase] Bet saved successfully (client-side fallback)");
    }
}

/**
 * Save market resolution to Supabase (Client-side fallback)
 */
export async function saveMarketResolution(params: {
    signature: string;
    marketPubkey: string;
    winnerIndex: number;
    autoVoid: boolean;
    resolvedTotalPool?: number | null;
    resolvedWinPool?: number | null;
    feesTransferred?: number | null;
}) {
    if (!isSupabaseConfigured()) {
        console.warn("[supabase][writes] Supabase not configured – skipping saveMarketResolution");
        return;
    }

    const { error } = await supabase.from("market_resolutions").insert({
        tx_sig: params.signature,
        market_pubkey: params.marketPubkey,
        winner_index: params.winnerIndex,
        auto_void: params.autoVoid,
        resolved_total_pool: params.resolvedTotalPool || null,
        resolved_win_pool: params.resolvedWinPool || null,
        fees_transferred: params.feesTransferred || null,
        block_time: new Date().toISOString(),
    });

    if (error) {
        if (error.code === "23505") {
            console.log("[Supabase] Resolution already indexed (duplicate)");
            return;
        }
        console.error("[Supabase] saveMarketResolution failed:", error);
    } else {
        console.log("[Supabase] Market resolution saved successfully (client-side fallback)");

        // Trigger notifications for bettors
        // Since we can't use database triggers easily, we do it here client-side
        // This is a "best effort" - it won't scale to thousands of bettors efficiently 
        // but works for the current scale.
        createResolutionNotifications(params.marketPubkey, params.winnerIndex, params.autoVoid);
    }
}

/**
 * Create notifications for all users who bet on a resolved market
 */
async function createResolutionNotifications(
    marketPubkey: string,
    winnerIndex: number,
    autoVoid: boolean
) {
    try {
        // 1. Fetch all unique bettors for this market
        const { data: bettors, error: fetchError } = await supabase
            .from('bets')
            .select('bettor_pubkey, outcome_index')
            .eq('market_pubkey', marketPubkey);

        if (fetchError || !bettors) {
            console.error("[Supabase] Failed to fetch bettors for notification:", fetchError);
            return;
        }

        // 2. Get market question for the message
        const { data: market } = await supabase
            .from('markets')
            .select('question, outcome_labels')
            .eq('market_pubkey', marketPubkey)
            .single();

        const question = market?.question || 'Unknown Market';

        // Extract outcome labels from JSONB - handle both array and object formats
        let winnerLabel = `Outcome ${winnerIndex + 1}`;
        if (market?.outcome_labels) {
            const labels = market.outcome_labels;
            // Handle array format: ["Yes", "No"]
            if (Array.isArray(labels) && labels[winnerIndex]) {
                winnerLabel = String(labels[winnerIndex]);
            }
            // Handle object format: {"0": "Yes", "1": "No"}
            else if (typeof labels === 'object' && !Array.isArray(labels)) {
                const labelValue = labels[winnerIndex.toString()] || labels[winnerIndex];
                if (labelValue) {
                    winnerLabel = String(labelValue);
                }
            }
        }

        // 3. Create notifications
        const notifications = bettors.map(bet => {
            const didWin = !autoVoid && bet.outcome_index === winnerIndex;
            const isVoid = autoVoid;

            let title = "Market Resolved";
            let body = `Market "${question}" has been resolved.`;

            if (isVoid) {
                body += " It was voided and funds have been refunded.";
            } else if (didWin) {
                title = "You Won!";
                body += ` The winner was "${winnerLabel}". You won this bet!`;
            } else {
                body += ` The winner was "${winnerLabel}".`;
            }

            return {
                user_pubkey: bet.bettor_pubkey,
                type: 'market_resolved',
                title,
                body,
                action_url: `/market/${marketPubkey}`, // Add navigation URL
                metadata: {
                    market_pubkey: marketPubkey,
                    winner_index: winnerIndex,
                    did_win: didWin,
                    is_void: isVoid
                },
                is_read: false
            };
        });

        // Deduplicate by user (one notification per user per market)
        const uniqueNotifications = Array.from(
            new Map(notifications.map(n => [n.user_pubkey, n])).values()
        );

        if (uniqueNotifications.length > 0) {
            const { error: insertError } = await supabase
                .from('notifications')
                .insert(uniqueNotifications);

            if (insertError) {
                console.error("[Supabase] Failed to insert resolution notifications:", insertError);
            } else {
                console.log(`[Supabase] Created ${uniqueNotifications.length} resolution notifications`);
            }
        }
    } catch (err) {
        console.error("[Supabase] Error creating resolution notifications:", err);
    }
}

/**
 * Save winnings claim to Supabase (Client-side fallback)
 */
export async function saveClaim(params: {
    signature: string;
    marketPubkey: string;
    userPubkey: string;
    amountLamports: number;
}) {
    if (!isSupabaseConfigured()) {
        console.warn("[supabase][writes] Supabase not configured – skipping saveClaim");
        return;
    }

    const { error } = await supabase.from("claims").insert({
        tx_sig: params.signature,
        market_pubkey: params.marketPubkey,
        user_pubkey: params.userPubkey,
        amount_lamports: params.amountLamports,
        block_time: new Date().toISOString(),
    });

    if (error) {
        if (error.code === "23505") {
            console.log("[Supabase] Claim already indexed (duplicate)");
            return;
        }
        console.error("[Supabase] saveClaim failed:", error);
    } else {
        console.log("[Supabase] Claim saved successfully (client-side fallback)");
    }
}

/**
 * Backend market metadata integration
 * 
 * Fetches market metadata (question, answers, description, etc.) from Supabase
 * Primary source of truth for market display names and outcome labels
 * 
 * Supabase table: markets
 * - Key column: market_pubkey (text, primary key)
 * - Fields: question, creator_wallet, description, image_url, creator_name, answers (jsonb array)
 */

import { supabase, isSupabaseConfigured } from "./client";

const MARKETS_TABLE = "markets";

/**
 * Remote market metadata type (Supabase/backend)
 * Matches markets table schema
 */
export type RemoteMarketMetadata = {
  market_pubkey: string;
  question: string | null;
  description: string | null;
  creator_wallet: string | null;
  creator_name: string | null;
  image_url: string | null;
  answers: string[] | null; // outcomes labels
};

// Legacy type alias for backwards compatibility
export type BackendMarketMetadata = RemoteMarketMetadata;
export type UpsertMetadataParams = Record<string, any>;

/**
 * Fetch market metadata for multiple markets by their pubkeys
 * Uses Supabase directly as the primary source
 */
export async function fetchMarketsMetadataByPubkeys(
  pubkeys: string[]
): Promise<RemoteMarketMetadata[]> {
  if (!isSupabaseConfigured()) {
    console.warn("[supabase][markets] not configured – returning empty metadata list");
    return [];
  }
  if (!pubkeys || pubkeys.length === 0) {
    return [];
  }

  try {
    // 1. Fetch markets metadata
    const { data: marketsData, error: marketsError } = await (supabase as any)
      .from(MARKETS_TABLE)
      .select("*")
      .in("market_pubkey", pubkeys);

    if (marketsError) {
      console.error("[Supabase] fetchMarketsMetadataByPubkeys error:", {
        message: marketsError.message,
        code: marketsError.code,
        details: marketsError.details,
        hint: marketsError.hint
      });
      return [];
    }

    // 2. Extract creator wallets to fetch usernames
    const creatorWallets = Array.from(new Set(
      (marketsData ?? [])
        .map((m: any) => m.creator_wallet)
        .filter((w: any) => typeof w === 'string' && w.length > 0)
    )) as string[];

    // 3. Fetch usernames from users table (standardized)
    const usernameMap = new Map<string, string>();
    if (creatorWallets.length > 0) {
      const { data: usersData } = await (supabase as any)
        .from('users')
        .select('pubkey, username')
        .in('pubkey', creatorWallets);

      if (usersData) {
        usersData.forEach((u: any) => {
          if (u.pubkey && u.username) {
            usernameMap.set(u.pubkey, u.username);
          }
        });
      }
    }

    const rows = (marketsData ?? []).map((row: any): RemoteMarketMetadata => {
      // Prefer profile username over static creator_name if available
      const profileUsername = row.creator_wallet ? usernameMap.get(row.creator_wallet) : null;

      return {
        market_pubkey: row.market_pubkey,
        question: row.question ?? null,
        description: row.description ?? null,
        creator_wallet: row.creator_wallet ?? null,
        creator_name: profileUsername ?? row.creator_name ?? null, // Use profile username if available
        image_url: row.image_url ?? null,
        answers: Array.isArray(row.answers) ? row.answers : null,
      };
    });

    console.log(
      "[supabase][markets] fetch by pubkeys",
      pubkeys.length,
      "rows =",
      rows.length,
    );

    return rows;
  } catch (e) {
    console.error("[supabase][markets] fetchMany exception", e);
    return [];
  }
}

/**
 * Fetch metadata for a single market by pubkey
 * Uses Supabase directly as the primary source
 */
export async function fetchSingleMarketMetadata(
  pubkey: string
): Promise<RemoteMarketMetadata | null> {
  if (!isSupabaseConfigured()) {
    console.warn("[supabase][markets] not configured – returning null for", pubkey);
    return null;
  }
  if (!pubkey) {
    return null;
  }

  try {
    const { data, error } = await (supabase as any)
      .from(MARKETS_TABLE)
      .select("*")
      .eq("market_pubkey", pubkey)
      .maybeSingle();

    if (error) {
      console.error("[Supabase] fetchSingleMarketMetadata error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        pubkey
      });
      return null;
    }

    if (!data) {
      return null;
    }

    const row = data as any;

    const meta: RemoteMarketMetadata = {
      market_pubkey: row.market_pubkey,
      question: row.question ?? null,
      description: row.description ?? null,
      creator_wallet: row.creator_wallet ?? null,
      creator_name: row.creator_name ?? null,
      image_url: row.image_url ?? null,
      answers: Array.isArray(row.answers) ? row.answers : null,
    };

    console.log("[supabase][markets] fetch single", pubkey, "row =", meta);

    return meta;
  } catch (e) {
    console.error("[supabase][markets] fetchOne exception", e);
    return null;
  }
}

export async function upsertSupabaseMarketMetadata(meta: UpsertMetadataParams) {
  if (!isSupabaseConfigured()) {
    console.warn("[supabase][markets] not configured – skipping upsert for", meta.marketPubkey);
    return;
  }
  try {
    const { data, error } = await supabase
      .from('markets')
      .upsert(meta, { onConflict: 'market_pubkey' })
      .select();

    if (error) {
      console.error("[Supabase] upsertSupabaseMarketMetadata error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        marketPubkey: meta.marketPubkey
      });
      return;
    }

    console.log("[Supabase] upsertSupabaseMarketMetadata success", data);
  } catch (e: any) {
    console.error("[Supabase] upsertSupabaseMarketMetadata unexpected exception:", {
      message: e?.message,
      stack: e?.stack,
    });
  }
}

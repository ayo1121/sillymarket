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

import { supabase } from "./client";

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

/**
 * Fetch market metadata for multiple markets by their pubkeys
 * Uses Supabase directly as the primary source
 */
export async function fetchMarketsMetadataByPubkeys(
  pubkeys: string[]
): Promise<RemoteMarketMetadata[]> {
  if (!pubkeys || pubkeys.length === 0) {
    return [];
  }

  try {
    const { data, error } = await (supabase as any)
      .from(MARKETS_TABLE)
      .select("*")
      .in("market_pubkey", pubkeys);

    if (error) {
      console.error(
        "[supabase][markets] fetchMany error",
        error.message,
        error,
      );
      return [];
    }

    const rows = (data ?? []).map((row: any): RemoteMarketMetadata => ({
      market_pubkey: row.market_pubkey,
      question: row.question ?? null,
      description: row.description ?? null,
      creator_wallet: row.creator_wallet ?? null,
      creator_name: row.creator_name ?? null,
      image_url: row.image_url ?? null,
      answers: Array.isArray(row.answers) ? row.answers : null,
    }));

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
      console.error(
        "[supabase][markets] fetchOne error",
        error.message,
        error,
      );
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

/**
 * Upsert market metadata to Supabase markets table
 * Called after creating a market on-chain
 * Best-effort: never throws, only logs errors
 */
export async function upsertSupabaseMarketMetadata(meta: {
  marketPubkey: string;
  question: string;
  description?: string | null;
  creatorWallet: string;
  creatorName?: string | null;
  imageUrl?: string | null;
  answers?: string[] | null;
}): Promise<void> {
  // Map from camelCase to our snake_case DB schema
  const payload: Partial<RemoteMarketMetadata> = {
    market_pubkey: meta.marketPubkey,
    question: meta.question,
    description: meta.description ?? null,
    creator_wallet: meta.creatorWallet,
    creator_name: meta.creatorName ?? null,
    image_url: meta.imageUrl ?? null,
    // If the Supabase table does NOT yet have an `answers` column, this will
    // still be sent but PostgREST will just ignore unknown keys on upsert.
    answers: meta.answers ?? null,
  };

  console.log("[supabase][markets] upsert payload", payload);

  try {
    const { error } = await (supabase as any)
      .from<RemoteMarketMetadata>(MARKETS_TABLE)
      // IMPORTANT: remove onConflict -> do NOT send ?on_conflict=market_pubkey
      .upsert(payload);

    if (error) {
      console.error("[supabase][markets] upsert error", {
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: error.code,
      });
      // Best-effort: do NOT throw – metadata failure must not mark Anchor tx as failed
      return;
    }

    console.log("[supabase][markets] upsert ok for", meta.marketPubkey);
  } catch (e: any) {
    console.error("[supabase][markets] upsert unexpected exception", {
      message: e?.message,
      raw: e,
    });
    // Still do not throw
  }
}


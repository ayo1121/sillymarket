// NOTE: canonical indexing is done by Helius → Edge Function. Frontend should not write bets rows.
// This file is kept for type definitions and potential manual backfill tools only.

import { supabase } from "../integrations/supabase/client";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export type BetRow = {
  id?: string;
  market_pubkey?: string | null;
  bettor_pubkey?: string | null;
  username?: string | null;
  outcome_index: number | null; // Can be null if not extracted from event
  outcome_label?: string | null;
  amount_sol?: number | string | null;
  amount_lamports?: number | string | null;
  tx_sig?: string | null;
  block_time?: string | null; // ISO timestamp
  created_at?: string | null; // Supabase default
  pools_after?: number[] | null; // JSONB array: post-bet pool sizes per outcome
  probs_after?: number[] | null; // JSONB array: post-bet probabilities per outcome
};

/**
 * ⚠️ SECURITY: Frontend should NOT write to bets table
 * 
 * Bet indexing is handled by:
 * - Helius webhook → Edge Function (with service role key)
 * 
 * RLS policies prevent frontend writes to bets table.
 * This file is kept for type definitions only.
 */


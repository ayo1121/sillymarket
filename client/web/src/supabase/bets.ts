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

export async function insertBetRow(params: {
  marketPubkey: string;
  bettorPubkey: string;
  amountLamports: bigint | number;
  outcomeIndex: number;
  outcomeLabel: string;
  txSig: string;
  blockTime?: Date;
}) {
  const {
    marketPubkey,
    bettorPubkey,
    amountLamports,
    outcomeIndex,
    outcomeLabel,
    txSig,
    blockTime,
  } = params;

  const amountSol =
    typeof amountLamports === "bigint"
      ? Number(amountLamports) / LAMPORTS_PER_SOL
      : amountLamports / LAMPORTS_PER_SOL;

  // Insert exactly the fields matching the schema
  const { error } = await (supabase as any).from("bets").insert({
    market_pubkey: marketPubkey,
    bettor_pubkey: bettorPubkey,
    username: null, // Can be populated later from users table
    outcome_index: outcomeIndex,
    outcome_label: outcomeLabel || null,
    amount_sol: amountSol,
    tx_sig: txSig,
    block_time: (blockTime ?? new Date()).toISOString(),
    // created_at is set by Supabase default
  });

  if (error) {
    console.error("[bets] insertBetRow failed", error);
    throw error;
  }
}


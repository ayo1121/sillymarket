/**
 * Market mapping utilities - converts raw on-chain Market accounts to UI-friendly format
 */

import { PublicKey } from "@solana/web3.js";
import { formatTimeRemaining } from "../utils/time";
import { shortenWallet } from "../utils/format";
export { OUTCOME_COLORS, getOutcomeColor } from "./outcomeColors";

/**
 * Outcome information for a market
 */
export type UIMarketOutcome = {
  index: number;           // 0..n-1
  label: string;           // outcome name (from Supabase or fallback)
  poolLamports: bigint;    // raw pool size
  probability: number;     // 0..1
};

/**
 * Probability history point for charts
 */
export type MarketHistoryPoint = {
  ts: number;        // ms epoch
  probs: number[];   // probabilities for each outcome index, same ordering as UIMarket.outcomes
};

/**
 * Legacy alias for backwards compatibility
 */
export type ProbabilityHistoryPoint = MarketHistoryPoint;

/**
 * Market activity item from Supabase bets table
 */
export type MarketActivityItem = {
  kind: "market_created" | "bet" | "resolved";
  ts: number;        // ms epoch
  wallet: string;
  username?: string;
  outcomeIndex?: number | null;
  outcomeLabel?: string | null;
  amountSol?: number;
  txSig?: string | null; // For bet items
};

/**
 * UI-friendly market type with computed fields
 */
export type UIMarket = {
  pubkey: string;
  question: string; // Note: question text is not stored on-chain, only hash
  displayQuestion: string; // Question from backend metadata (primary), localStorage (fallback), or placeholder
  imageUrl?: string;

  creatorPubkey: string;
  creatorUsername?: string;
  creatorLabel: string; // username if present, else shortened wallet

  state: "open" | "locked" | "resolved" | "void";

  // Status flags derived from on-chain fields
  isLocked: boolean;   // state === ACTIVE && now >= cutoff_ts && winning_index === WIN_UNSET
  isResolved: boolean; // state === RESOLVED

  closesAt: Date;
  createdAt: Date;
  timeRemainingLabel: string;

  // Multi-outcome support (up to 5)
  outcomes: UIMarketOutcome[];

  // Legacy yes/no fields for backwards compatibility
  yesPool: number; // in lamports (outcomes[0]?.poolLamports or 0)
  noPool: number;  // in lamports (outcomes[1]?.poolLamports or 0)
  volume: number;  // sum of all pools (in lamports) - DEPRECATED, use volumeLamports
  volumeLamports: number; // sum of all pools (in lamports) - always from on-chain

  yesProb: number; // 0-1 (outcomes[0]?.probability or 0.5)
  noProb: number; // 0-1 (outcomes[1]?.probability or 0.5)

  // User position info (if wallet is connected)
  userOutcomeIndex?: number | null; // 0..4 if user has a position, else null

  // Backend metadata (optional, from Supabase/API)
  backendQuestion?: string;
  backendDescription?: string;
  backendImageUrl?: string;
  creatorName?: string;

  // History data for charts (optional)
  history?: MarketHistoryPoint[];

  // Activity data from Supabase (optional)
  activity?: MarketActivityItem[];

  // Raw account data for reference
  rawAccount: any;
  publicKey: PublicKey;
  winningOutcomeIndex: number; // -1 for UNSET, -2 for VOID, 0+ for winner
};

/**
 * Market state constants (from Rust: STATE_ACTIVE = 1, STATE_RESOLVED = 2)
 */
export const STATE_ACTIVE = 1;
export const STATE_RESOLVED = 2;
export const WIN_UNSET = -1;
export const WIN_VOID = -2;
/**
 * Resolve an outcome label from a market given an index. Returns "Unknown" when the
 * index is null/invalid or out of range.
 */
export function resolveOutcomeLabelFromMarket(
  market: UIMarket | null | undefined,
  outcomeIndex: number | null | undefined
): string {
  if (
    outcomeIndex === null ||
    outcomeIndex === undefined ||
    !market ||
    !Array.isArray(market.outcomes)
  ) {
    return "Unknown";
  }

  const idx = Number(outcomeIndex);
  if (Number.isNaN(idx) || idx < 0 || idx >= market.outcomes.length) {
    return "Unknown";
  }

  const outcome = market.outcomes?.[idx];
  if (outcome && typeof outcome.label === "string" && outcome.label.length > 0) {
    return outcome.label;
  }

  return `Outcome ${idx + 1}`;
}

/**
 * Map raw market account from Anchor to UIMarket
 * @param raw - Raw market row from program.account.market.all() or similar
 * @returns UIMarket object with computed fields
 */
export function mapRawMarketToUi(raw: any): UIMarket {
  const account = raw.account || raw;
  const publicKey = raw.publicKey;

  // Extract basic fields
  const creatorPubkey = (account.creator || account.creatorPubkey || "").toString();
  const cutoffTs = account.cutoffTs || account.cutoff_ts || 0;
  const createdTs = account.createdTs || account.created_ts || 0;
  const state = account.state || 0;
  const pools = account.pools || [];
  const totalPool = account.totalPool || account.total_pool || 0;
  const winningIndex = account.winningIndex || account.winning_index || WIN_UNSET;
  const imageUrl = account.imageUrl || account.image_url || "";
  const outcomesCount = account.outcomesCount || account.outcomes_count || 2;

  // Extract pools as bigints (handle Anchor BN / BigNumber-like objects)
  const poolsBigInt: bigint[] = pools.map((p: any) => {
    try {
      if (typeof p === "bigint") return p;
      if (typeof p === "number") return BigInt(p);
      if (typeof p === "string") return BigInt(p);
      if (p && typeof p.toString === "function") {
        const asString = p.toString();
        if (asString && asString !== "[object Object]") {
          return BigInt(asString);
        }
      }
    } catch {
      // fall through to zero
    }
    return BigInt(0);
  });

  // Determine active outcome count
  const activeCount = Math.min(
    Math.max(2, outcomesCount), // at least 2
    poolsBigInt.length,
    5 // max 5
  );

  // Calculate total pool for probability calculation.
  // Prefer the explicit totalPool field if present; otherwise sum pools.
  let totalPoolBigInt = BigInt(0);

  if (totalPool !== null && totalPool !== undefined) {
    try {
      if (typeof totalPool === "bigint") {
        totalPoolBigInt = totalPool;
      } else if (typeof totalPool === "number") {
        totalPoolBigInt = BigInt(totalPool);
      } else if (typeof totalPool === "string") {
        totalPoolBigInt = BigInt(totalPool);
      } else if (totalPool && typeof (totalPool as any).toString === "function") {
        const asString = (totalPool as any).toString();
        if (asString && asString !== "[object Object]") {
          totalPoolBigInt = BigInt(asString);
        }
      }
    } catch {
      totalPoolBigInt = BigInt(0);
    }
  }

  if (totalPoolBigInt === BigInt(0)) {
    for (let i = 0; i < activeCount; i++) {
      totalPoolBigInt += poolsBigInt[i] || BigInt(0);
    }
  }

  // Build outcomes array (labels will be filled from Supabase later)
  const outcomes: UIMarketOutcome[] = [];
  for (let i = 0; i < activeCount; i++) {
    const poolLamports = poolsBigInt[i] || BigInt(0);
    const probability = totalPoolBigInt > BigInt(0)
      ? Number(poolLamports) / Number(totalPoolBigInt)
      : 1 / activeCount;

    // Placeholder labels - will be replaced from Supabase metadata if available
    const label = i === 0 ? "Yes" : i === 1 ? "No" : `Outcome ${i + 1}`;

    outcomes.push({
      index: i,
      label,
      poolLamports,
      probability,
    });
  }

  // Legacy yes/no fields for backwards compatibility
  const yesPool = Number(poolsBigInt[0] || BigInt(0));
  const noPool = Number(poolsBigInt[1] || BigInt(0));
  const volume = Number(totalPoolBigInt);
  const volumeLamports = Number(totalPoolBigInt); // Always from on-chain

  // Calculate probabilities
  const yesProb = outcomes[0]?.probability || 0.5;
  const noProb = outcomes[1]?.probability || 0.5;

  // Determine state
  let uiState: "open" | "locked" | "resolved" | "void";
  const now = Math.floor(Date.now() / 1000);
  const isResolved = state === STATE_RESOLVED;
  const isLocked = (state === STATE_ACTIVE) && (now >= cutoffTs) && (winningIndex === WIN_UNSET);

  if (state === STATE_RESOLVED) {
    if (winningIndex === WIN_VOID) {
      uiState = "void";
    } else {
      uiState = "resolved";
    }
  } else if (state === STATE_ACTIVE) {
    if (now >= cutoffTs) {
      uiState = "locked"; // Active but past cutoff (waiting for resolution)
    } else {
      uiState = "open";
    }
  } else {
    uiState = "locked"; // Unknown state, treat as locked
  }

  // Time calculations
  const closesAt = new Date(cutoffTs * 1000);
  const timeRemainingLabel = formatTimeRemaining(closesAt);

  // Creator label (username lookup can be added later via API)
  const creatorLabel = shortenWallet(creatorPubkey);

  // Get pubkey string
  const pubkeyStr = publicKey?.toBase58?.() || "";

  // Question - note: question text is NOT stored on-chain, only hash
  // The displayQuestion will be set by backend metadata in read.ts
  // This is just a placeholder - the real value comes from Supabase metadata
  const shortBase58 = (pk: string) => pk.slice(0, 4);
  const placeholder = pubkeyStr ? `market ${shortBase58(pubkeyStr)}...` : "unknown market";
  const displayQuestion = placeholder;

  return {
    pubkey: pubkeyStr,
    question: placeholder, // Legacy field
    displayQuestion,
    imageUrl: imageUrl || undefined,
    creatorPubkey,
    creatorUsername: undefined, // TODO: fetch from API if available
    creatorLabel,
    state: uiState,
    isLocked,
    isResolved,
    closesAt,
    createdAt: new Date(createdTs * 1000),
    timeRemainingLabel,
    outcomes,
    yesPool,
    noPool,
    volume,
    volumeLamports,
    yesProb,
    noProb,
    userOutcomeIndex: null, // Will be set in read.ts if user has a position
    rawAccount: account,
    publicKey: publicKey || (creatorPubkey ? new PublicKey(creatorPubkey) : new PublicKey("11111111111111111111111111111111")), // fallback
    winningOutcomeIndex,
  };
}

// src/solana/read.ts
import type { Program } from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { YesnoMarkets } from "../idl/yesno_markets";
import { getConfigPda } from "./idlHelpers";
import { mapRawMarketToUi, type UIMarket, type MarketHistoryPoint, type MarketActivityItem, STATE_ACTIVE, STATE_RESOLVED, WIN_UNSET, WIN_VOID, resolveOutcomeLabelFromMarket } from "./marketMapping";
import { attachMetadataToMarkets } from "../lib/marketMetadata";
import {
  fetchMarketsMetadataByPubkeys,
  fetchSingleMarketMetadata,
  type RemoteMarketMetadata,
} from "../integrations/supabase/markets";
import { shortenWallet } from "../utils/format";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetRow } from "../supabase/bets";
import { supabase } from "../integrations/supabase/client";

/**
 * Type helpers for IDL account types
 */
type MarketAccount = YesnoMarkets["types"][number] extends { name: "Market"; type: infer T } ? T : never;
type PositionAccount = YesnoMarkets["types"][number] extends { name: "Position"; type: infer T } ? T : never;

export async function fetchAllMarkets(program: Program<YesnoMarkets> | null, userWallet?: PublicKey | null): Promise<UIMarket[]> {
  if (!program) {
    console.warn("[yesno] fetchAllMarkets: program not ready");
    return [];
  }

  try {
    const rawMarkets = await program.account.market.all();
    console.log("[read] fetchAllMarkets: on-chain count =", rawMarkets.length);

    // Map raw markets to UI format
    const baseMarkets = rawMarkets.map(mapRawMarketToUi);
    console.log("[read] base markets", baseMarkets.slice(0, 3).map(m => ({
      pubkey: m.pubkey.slice(0, 8) + "...",
      displayQuestion: m.displayQuestion,
      outcomesCount: m.outcomes.length,
    })));

    // Fetch user positions if wallet is provided
    const userPositionsByMarket = new Map<string, number | null>();
    if (userWallet) {
      try {
        const allPositions = await program.account.position.all();
        const userPositions = allPositions.filter((p: any) => {
          const posOwner = p.account.owner || p.account.user;
          if (!posOwner) return false;
          const ownerPubkey = posOwner.toBase58 ? posOwner.toBase58() : posOwner.toString();
          return ownerPubkey === userWallet.toBase58();
        });

        userPositions.forEach((p: any) => {
          const posMarket = p.account.market;
          const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
          if (marketPubkey) {
            const outcomeIndex = extractOutcomeIndexFromPosition(p);
            if (outcomeIndex != null) {
              userPositionsByMarket.set(marketPubkey, outcomeIndex);
            }
          }
        });
      } catch (err) {
        console.error("[read] Failed to fetch user positions", err);
      }
    }

    // Collect all market pubkeys for backend metadata fetch
    const pubkeys = baseMarkets.map((m) => m.pubkey);

    // Fetch backend metadata (primary source)
    const backendRows = await fetchMarketsMetadataByPubkeys(pubkeys);
    const metaByPk = new Map<string, RemoteMarketMetadata>(
      backendRows.map((row) => [row.market_pubkey, row]),
    );

    // Merge backend metadata into markets (but preserve on-chain volume)
    const withBackend = baseMarkets.map((m) => {
      const meta = metaByPk.get(m.pubkey);
      if (!meta) {
        // Still add user position info even if no metadata
        const userOutcomeIndex = userPositionsByMarket.get(m.pubkey) ?? null;
        return {
          ...m,
          userOutcomeIndex,
        };
      }

      let displayQuestion = m.displayQuestion; // placeholder from mapping
      let creatorName: string | undefined = m.creatorName;

      if (meta.question) {
        displayQuestion = meta.question;
      }

      if (meta.creator_name) {
        creatorName = meta.creator_name;
      }

      // Outcome labels (answers)
      let outcomes = m.outcomes;
      if (meta.answers && meta.answers.length > 0) {
        outcomes = outcomes.map((outcome, idx) => {
          const label = meta.answers![idx];
          if (label && label.trim().length > 0) {
            return { ...outcome, label: label.trim() };
          }
          return outcome;
        });
      }

      // Get user position for this market
      const userOutcomeIndex = userPositionsByMarket.get(m.pubkey) ?? null;

      // Strip any volume fields from metadata to ensure on-chain volume wins
      const { volume: _metaVolume, volumeLamports: _metaVolumeLamports, volumeSol: _metaVolumeSol, ...metaWithoutVolume } = meta as any;

      return {
        ...m,
        displayQuestion,
        creatorName,
        creatorUsername: meta.creator_name ?? undefined, // Set username from backend
        imageUrl: meta.image_url ?? m.imageUrl,
        outcomes,
        userOutcomeIndex,
        // Ensure volumeLamports always comes from on-chain (m.volumeLamports)
        volumeLamports: m.volumeLamports,
      };
    });

    // localStorage fallback (only if displayQuestion is still placeholder)
    const withLocal = attachMetadataToMarkets(withBackend);

    console.log("[read] merged markets sample", withLocal.slice(0, 3));

    return withLocal;
  } catch (err) {
    console.error("[yesno] fetchAllMarkets failed", err);
    return [];
  }
}

/**
 * Extract outcome index from a position account (on-chain)
 * Returns number | null - never defaults to 0
 */
function extractOutcomeIndexFromPosition(pos: any): number | null {
  if (!pos || !pos.account) return null;

  const raw =
    (pos.account as any).outcome_index ??
    (pos.account as any).outcomeIndex ??
    null;

  if (raw == null) return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch usernames for a list of pubkeys from Supabase users table
 */
async function fetchUsernamesForPubkeys(
  supabase: SupabaseClient,
  pubkeys: string[]
): Promise<Map<string, string>> {
  if (pubkeys.length === 0) return new Map();

  try {
    // Query users table with pubkey column (actual schema)
    // Schema: id uuid, pubkey text, username text, created_at timestamptz
    let data: any[] | null = null;
    let error: any = null;

    // Try table/column combinations - prioritize users.pubkey (actual schema)
    const attempts = [
      { table: "users", pubkeyCol: "pubkey", usernameCol: "username" },
      { table: "user_profiles", pubkeyCol: "wallet_address", usernameCol: "username" },
    ];

    for (const attempt of attempts) {
      try {
        const result = await (supabase as any)
          .from(attempt.table)
          .select(`${attempt.pubkeyCol}, ${attempt.usernameCol}`)
          .in(attempt.pubkeyCol, pubkeys);
        if (!result.error && result.data) {
          data = result.data;
          error = null;
          break;
        }
      } catch {
        // Try next combination
        continue;
      }
    }

    if (error || !data) {
      // No users table found or error - return empty map (usernames will be null)
      return new Map();
    }

    const map = new Map<string, string>();
    for (const row of data) {
      // Use the pubkey column name from the successful attempt
      const pubkey = row.pubkey || row.wallet_address;
      const username = row.username;
      if (pubkey && username) {
        map.set(pubkey, username);
      }
    }
    return map;
  } catch (err) {
    // If users table doesn't exist or has different schema, return empty map
    // This is fine - usernames will just be null and we'll show shortened pubkeys
    return new Map();
  }
}

/**
 * Normalize numeric arrays from Supabase JSONB (can come as arrays, objects, or strings)
 */
function normalizeNumericArray(value: any, expectedLength: number): number[] | null {
  if (value == null) return null;

  let arr: any[] | null = null;

  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === "object") {
    // Supabase JSONB can come back as {0: "...", 1: "..."}
    arr = Object.values(value);
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (parsed && typeof parsed === "object") {
        arr = Object.values(parsed);
      }
    } catch {
      // ignore
    }
  }

  if (!arr || arr.length < expectedLength) return null;
  return arr.slice(0, expectedLength).map((x: any) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * Fetch bet events from Supabase and build history/activity arrays
 * Computes probabilities from cumulative volume per outcome
 * 
 * Architecture: Bets are indexed on-chain via Helius → Supabase Edge Function (index_bet_event).
 * Frontend only reads from public.bets and listens to Supabase Realtime; it never writes bets rows.
 */
export async function fetchBetEvents(
  marketPubkey: string,
  uiMarket: UIMarket
): Promise<{
  history: MarketHistoryPoint[];
  activity: MarketActivityItem[];
}> {
  try {
    const { data: rowsData, error } = await (supabase as any)
      .from<BetRow>("bets")
      .select("id, market_pubkey, bettor_pubkey, username, outcome_index, outcome_label, amount_sol, amount_lamports, tx_sig, created_at, block_time, pools_after, probs_after")
      .eq("market_pubkey", marketPubkey)
      .order("block_time", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = (rowsData ?? []).sort((a: any, b: any) => {
      const ta = new Date(a.block_time ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.block_time ?? b.created_at ?? 0).getTime();
      return ta - tb; // oldest → newest for chart building
    });

    console.log("[read] bets rows for history", { marketPubkey, count: rows?.length, rows });

    if (!rows || rows.length === 0) {
      return {
        history: [],
        activity: [],
      };
    }

    if (error) {
      console.error("[read] fetchBetEvents error", error);
      return {
        history: [],
        activity: [],
      };
    }

    // Build username map
    const uniquePubkeys = Array.from(
      new Set(rows.map((r: any) => r.bettor_pubkey).filter(Boolean))
    );
    const usernameMap = await fetchUsernamesForPubkeys(supabase, uniquePubkeys);

    // Compute outcomesCount and initialize history
    const outcomesCount = (uiMarket?.outcomes?.length ?? 0) as number;
    const history: MarketHistoryPoint[] = [];

    // Track pools over time and derived outcome indices
    const derivedOutcomeIndexById = new Map<string, number>();
    let lastPools: number[] | null = null;
    let storedHistoryUsed = false;

    const LAMPORTS_PER_SOL = 1_000_000_000;

    // Helper to compute amount from row
    const amountFromRow = (row: any): number => {
      if (typeof row.amount_sol === "number") {
        return row.amount_sol;
      }
      if (row.amount_sol != null) {
        return parseFloat(String(row.amount_sol));
      }
      if (row.amount_lamports != null) {
        return Number(row.amount_lamports) / LAMPORTS_PER_SOL;
      }
      return 0;
    };

    // Build probability history using probs_after / pools_after from JSONB
    // Only build history if we have outcomes; otherwise history stays empty
    if (outcomesCount > 0) {
      // Cumulative pools for fallback computation when probs_after/pools_after are missing
      const runningPools: number[] = Array.from({ length: outcomesCount }, () => 0);

      console.debug("[fetchBetEvents] building history", {
        outcomesCount,
        rowSample: rows[0],
      });

      try {
        for (const row of rows) {
          // Parse timestamp
          const tsMs = Date.parse(row.block_time ?? row.created_at ?? new Date().toISOString());
          if (isNaN(tsMs)) {
            console.warn("[read] bet row with invalid timestamp", row);
            continue;
          }

          let probs: number[] | null = null;
          let pools: number[] | null = null;

          // Priority 1: Use probs_after if available and valid
          const probsRaw = row.probs_after;
          const poolsRaw = row.pools_after;
          const probsArray = normalizeNumericArray(probsRaw, outcomesCount);
          if (probsArray) {
            probs = probsArray.map((p) => {
              const num = Number(p);
              return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : 0;
            });

            // Normalize if sum > 0
            const sum = probs.reduce((a, b) => a + b, 0);
            if (sum > 0) {
              probs = probs.map((p) => p / sum);
            }
          }

          // Priority 2: Derive from pools_after if probs_after not available
          if (probs == null) {
            const poolsArray = normalizeNumericArray(poolsRaw, outcomesCount);
            if (poolsArray) {
              pools = poolsArray;
              const total = pools.reduce((a, b) => a + b, 0);
              if (total > 0) {
                probs = pools.map((p) => p / total);
              }
            }
          }

          // Parse outcome_index from DB (trust DB field first)
          let effectiveOutcomeIndex: number | null = null;
          if (row.outcome_index != null) {
            const parsed = Number(row.outcome_index);
            if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed >= 0 && parsed <= 4) {
              effectiveOutcomeIndex = parsed;
            }
          }

          // If we still don't have an effectiveOutcomeIndex but we do have probs,
          // infer it as the index of the highest probability.
          if (effectiveOutcomeIndex == null && probs && probs.length === outcomesCount) {
            let bestIdx = -1;
            let bestVal = -1;
            for (let i = 0; i < probs.length; i++) {
              const v = Number(probs[i]);
              if (Number.isFinite(v) && v > bestVal) {
                bestVal = v;
                bestIdx = i;
              }
            }
            if (bestIdx >= 0) {
              effectiveOutcomeIndex = bestIdx;
            }
          }

          if (effectiveOutcomeIndex == null && pools && pools.length === outcomesCount) {
            if (lastPools && lastPools.length === outcomesCount) {
              let bestIdx = -1;
              let bestDelta = 0;
              for (let i = 0; i < outcomesCount; i++) {
                const delta = pools[i] - lastPools[i];
                if (delta > bestDelta) {
                  bestDelta = delta;
                  bestIdx = i;
                }
              }
              if (bestIdx >= 0) {
                effectiveOutcomeIndex = bestIdx;
              }
            } else {
              // First data point: just pick the largest pool
              let maxIdx = -1;
              let maxVal = 0;
              for (let i = 0; i < outcomesCount; i++) {
                if (pools[i] > maxVal) {
                  maxVal = pools[i];
                  maxIdx = i;
                }
              }
              if (maxIdx >= 0) {
                effectiveOutcomeIndex = maxIdx;
              }
            }
          }

          if (pools) {
            lastPools = pools;
          }

          if (effectiveOutcomeIndex != null) {
            const key =
              row.id != null
                ? String(row.id)
                : row.tx_sig != null
                  ? String(row.tx_sig)
                  : String(tsMs);
            derivedOutcomeIndexById.set(key, effectiveOutcomeIndex);
          }

          console.debug("[fetchBetEvents] candidate history point", {
            id: row.id,
            idType: typeof row.id,
            block_time: row.block_time,
            created_at: row.created_at,
            outcome_index_raw: row.outcome_index,
            outcome_index_type: typeof row.outcome_index,
            effectiveOutcomeIndex,
            amount_lamports: row.amount_lamports,
            amount_sol: row.amount_sol,
            probs_after: row.probs_after,
            probs_after_type: typeof row.probs_after,
            pools_after: row.pools_after,
            pools_after_type: typeof row.pools_after,
            computedProbs: probs,
          });

          // Sanity check: skip if no valid probabilities
          if (probs == null || probs.length !== outcomesCount) {
            continue;
          }

          // Clamp each probability to [0, 1] and normalize
          probs = probs.map(p => Math.max(0, Math.min(1, p)));
          const sum = probs.reduce((a, b) => a + b, 0);
          if (sum > 0) {
            probs = probs.map(p => p / sum);
          }

          // If we have valid probabilities, add to history
          history.push({
            ts: tsMs, // Store timestamp in milliseconds (not seconds)
            probs,
          });
          storedHistoryUsed = true;
        }
      } catch (err) {
        console.error("[fetchBetEvents] history loop error", err);
      }

      // Fallback: derive history from running pools when no stored probs/pools points were usable
      if (!storedHistoryUsed && history.length === 0) {
        const runningPools: number[] = Array.from({ length: outcomesCount }, () => 0);
        for (const row of rows) {
          const tsMs = Date.parse(row.block_time ?? row.created_at ?? new Date().toISOString());
          if (isNaN(tsMs)) continue;

          const idxRaw = row.outcome_index;
          const idx = typeof idxRaw === "number" ? idxRaw : Number(idxRaw);
          if (!Number.isFinite(idx) || idx < 0 || idx >= outcomesCount) {
            continue;
          }

          const outcomeLabel = resolveOutcomeLabelFromMarket(uiMarket, idx);
          if (outcomeLabel === "Unknown") {
            continue;
          }

          const amountSol = amountFromRow(row);
          runningPools[idx] += amountSol;
          const total = runningPools.reduce((sum, v) => sum + v, 0);
          if (total <= 0) continue;

          const probs = runningPools.map((p) => p / total);
          history.push({
            ts: tsMs,
            probs,
          });
        }
      }
    } // End of if (outcomesCount > 0) block for history building

    // Build activity: sort by descending time, take latest 50
    const sorted = [...rows].sort((a, b) => {
      const ta = new Date(a.block_time ?? a.created_at).getTime();
      const tb = new Date(b.block_time ?? b.created_at).getTime();
      return tb - ta;
    });
    const latest = sorted.slice(0, 50);

    const activity: MarketActivityItem[] = latest.map((row: any) => {
      const ts = new Date(row.block_time ?? row.created_at).getTime();

      // Use the same key logic as when we stored derivedOutcomeIndexById
      const idKey =
        row.id != null
          ? String(row.id)
          : row.tx_sig != null
            ? String(row.tx_sig)
            : String(ts);

      const derivedIdx = derivedOutcomeIndexById.get(idKey);

      // Parse outcome_index from DB (trust DB field first)
      let rawOutcomeIndex: number | null = null;
      if (row.outcome_index != null) {
        const parsed = Number(row.outcome_index);
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
          rawOutcomeIndex = parsed;
        }
      }

      // Fallback to derived index if DB field missing
      if (rawOutcomeIndex == null && derivedIdx != null) {
        rawOutcomeIndex = derivedIdx;
      }

      // Get label from row (simplified - just use outcome_label)
      const labelFromRow = row.outcome_label ?? null;

      // Resolve label from market outcomes using outcome_index
      const labelFromMarket = uiMarket
        ? resolveOutcomeLabelFromMarket(uiMarket, rawOutcomeIndex)
        : "Unknown";

      // Derive outcome label with fallbacks
      const outcomeLabel =
        labelFromRow ??
        labelFromMarket ??
        "Unknown";

      const wallet = row.bettor_pubkey;
      const username = usernameMap.get(wallet);

      return {
        kind: "bet",
        ts,
        wallet,
        username,
        outcomeIndex: rawOutcomeIndex,
        outcomeLabel,
        amountSol: amountFromRow(row),
        txSig: row.tx_sig ?? null,
      };
    });

    console.debug("[fetchBetEvents]", {
      marketPubkey,
      rowCount: rows.length,
      historyPoints: history.length,
      activityItems: activity.length,
      historySample: history.slice(0, 3),
    });

    return { history, activity };
  } catch (err) {
    console.error("[read] fetchBetEvents failed", err);
    return { history: [], activity: [] };
  }
}

export async function fetchMarket(program: Program<YesnoMarkets> | null, pubkey: string | PublicKey, userWallet?: PublicKey | null): Promise<UIMarket | null> {
  if (!program) {
    console.warn("[yesno] fetchMarket: program not ready");
    return null;
  }

  try {
    const marketPk = new web3.PublicKey(pubkey);
    const rawMarket = await program.account.market.fetch(marketPk);

    // Map to UI format
    const uiMarket = mapRawMarketToUi({
      publicKey: marketPk,
      account: rawMarket,
    });

    const pubkeyStr = uiMarket.pubkey;

    // Fetch user position if wallet is provided
    let userOutcomeIndex: number | null = null;
    let userPositionRaw: any | null = null;
    if (userWallet) {
      try {
        const allPositions = await program.account.position.all();
        const userPositions = allPositions.filter((p: any) => {
          const posOwner = p.account.owner || p.account.user;
          if (!posOwner) return false;
          const ownerPubkey = posOwner.toBase58 ? posOwner.toBase58() : posOwner.toString();
          const posMarket = p.account.market;
          const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
          return ownerPubkey === userWallet.toBase58() && marketPubkey === pubkeyStr;
        });

        if (userPositions.length > 0) {
          const firstPosition = userPositions[0];
          userPositionRaw = firstPosition;
          userOutcomeIndex = extractOutcomeIndexFromPosition(firstPosition);
        }
      } catch (err) {
        console.error("[read] Failed to fetch user position", err);
      }
    }

    // Debug log user position outcome
    console.debug("[fetchMarket] user position outcome", {
      market: pubkeyStr,
      wallet: userWallet?.toBase58() ?? null,
      userOutcomeIndex,
      userPositionRaw,
    });

    // Fetch backend metadata (primary source)
    const backendMeta = await fetchSingleMarketMetadata(pubkeyStr);

    // Merge backend metadata (but preserve on-chain volume)
    let enriched = uiMarket;
    if (backendMeta) {
      let displayQuestion = uiMarket.displayQuestion;
      let creatorName: string | undefined = uiMarket.creatorName;

      if (backendMeta.question) {
        displayQuestion = backendMeta.question;
      }

      if (backendMeta.creator_name) {
        creatorName = backendMeta.creator_name;
      }

      // Outcome labels (answers)
      let outcomes = uiMarket.outcomes;
      if (backendMeta.answers && backendMeta.answers.length > 0) {
        outcomes = outcomes.map((outcome, idx) => {
          const label = backendMeta.answers![idx];
          if (label && label.trim().length > 0) {
            return { ...outcome, label: label.trim() };
          }
          return outcome;
        });
      }

      enriched = {
        ...uiMarket,
        displayQuestion,
        creatorName,
        imageUrl: backendMeta.image_url ?? uiMarket.imageUrl,
        outcomes,
        userOutcomeIndex,
        // Ensure volumeLamports always comes from on-chain
        volumeLamports: uiMarket.volumeLamports,
      };
    } else {
      enriched = {
        ...uiMarket,
        userOutcomeIndex,
      };
    }

    // Fetch bet events from Supabase and populate activity and history
    const { history, activity } = await fetchBetEvents(pubkeyStr, enriched);

    const enrichedWithHistory: UIMarket = {
      ...enriched,
      history,
      activity,
    };

    // Apply localStorage metadata as secondary fallback
    const [withLocalStorage] = attachMetadataToMarkets([enrichedWithHistory]);

    console.log("[read] fetchMarket: enriched market", {
      pubkey: withLocalStorage.pubkey,
      outcomes: withLocalStorage.outcomes?.map(o => ({
        index: o.index,
        label: o.label,
        prob: o.probability,
      })),
      historyCount: withLocalStorage.history?.length ?? 0,
      lastHistoryPoint: withLocalStorage.history?.[withLocalStorage.history.length - 1],
      activityCount: withLocalStorage.activity?.length ?? 0,
    });

    return withLocalStorage;
  } catch (err) {
    console.error("[yesno] fetchMarket failed", err);
    return null;
  }
}

export async function fetchUserPositions(program: Program<YesnoMarkets> | null, owner: string | PublicKey) {
  if (!program) {
    console.warn("[yesno] fetchUserPositions: program not ready");
    return [];
  }

  try {
    const ownerPk = new web3.PublicKey(owner);
    const allPositions = await program.account.position.all();

    // Filter by owner in JavaScript
    const userPositions = allPositions.filter((p: any) => {
      const posOwner = p.account.owner || p.account.user;
      if (!posOwner) return false;
      const ownerPubkey = posOwner.toBase58 ? posOwner.toBase58() : posOwner.toString();
      return ownerPubkey === ownerPk.toBase58();
    });

    return userPositions;
  } catch (err) {
    console.error("[yesno] fetchUserPositions failed", err);
    return [];
  }
}

export async function fetchConfig(program: Program<YesnoMarkets> | null) {
  if (!program) {
    console.warn("[yesno] fetchConfig: program not ready");
    return null;
  }

  try {
    // Use program.programId directly to ensure consistency with Anchor's internal derivation
    const programId = program.programId;
    const [configPda] = getConfigPda(programId);
    const config = await program.account.config.fetch(configPda);
    return config;
  } catch (err) {
    console.error("[yesno] fetchConfig failed", err);
    return null;
  }
}

/**
 * Helper to determine if a user can resolve a market based on on-chain rules.
 * Matches Rust resolve() logic: requires state == STATE_ACTIVE, winning_index == WIN_UNSET,
 * and either creator (after cutoff) or authority (may allow pre-cutoff if admin_pre_cutoff).
 * 
 * @param args.market - Raw market account from Anchor
 * @param args.wallet - User's wallet public key
 * @param args.configAuthority - Optional config authority (from fetchConfig)
 * @param args.configAdminPreCutoff - Optional admin_pre_cutoff flag from config
 * @param args.nowTs - Optional current timestamp in seconds (defaults to Date.now() / 1000)
 * @returns true if user can resolve, false otherwise
 */
export function canResolveMarket(args: {
  market: any; // MarketAccount or raw Anchor account
  wallet: PublicKey | null;
  configAuthority?: PublicKey | null;
  configAdminPreCutoff?: boolean | null;
  nowTs?: number;
}): boolean {
  const { market, wallet, configAuthority, configAdminPreCutoff, nowTs } = args;

  // Require wallet
  if (!wallet) {
    return false;
  }

  // Extract market fields (handle both raw Anchor account and typed account)
  const marketState = market.state ?? 0;
  const winningIndex = market.winningIndex ?? market.winning_index ?? WIN_UNSET;
  const cutoffTs = market.cutoffTs ?? market.cutoff_ts ?? 0;
  const creator = market.creator;

  // Require state == STATE_ACTIVE and winning_index == WIN_UNSET
  if (marketState !== STATE_ACTIVE || winningIndex !== WIN_UNSET) {
    return false;
  }

  // Get current time
  const now = nowTs ?? Math.floor(Date.now() / 1000);

  // Check if creator
  let isCreator = false;
  try {
    const creatorPubkey = typeof creator === "string" ? new PublicKey(creator) : creator;
    isCreator = wallet.equals(creatorPubkey);
  } catch {
    // Invalid creator pubkey, treat as false
    isCreator = false;
  }

  // Check if authority
  let isAuthority = false;
  if (configAuthority) {
    try {
      isAuthority = wallet.equals(configAuthority);
    } catch {
      isAuthority = false;
    }
  }

  // Creator requires: now >= cutoff_ts
  if (isCreator) {
    return now >= cutoffTs;
  }

  // Authority requires: admin_pre_cutoff || now >= cutoff_ts
  if (isAuthority) {
    return (configAdminPreCutoff === true) || (now >= cutoffTs);
  }

  return false;
}

/**
 * Helper to determine if a user can claim winnings for a position based on on-chain rules.
 * Matches Rust claim_winnings() logic: requires state == STATE_RESOLVED, position.owner == user,
 * !position.claimed, and for non-VOID markets: position.outcome_index == winning_index.
 * 
 * @param args.market - Raw market account from Anchor
 * @param args.position - Raw position account from Anchor (null if user has no position)
 * @param args.wallet - User's wallet public key
 * @returns true if user can claim, false otherwise
 */
export function canClaimPosition(args: {
  market: any; // MarketAccount or raw Anchor account
  position: any | null; // PositionAccount or raw Anchor account, null if no position
  wallet: PublicKey | null;
}): boolean {
  const { market, position, wallet } = args;

  // Require wallet and position
  if (!wallet || !position) {
    return false;
  }

  // Extract market fields
  const marketState = market.state ?? 0;
  const winningIndex = market.winningIndex ?? market.winning_index ?? WIN_UNSET;

  // Extract position fields (handle both raw Anchor account and typed account)
  // Position account uses 'owner' field (not 'user') - see lib.rs: pub owner: Pubkey
  const positionOwner = position.owner;
  const positionClaimed = position.claimed ?? false;
  const positionOutcomeIndex = position.outcomeIndex ?? position.outcome_index ?? null;

  // Require position.owner field to exist
  if (!positionOwner) {
    return false;
  }

  // Require !position.claimed
  if (positionClaimed) {
    return false;
  }

  // Require market.state === STATE_RESOLVED
  if (marketState !== STATE_RESOLVED) {
    return false;
  }

  // Verify position.owner == wallet (matches Rust: require_keys_eq!(p.owner, ctx.accounts.user.key(), ErrorCode::Unauthorized))
  let ownerMatches = false;
  try {
    const ownerPubkey = typeof positionOwner === "string" ? new PublicKey(positionOwner) : positionOwner;
    ownerMatches = wallet.equals(ownerPubkey);
  } catch {
    ownerMatches = false;
  }

  if (!ownerMatches) {
    return false;
  }

  // If market.winning_index === WIN_VOID: any position can be refunded
  if (winningIndex === WIN_VOID) {
    return true;
  }

  // Else: require position.outcome_index === market.winning_index
  if (positionOutcomeIndex === null || positionOutcomeIndex === undefined) {
    return false;
  }

  return (positionOutcomeIndex as number) === (winningIndex as number);
}

/**
 * Get a readonly Anchor program (no wallet required)
 */
async function getReadonlyAnchorProgram(): Promise<Program<YesnoMarkets> | null> {
  try {
    const { RPC_URL } = await import("./env");
    const connection = new Connection(RPC_URL, "confirmed");

    // Create a dummy wallet for readonly access
    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    } as anchor.Wallet;

    const provider = new anchor.AnchorProvider(connection, dummyWallet, {
      commitment: "confirmed",
    });

    const rawIdl = await import("../idl/yesno_markets.json");
    const program = new anchor.Program(rawIdl.default as anchor.Idl, provider) as Program<YesnoMarkets>;

    return program;
  } catch (err) {
    console.error("[read] getReadonlyAnchorProgram failed", err);
    return null;
  }
}

export type MarketActivityItem = {
  wallet: string;
  walletShort: string;
  username?: string | null;
  displayName: string;
  outcomeIndex: number;
  amountLamports: bigint;
  createdAt: Date | null;
};

export type MarketHistoryPoint = {
  timestamp: number; // ms since epoch
  probability: number; // 0..1 for primary outcome (index 0)
};

/**
 * Fetch all positions (bets) for a market
 */
export async function fetchMarketActivity(
  marketPubkey: string
): Promise<MarketActivityItem[]> {
  const program = await getReadonlyAnchorProgram();
  if (!program) {
    return [];
  }

  try {
    const marketPk = new PublicKey(marketPubkey);

    // Fetch all positions and filter by market
    const allPositions = await program.account.position.all();
    const marketPositions = allPositions.filter((p: any) => {
      const posMarket = p.account.market;
      return posMarket && posMarket.toBase58 ? posMarket.toBase58() === marketPubkey : false;
    });

    // Collect unique wallet addresses
    const wallets = new Set<string>();
    marketPositions.forEach((p: any) => {
      const owner = p.account.owner;
      const wallet = owner?.toBase58 ? owner.toBase58() : owner?.toString() || "";
      if (wallet) wallets.add(wallet);
    });

    // Fetch usernames from Supabase profiles
    const walletToUsername = new Map<string, string | null>();
    if (wallets.size > 0) {
      try {
        const { supabase } = await import("../integrations/supabase/client");
        const walletArray = Array.from(wallets);

        // Query profiles by wallet_address
        const { data: profiles } = await (supabase as any)
          .from("profiles")
          .select("wallet_address, username")
          .in("wallet_address", walletArray);

        if (profiles) {
          profiles.forEach((profile: any) => {
            if (profile.wallet_address) {
              walletToUsername.set(profile.wallet_address, profile.username ?? null);
            }
          });
        }
      } catch (supabaseErr) {
        console.error("[read] Failed to fetch profiles from Supabase", supabaseErr);
        // Continue without usernames
      }
    }

    const items: MarketActivityItem[] = marketPositions.map((p: any) => {
      const owner = p.account.owner;
      const wallet = owner?.toBase58 ? owner.toBase58() : owner?.toString() || "";
      const outcomeIndex = Number(p.account.outcome_index || 0);
      const amount = p.account.amount;
      const amountLamports = typeof amount === "bigint" ? amount : BigInt(amount?.toString() || "0");

      // Position doesn't have created_at, use account info slot as approximation
      const createdAt = null; // Could fetch from transaction history if needed

      // Get username from Supabase lookup
      const username = walletToUsername.get(wallet) ?? null;
      const walletShort = shortenWallet(wallet);
      const displayName = username || walletShort;

      return {
        wallet,
        walletShort,
        username,
        displayName,
        outcomeIndex,
        amountLamports,
        createdAt,
      };
    });

    // Reverse to show newest first (approximate)
    items.reverse();

    console.log("[read] activity items", marketPubkey, items.length);
    return items;
  } catch (err) {
    console.error("[read] fetchMarketActivity failed", err);
    return [];
  }
}

/**
 * Fetch probability history for a market by replaying positions
 */
export async function fetchMarketHistory(
  marketPubkey: string
): Promise<MarketHistoryPoint[]> {
  const program = await getReadonlyAnchorProgram();
  if (!program) {
    return [];
  }

  try {
    const marketPk = new PublicKey(marketPubkey);

    // Get market account for initial pools
    const market = await program.account.market.fetch(marketPk);
    const pools = [...(market.pools || [])].map((p: any) => {
      if (typeof p === "bigint") return p;
      if (typeof p === "number") return BigInt(p);
      if (typeof p === "string") return BigInt(p);
      return BigInt(0);
    });

    // Get all positions for this market
    const allPositions = await program.account.position.all();
    const marketPositions = allPositions.filter((p: any) => {
      const posMarket = p.account.market;
      return posMarket && posMarket.toBase58 ? posMarket.toBase58() === marketPubkey : false;
    });

    const points: MarketHistoryPoint[] = [];

    // Start with initial state
    const initialTotal = pools.reduce((acc, v) => acc + v, BigInt(0));
    const outcomesCount = pools.length;
    if (outcomesCount > 0) {
      const initialProb = initialTotal > BigInt(0)
        ? Number(pools[0]) / Number(initialTotal)
        : 1 / outcomesCount;
      points.push({
        timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago (placeholder)
        probability: initialProb,
      });
    }

    // Process positions in order
    const currentPools = [...pools];
    for (const pos of marketPositions) {
      const outcomeIdx = Number(pos.account.outcome_index || 0);
      const amount = pos.account.amount;
      const stake = typeof amount === "bigint" ? amount : BigInt(amount?.toString() || "0");

      if (outcomeIdx >= 0 && outcomeIdx < currentPools.length) {
        currentPools[outcomeIdx] += stake;
      }

      const total = currentPools.reduce((acc, v) => acc + v, BigInt(0));
      if (total === BigInt(0)) continue;

      const primaryProb = outcomesCount > 0 ? Number(currentPools[0]) / Number(total) : 0.5;

      // Use approximate timestamp (spread over last 7 days)
      const progress = points.length / Math.max(marketPositions.length, 1);
      const timestamp = Date.now() - (1 - progress) * 7 * 24 * 60 * 60 * 1000;

      points.push({
        timestamp,
        probability: primaryProb,
      });
    }

    // Add current state if we have points
    if (points.length === 0 && marketPositions.length === 0) {
      const total = currentPools.reduce((acc, v) => acc + v, BigInt(0));
      const primaryProb = total > BigInt(0) && outcomesCount > 0
        ? Number(currentPools[0]) / Number(total)
        : outcomesCount > 0 ? 1 / outcomesCount : 0.5;
      points.push({
        timestamp: Date.now(),
        probability: primaryProb,
      });
    }

    console.log("[read] history points", marketPubkey, points.length);
    return points;
  } catch (err) {
    console.error("[read] fetchMarketHistory failed", err);
    return [];
  }
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import bs58 from "npm:bs58";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
const YESNO_PROGRAM_ID = Deno.env.get("YESNO_PROGRAM_ID") || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb";
const PLACE_BET_DISCRIMINATOR = Uint8Array.from([222, 62, 67, 220, 63, 166, 126, 33]); // sha256("global:place_bet").slice(0,8)

if (!HELIUS_API_KEY) {
  throw new Error("Missing HELIUS_API_KEY env var");
}

const HELIUS_TX_URL = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Simple helper
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Helper to normalize outcome index from various formats
 * Returns number | null - supports 0-4 (2-5 outcomes)
 */
function normalizeOutcomeIndex(value: any): number | null {
  if (value == null) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const intValue = Math.floor(value);
    if (intValue >= 0 && intValue <= 4 && Number.isInteger(value)) {
      return intValue;
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    // Numeric string
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      const intValue = Math.floor(asNumber);
      if (intValue >= 0 && intValue <= 4) {
        return intValue;
      }
    }
  }

  return null;
}

/**
 * Helper to normalize numeric arrays from event data
 * Handles arrays, objects, JSON strings - returns number[] | null
 */
function normalizeNumericArrayFromEvent(value: any): number[] | null {
  if (value == null) return null;

  let arr: any[] | null = null;

  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === "object") {
    // Event data can come back as {0: "...", 1: "..."}
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
      // ignore parse errors
    }
  }

  if (!arr || arr.length === 0) return null;

  // Map to numbers, filter out non-finite
  const numericArr = arr.map((x: any) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }).filter((n) => n > 0 || n === 0); // Keep all valid numbers

  return numericArr.length > 0 ? numericArr : null;
}

/**
 * Call Helius decoded transactions API to get decoded transaction
 * Returns null on errors or empty responses (never throws)
 */
async function fetchDecodedTx(signature: string, fallbackTx?: any): Promise<any[] | null> {
  try {
    const resp = await fetch(HELIUS_TX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactions: [signature], // IMPORTANT: this exact key + array
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn("[index_bet_event] Helius API error", {
        status: resp.status,
        statusText: resp.statusText,
        body: text,
        signature,
      });
      // Return null instead of throwing
      return null;
    }

    const json = await resp.json();
    if (!Array.isArray(json) || json.length === 0) {
      console.warn("[index_bet_event] Helius returned empty array for signature", signature, ", json:", json);
      // Return minimal structure to allow downstream fallbacks (instruction/account parsing)
      if (fallbackTx) {
        const normalized =
          fallbackTx.transaction ??
          fallbackTx.tx ??
          (fallbackTx.message || fallbackTx.meta
            ? { message: fallbackTx.message, meta: fallbackTx.meta }
            : fallbackTx);
        return normalized ? [normalized] : [];
      }
      return [];
    }

    return json;
  } catch (err) {
    console.warn("[index_bet_event] Failed to fetch decoded transaction from Helius", {
      signature,
      error: err,
    });
    // Return null instead of throwing
    return null;
  }
}

type BetIndexKeys = {
  signature: string;
  blockTimeIso: string | null;
  marketPubkey: string | null;
  bettorPubkey: string | null;
  outcomeIndex: number | null;
  amountLamports: number | null;
  poolsAfter: any | null;
  probsAfter: any | null;
};

function extractFromHeliusJson(json: any[]): Partial<BetIndexKeys> {
  const result: Partial<BetIndexKeys> = {
    blockTimeIso: null,
    marketPubkey: null,
    bettorPubkey: null,
    outcomeIndex: null,
    amountLamports: null,
    poolsAfter: null,
    probsAfter: null,
  };

  if (!Array.isArray(json) || json.length === 0) {
    return result;
  }

  for (const item of json) {
    const blockTimeSec = item?.blockTime ?? item?.timestamp;
    if (blockTimeSec && !result.blockTimeIso) {
      result.blockTimeIso = new Date(blockTimeSec * 1000).toISOString();
    }

    const candidateEvents: any[] = [];
    if (Array.isArray(item?.events)) {
      candidateEvents.push(...item.events);
    }
    const accountData = item?.accountData || item?.accountChanges || [];
    for (const acc of accountData) {
      if (Array.isArray(acc?.events)) {
        candidateEvents.push(...acc.events);
      }
    }

    for (const ev of candidateEvents) {
      const evType = ev?.type || ev?.name || ev?.eventType;
      if (evType !== "BetPlaced" && evType !== "betPlaced") continue;

      result.marketPubkey =
        ev.market ??
        ev.marketPubkey ??
        ev.data?.market ??
        result.marketPubkey;
      result.bettorPubkey =
        ev.bettor ??
        ev.bettorPubkey ??
        ev.data?.bettor ??
        result.bettorPubkey;
      const rawOutcome =
        ev.outcomeIndex ??
        ev.outcome_index ??
        ev.data?.outcomeIndex ??
        ev.data?.outcome_index;
      if (rawOutcome != null && result.outcomeIndex == null) {
        const n = Number(rawOutcome);
        if (Number.isFinite(n)) {
          result.outcomeIndex = n;
        }
      }
      const rawAmount =
        ev.amountLamports ??
        ev.amount_lamports ??
        ev.data?.amountLamports ??
        ev.data?.amount_lamports;
      if (rawAmount != null && result.amountLamports == null) {
        const amt = Number(rawAmount);
        if (Number.isFinite(amt)) {
          result.amountLamports = amt;
        }
      }

      result.poolsAfter =
        ev.poolsAfter ??
        ev.pools_after ??
        ev.data?.poolsAfter ??
        ev.data?.pools_after ??
        result.poolsAfter;
      result.probsAfter =
        ev.probsAfter ??
        ev.probs_after ??
        ev.data?.probsAfter ??
        ev.data?.probs_after ??
        result.probsAfter;
    }
  }

  return result;
}

function extractFromWebhookPayload(payload: any): Partial<BetIndexKeys> {
  const result: Partial<BetIndexKeys> = {
    blockTimeIso: null,
    marketPubkey: null,
    bettorPubkey: null,
    amountLamports: null,
  };

  if (!payload) return result;

  const blockTimeSec =
    payload.blockTime ??
    payload.transaction?.blockTime ??
    payload.slotTime ??
    payload.timestamp;
  if (blockTimeSec) {
    result.blockTimeIso = new Date(blockTimeSec * 1000).toISOString();
  }

  const nativeChanges: any[] = [
    ...(Array.isArray(payload.nativeBalanceChanges) ? payload.nativeBalanceChanges : []),
    ...(Array.isArray(payload.nativeBalanceChange) ? payload.nativeBalanceChange : []),
    ...(Array.isArray(payload.nativeTransfers) ? payload.nativeTransfers : []),
    ...(Array.isArray(payload.accountData) ? payload.accountData : []),
  ];

  if (nativeChanges.length > 0) {
    let bestNegative: { pubkey: string; amount: number } | null = null;
    let bestPositive: { pubkey: string; amount: number } | null = null;

    for (const change of nativeChanges) {
      const rawAmount =
        change?.nativeChange ??
        change?.nativeBalanceChange ??
        change?.amount ??
        change?.nativeBalance ?? // some shapes
        change?.delta;
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const pubkey =
        change?.account ??
        change?.pubkey ??
        change?.user ??
        change?.owner ??
        change?.wallet;
      if (!pubkey) continue;

      if (amount < 0) {
        const abs = Math.abs(amount);
        if (!bestNegative || abs > bestNegative.amount) {
          bestNegative = { pubkey: String(pubkey), amount: abs };
        }
      } else if (amount > 0) {
        const abs = Math.abs(amount);
        if (!bestPositive || abs > bestPositive.amount) {
          bestPositive = { pubkey: String(pubkey), amount: abs };
        }
      }
    }

    if (bestNegative) {
      result.bettorPubkey = bestNegative.pubkey;
      result.amountLamports = bestNegative.amount;
    }

    if (bestPositive && (!bestNegative || bestPositive.pubkey !== bestNegative.pubkey)) {
      result.marketPubkey = bestPositive.pubkey;
      if (result.amountLamports == null) {
        result.amountLamports = bestPositive.amount;
      }
    }
  }

  return result;
}

function findPayloadForSignature(body: any, signature: string): any {
  if (!body) return null;
  if (Array.isArray(body)) {
    const direct = body.find(
      (item) =>
        item?.signature === signature ||
        item?.transactionSignature === signature ||
        item?.txHash === signature ||
        item?.txSig === signature
    );
    if (direct) return direct;
    for (const item of body) {
      if (Array.isArray(item?.transactions)) {
        const nested = item.transactions.find(
          (tx: any) =>
            tx?.signature === signature ||
            tx?.transactionSignature === signature ||
            tx?.txHash === signature
        );
        if (nested) return nested;
      }
    }
    return null;
  }

  return body;
}

function extractFromInstructionAccounts(decodedTx: any, programId: string): Partial<BetIndexKeys> {
  const result: Partial<BetIndexKeys> = {
    blockTimeIso: null,
    marketPubkey: null,
    bettorPubkey: null,
    amountLamports: null,
  };

  if (!decodedTx) return result;

  const blockTimeSec =
    decodedTx.blockTime ??
    decodedTx.timestamp ??
    decodedTx.slotTime ??
    decodedTx?.transaction?.blockTime ??
    decodedTx?.transaction?.timestamp;
  if (blockTimeSec) {
    result.blockTimeIso = new Date(blockTimeSec * 1000).toISOString();
  }

  const message = decodedTx?.transaction?.message ?? decodedTx?.message;
  if (!message) return result;

  const accountKeysRaw: any[] = message.accountKeys ?? [];
  const signerCount: number | null =
    message.header && typeof message.header.numRequiredSignatures === "number"
      ? message.header.numRequiredSignatures
      : null;

  const accountKeys = accountKeysRaw
    .map((key: any, idx: number) => {
      const pubkey = String(
        key?.pubkey ??
          key?.publicKey ??
          key?.account ??
          key?.key ??
          key?.address ??
          key ??
          ""
      ).trim();
      if (!pubkey) return null;
      const signer =
        key?.signer ??
        key?.isSigner ??
        (signerCount != null ? idx < signerCount : false);
      const writable = key?.writable ?? key?.isWritable ?? false;
      return { pubkey, signer: Boolean(signer), writable: Boolean(writable) };
    })
    .filter((k: any) => k);

  const defaultBettor =
    accountKeys.find((k: any) => k.signer)?.pubkey ?? accountKeys[0]?.pubkey ?? null;

  const instructions: any[] = message.instructions ?? [];

  function resolveAccount(ref: any): { pubkey: string; signer: boolean; writable: boolean } | null {
    if (typeof ref === "number") {
      return accountKeys[ref] ?? null;
    }
    if (typeof ref === "string") {
      return (
        accountKeys.find((k: any) => k.pubkey === ref) ??
        accountKeys.find((k: any) => k.pubkey === String(ref))
      ) ?? null;
    }
    if (ref && typeof ref === "object") {
      const pk =
        ref.pubkey ??
        ref.account ??
        ref.address ??
        ref.key ??
        ref.publicKey ??
        ref;
      if (pk) {
        return (
          accountKeys.find((k: any) => k.pubkey === pk) ??
          accountKeys.find((k: any) => k.pubkey === String(pk))
        ) ?? {
          pubkey: String(pk),
          signer: Boolean(ref.signer ?? ref.isSigner),
          writable: Boolean(ref.writable ?? ref.isWritable),
        };
      }
    }
    return null;
  }

  for (const ix of instructions) {
    let ixProgramId: string | null = null;
    if (ix.programIdIndex != null) {
      ixProgramId = accountKeys[ix.programIdIndex]?.pubkey ?? null;
    } else if (ix.programId || ix.program) {
      ixProgramId = String(ix.programId ?? ix.program);
    }
    if (!ixProgramId || String(ixProgramId) !== String(programId)) continue;

    const ixAccounts: any[] = Array.isArray(ix.accounts)
      ? ix.accounts
      : Array.isArray(ix.accountIndexes)
      ? ix.accountIndexes
      : Array.isArray(ix.keys)
      ? ix.keys
      : [];

    let marketPubkey: string | null = null;
    for (const acct of ixAccounts) {
      const resolved = resolveAccount(acct);
      if (!resolved) continue;
      if (resolved.signer) continue;
      if (resolved.writable && !marketPubkey) {
        marketPubkey = resolved.pubkey;
        break;
      }
      if (!marketPubkey) {
        marketPubkey = resolved.pubkey;
      }
    }

    if (marketPubkey) {
      result.marketPubkey = marketPubkey;
    }
    if (defaultBettor && !result.bettorPubkey) {
      result.bettorPubkey = defaultBettor;
    }

    break;
  }

  if (!result.bettorPubkey && defaultBettor) {
    result.bettorPubkey = defaultBettor;
  }

  return result;
}

async function insertBetRow(args: {
  signature: string;
  marketPubkey: string;
  bettorPubkey: string;
  outcomeIndex: number | null;
  outcomeLabel?: string | null;
  username?: string | null;
  amountLamports: number;
  poolsAfter?: any;
  probsAfter?: any;
  blockTimeIso?: string | null;
}) {
  const amountSol = args.amountLamports / LAMPORTS_PER_SOL;
  const row: any = {
    market_pubkey: String(args.marketPubkey),
    bettor_pubkey: String(args.bettorPubkey),
    username: args.username ?? null,
    outcome_index: args.outcomeIndex,
    outcome_label: args.outcomeLabel ?? null,
    amount_sol: amountSol,
    tx_sig: String(args.signature),
    block_time: args.blockTimeIso,
    amount_lamports: args.amountLamports,
    pools_after: args.poolsAfter ?? null,
    probs_after: args.probsAfter ?? null,
  };

  console.log("[index_bet_event][bets] inserting row", {
    txSig: args.signature,
    marketPubkey: args.marketPubkey,
    bettorPubkey: args.bettorPubkey,
    outcomeIndex: args.outcomeIndex,
    amountLamports: args.amountLamports,
  });

  try {
    const { error } = await supabase.from("bets").insert(row);
    if (error) {
      console.error("[indexer][bets] insert error", {
        txSig: args.signature,
        marketPubkey: args.marketPubkey,
        bettorPubkey: args.bettorPubkey,
        outcomeIndex: row.outcome_index,
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
    } else {
      console.log("[index_bet_event][bets] ✅ row inserted", {
        txSig: args.signature,
        marketPubkey: args.marketPubkey,
        bettorPubkey: args.bettorPubkey,
        amountLamports: args.amountLamports,
        outcomeIndex: args.outcomeIndex ?? null,
      });
    }
  } catch (err) {
    console.error("[indexer][bets] unexpected exception during insert", {
      txSig: args.signature,
      marketPubkey: args.marketPubkey,
      bettorPubkey: args.bettorPubkey,
      err,
    });
  }
}

/**
 * Extract Anchor program events from Helius decoded transaction
 */
function extractProgramEvents(heliusTx: any, programId: string): any[] {
  const events: any[] = [];

  if (!heliusTx) return events;

  // Helius exposes events in various places
  const eventSources = [
    heliusTx.events,
    heliusTx.nativeTransfers,
    heliusTx.accountData,
  ];

  // Also check nested structures
  if (heliusTx.events && Array.isArray(heliusTx.events)) {
    for (const ev of heliusTx.events) {
      const evProg = ev.programId || ev.program || ev.program_id || ev.source;
      if (evProg && String(evProg) === programId) {
        events.push(ev);
      }
    }
  }

  // Check programEvents / programEvent structures
  if (heliusTx.programEvents && Array.isArray(heliusTx.programEvents)) {
    for (const progEv of heliusTx.programEvents) {
      const progId = progEv.programId || progEv.program || progEv.program_id;
      if (progId && String(progId) === programId) {
        if (Array.isArray(progEv.events)) {
          events.push(...progEv.events);
        } else {
          events.push(progEv);
        }
      }
    }
  }

  // Check instructions for events (some formats expose events per instruction)
  if (heliusTx.instructions && Array.isArray(heliusTx.instructions)) {
    for (const ix of heliusTx.instructions) {
      if (ix.programId && String(ix.programId) === programId) {
        if (ix.events && Array.isArray(ix.events)) {
          events.push(...ix.events);
        }
      }
    }
  }

  // Check for parsed events structure (Helius sometimes returns events here)
  if (heliusTx.parsed && Array.isArray(heliusTx.parsed)) {
    for (const parsed of heliusTx.parsed) {
      if (parsed.programId && String(parsed.programId) === programId) {
        if (parsed.events && Array.isArray(parsed.events)) {
          events.push(...parsed.events);
        } else if (parsed.name) {
          // Single event object
          events.push(parsed);
        }
      }
    }
  }

  // Check for accountData that contains events (some Helius formats)
  if (heliusTx.accountData && Array.isArray(heliusTx.accountData)) {
    for (const account of heliusTx.accountData) {
      if (account.events && Array.isArray(account.events)) {
        for (const ev of account.events) {
          const evProg = ev.programId || ev.program || ev.program_id;
          if (evProg && String(evProg) === programId) {
            events.push(ev);
          }
        }
      }
    }
  }

  return events;
}

function extractOutcomeAndPoolsFromBetEvent(ev: any): {
  outcomeIndex: number | null;
  poolsAfter: number[] | null;
  probsAfter: number[] | null;
} {
  const evData = ev?.data || ev?.fields || ev?.parsed || ev || {};
  let outcomeIndex: number | null = null;

  const outcomeCandidates = [
    evData.outcome_index,
    evData.outcomeIndex,
    evData.outcome,
    evData.data?.outcome_index,
    evData.data?.outcomeIndex,
    evData.data?.outcome,
  ];

  for (const cand of outcomeCandidates) {
    const n = Number(cand);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      outcomeIndex = n;
      break;
    }
  }

  const poolsAfter =
    normalizeNumericArrayFromEvent(evData.pools_after ?? evData.poolsAfter) ??
    null;
  const probsAfter =
    normalizeNumericArrayFromEvent(evData.probs_after ?? evData.probsAfter) ??
    null;

  return { outcomeIndex, poolsAfter, probsAfter };
}

function extractOutcomeIndexFromInstructionData(args: {
  ix: any;
  signature: string;
  ixIndex: number;
}): number | null {
  const { ix, signature, ixIndex } = args;
  const dataB58 = ix?.data;
  if (!dataB58 || typeof dataB58 !== "string") {
    console.warn("[index_bet_event] ix.data missing or not string", { signature, ixIndex });
    return null;
  }

  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(dataB58);
  } catch (err) {
    console.warn("[index_bet_event] failed to base58 decode ix.data", { signature, ixIndex, err });
    return null;
  }

  console.log("[index_bet_event] ix.data decoded", {
    signature,
    ixIndex,
    len: decoded.length,
    firstBytes: Array.from(decoded.slice(0, 16)),
  });

  if (decoded.length < 9) {
    console.warn("[index_bet_event] decoded ix.data too short for outcome", {
      signature,
      ixIndex,
      len: decoded.length,
    });
    return null;
  }

  const outcomeIndex = Number(decoded[8]);
  if (outcomeIndex !== 0 && outcomeIndex !== 1) {
    console.warn("[index_bet_event] decoded unexpected outcomeIndex byte", {
      signature,
      ixIndex,
      outcomeIndex,
    });
  }

  return outcomeIndex;
}

function findInstructionOutcomeIndex(args: {
  decodedTx: any;
  programId: string;
  signature: string;
}): number | null {
  const { decodedTx, programId, signature } = args;
  const message = decodedTx?.transaction?.message;
  if (!message || !Array.isArray(message.instructions)) {
    console.warn("[index_bet_event] no instructions in decodedTx for signature", signature);
    return null;
  }

  let found: number | null = null;

  message.instructions.forEach((ix: any, ixIndex: number) => {
    if (!ix) return;
    let ixProgramId: string | null = null;
    if (ix.programIdIndex !== undefined && ix.programIdIndex !== null && message.accountKeys) {
      const pk = message.accountKeys[ix.programIdIndex];
      ixProgramId = pk?.pubkey ?? pk?.toString?.() ?? String(pk ?? "");
    } else if (ix.programId) {
      ixProgramId = String(ix.programId);
    }
    if (!ixProgramId || String(ixProgramId) !== String(programId)) return;
    const outcome = extractOutcomeIndexFromInstructionData({ ix, signature, ixIndex });
    if (outcome !== null && outcome !== undefined && found === null) {
      console.log("[index_bet_event] decoded outcomeIndex from ix.data", {
        signature,
        ixIndex,
        outcomeIndex: outcome,
      });
      found = outcome;
    }
  });

  return found;
}

Deno.serve(async (req) => {
  const start = Date.now();

  if (req.method !== "POST") {
    console.log("[index_bet_event] non-POST request:", req.method);
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    console.error("[index_bet_event] Failed to parse JSON body:", e);
    return new Response("Bad JSON", { status: 400 });
  }

  // Log incoming payload structure for debugging
  try {
    const raw = JSON.stringify(body);
    const truncated = raw.length > 2000 ? raw.slice(0, 2000) + "..." : raw;
    console.log("[index_bet_event] Incoming payload (truncated):", truncated);
    console.log("[index_bet_event] Payload keys:", Object.keys(body || {}));
  } catch {
    // ignore
  }

  try {
    // Extract transaction signature(s) from webhook body
    const signatures: string[] = [];

    // Handle various webhook formats
    if (Array.isArray(body)) {
      for (const item of body) {
        const sig = item.signature || item.transactionSignature || item.txHash || item.sig;
        if (sig) signatures.push(String(sig));
      }
    } else {
      const sig = body.signature || body.transactionSignature || body.txHash || body.sig;
      if (sig) signatures.push(String(sig));

      // Also check nested structures
      if (Array.isArray(body.transactions)) {
        for (const tx of body.transactions) {
          const txSig = tx.signature || tx.transactionSignature || tx.txHash;
          if (txSig) signatures.push(String(txSig));
        }
      }
    }

    console.log("[index_bet_event] Found", signatures.length, "signature(s)");

    const programId = YESNO_PROGRAM_ID;

    // Extract account data from webhook (shared across all signatures)
    const accountData: any[] = Array.isArray(body.accountData)
      ? body.accountData
      : Array.isArray(body.accountChanges)
      ? body.accountChanges
      : Array.isArray(body.accounts)
      ? body.accounts
      : [];

    for (const signature of signatures) {
      console.log("[index_bet_event] Processing signature:", signature);

      const payloadEntry = findPayloadForSignature(body, signature);
      const decodedTxs = await fetchDecodedTx(
        signature,
        payloadEntry?.transaction ?? payloadEntry?.tx ?? payloadEntry
      );
      const decoded = decodedTxs?.[0] ?? null;

      const fromHelius = extractFromHeliusJson(decodedTxs ?? []);
      const fromWebhook = extractFromWebhookPayload(payloadEntry);
      const fromInstructions = extractFromInstructionAccounts(decoded ?? payloadEntry, programId);
      const outcomeFromIx = findInstructionOutcomeIndex({
        decodedTx: decoded ?? payloadEntry,
        programId,
        signature,
      });
      const instructionOutcomeNormalized = normalizeOutcomeIndex(outcomeFromIx);

      const blockTimeIso =
        fromHelius.blockTimeIso ??
        fromWebhook.blockTimeIso ??
        fromInstructions.blockTimeIso ??
        (decoded
          ? new Date(
              ((decoded.blockTime ?? decoded.timestamp ?? Math.floor(Date.now() / 1000)) as number) *
                1000
            ).toISOString()
          : new Date().toISOString());

      const baseKeys: BetIndexKeys = {
        signature,
        blockTimeIso,
        marketPubkey:
          fromHelius.marketPubkey ??
          fromWebhook.marketPubkey ??
          fromInstructions.marketPubkey ??
          null,
        bettorPubkey:
          fromHelius.bettorPubkey ??
          fromWebhook.bettorPubkey ??
          fromInstructions.bettorPubkey ??
          null,
        outcomeIndex: fromHelius.outcomeIndex ?? null,
        amountLamports:
          fromHelius.amountLamports ??
          fromWebhook.amountLamports ??
          fromInstructions.amountLamports ??
          null,
        poolsAfter: fromHelius.poolsAfter ?? null,
        probsAfter: fromHelius.probsAfter ?? null,
      };

      const baseOutcomeNormalized = normalizeOutcomeIndex(fromHelius.outcomeIndex ?? baseKeys.outcomeIndex);
      const fromInstructionOutcomeNormalized = normalizeOutcomeIndex(fromInstructions.outcomeIndex);
      let bestEventOutcome: number | null = null;
      const basePools = normalizeNumericArrayFromEvent(baseKeys.poolsAfter);
      const baseProbs = normalizeNumericArrayFromEvent(baseKeys.probsAfter);
      let bestPoolsAfter: number[] | null = basePools ?? null;
      let bestProbsAfter: number[] | null = baseProbs ?? null;

      const mergedKeys: BetIndexKeys = {
        signature,
        blockTimeIso: baseKeys.blockTimeIso,
        marketPubkey: baseKeys.marketPubkey ?? fromInstructions.marketPubkey ?? null,
        bettorPubkey: baseKeys.bettorPubkey ?? fromInstructions.bettorPubkey ?? null,
        outcomeIndex: null,
        amountLamports: baseKeys.amountLamports ?? fromInstructions.amountLamports ?? null,
        poolsAfter: bestPoolsAfter,
        probsAfter: bestProbsAfter,
      };

      console.log("[index_bet_event] merged keys", baseKeys);

      const programEvents = decoded ? extractProgramEvents(decoded, programId) : [];
      const programEventsCount = programEvents.length;
      if (decoded) {
        console.log("[index_bet_event] Found", programEvents.length, "program event(s) for", programId);
      }

  const hasBetPlacedEvent = programEvents.some(
    (ev) => ev.type === "ProgramEvent" && ev.event?.name === "BetPlaced"
  );
  const hasMarketCreatedEvent = programEvents.some(
    (ev) => ev.type === "ProgramEvent" && ev.event?.name === "MarketCreated"
  );
  const hasWinnerResolvedEvent = programEvents.some(
    (ev) => ev.type === "ProgramEvent" && ev.event?.name === "WinnerResolved"
  );
  const hasWinningsClaimedEvent = programEvents.some(
    (ev) => ev.type === "ProgramEvent" && ev.event?.name === "WinningsClaimed"
  );
  const hasPlaceBetIx = outcomeFromIx != null;

  const isDefinitelyNotBet =
    hasMarketCreatedEvent ||
    hasWinnerResolvedEvent ||
    hasWinningsClaimedEvent;

  const hasBaseKeys =
    (baseKeys.marketPubkey ?? fromInstructions.marketPubkey) != null &&
    (baseKeys.bettorPubkey ?? fromInstructions.bettorPubkey) != null &&
    (baseKeys.amountLamports ?? fromInstructions.amountLamports) != null;

  const isLikelyBet =
    hasBetPlacedEvent || hasPlaceBetIx || (!isDefinitelyNotBet && hasBaseKeys);

  const indexedEvents: string[] = [];
  let betRowsInserted = 0;

      for (const ev of programEvents) {
        const evType = ev.name || ev.eventType || ev.event_type || ev.type || ev.event;
        const evData = ev.data || ev.fields || ev.parsed || ev;

        if (!evType) continue;

        // Handle BetPlaced event
        if (evType === "BetPlaced" || evType === "betPlaced") {
          const eventMarket =
            evData.market ??
            evData.market_pubkey ??
            evData.data?.market ??
            baseKeys.marketPubkey;
          const eventBettor =
            evData.bettor ??
            evData.bettor_pubkey ??
            evData.data?.bettor ??
            baseKeys.bettorPubkey;

          const { outcomeIndex: extractedOutcomeIndex, poolsAfter: extractedPoolsAfter, probsAfter: extractedProbsAfter } =
            extractOutcomeAndPoolsFromBetEvent(ev);
          const eventOutcomeCandidates = [
            evData.outcome_index,
            evData.outcomeIndex,
            evData.data?.outcome_index,
            evData.data?.outcomeIndex,
            extractedOutcomeIndex,
          ];
         let eventOutcome: number | null = null;
         for (const candidate of eventOutcomeCandidates) {
           const normalized = normalizeOutcomeIndex(candidate);
           if (normalized != null) {
             eventOutcome = normalized;
             break;
           }
         }
          if (eventOutcome != null) {
            bestEventOutcome = eventOutcome; // event has highest priority
          }

          const rawAmount =
            evData.amount_lamports ??
            evData.amountLamports ??
            evData.data?.amount_lamports ??
            null;
          let eventAmount: number | null = null;
          if (rawAmount != null) {
            const parsed = Number(rawAmount);
            if (!Number.isNaN(parsed)) {
              eventAmount = parsed;
            }
          }
          if (eventAmount == null) {
            eventAmount = baseKeys.amountLamports;
          }

          let poolsAfter =
            normalizeNumericArrayFromEvent(evData.pools_after ?? evData.poolsAfter) ??
            extractedPoolsAfter ??
            baseKeys.poolsAfter;
          let probsAfter =
            normalizeNumericArrayFromEvent(evData.probs_after ?? evData.probsAfter) ??
            extractedProbsAfter ??
            baseKeys.probsAfter;
          if (!probsAfter && poolsAfter && poolsAfter.length > 0) {
            const total = poolsAfter.reduce((a, b) => a + b, 0);
            if (total > 0) {
              probsAfter = poolsAfter.map((p: number) => p / total);
            }
          }
          if (poolsAfter && !bestPoolsAfter) {
            bestPoolsAfter = poolsAfter;
          }
          if (probsAfter && !bestProbsAfter) {
            bestProbsAfter = probsAfter;
          }

          const baseOutcomeIndex =
            typeof baseKeys.outcomeIndex === "number"
              ? baseKeys.outcomeIndex
              : null;

          const finalMarket =
            eventMarket ??
            baseKeys.marketPubkey ??
            fromInstructions.marketPubkey ??
            null;
          const finalBettor =
            eventBettor ??
            baseKeys.bettorPubkey ??
            fromInstructions.bettorPubkey ??
            null;
          const finalAmountLamports =
            eventAmount ??
            baseKeys.amountLamports ??
            fromInstructions.amountLamports ??
            null;
          const mergedOutcomeIndex =
            eventOutcome ??
            instructionOutcomeNormalized ??
            baseOutcomeIndex ??
            null;

          console.debug("[index_bet_event] BetPlaced outcome resolution", {
            signature,
            eventOutcome,
            baseOutcomeIndex,
            finalOutcome: mergedOutcomeIndex,
          });

          if (finalMarket == null || finalBettor == null || finalAmountLamports == null) {
            console.warn("[index_bet_event] ❌ cannot insert bet (event path) due to missing keys", {
              signature,
              eventMarket: finalMarket,
              eventBettor: finalBettor,
              eventAmount: finalAmountLamports,
              outcomeIndex: mergedOutcomeIndex,
            });
            continue;
          }

          if (mergedOutcomeIndex == null) {
            console.warn("[index_bet_event] BetPlaced event missing outcome index; inserting as Unknown", {
              signature,
              eventMarket: finalMarket,
              eventBettor: finalBettor,
            });
          }

          console.log("[index_bet_event] inserting bet row", {
            signature,
            marketPubkey: finalMarket,
            bettorPubkey: finalBettor,
            outcomeIndex: mergedOutcomeIndex,
            amountLamports: finalAmountLamports,
          });

          await insertBetRow({
            signature,
            marketPubkey: finalMarket,
            bettorPubkey: finalBettor,
            outcomeIndex: mergedOutcomeIndex,
            amountLamports: finalAmountLamports,
            poolsAfter,
            probsAfter,
            blockTimeIso: baseKeys.blockTimeIso,
          });

          betRowsInserted += 1;
          indexedEvents.push("BetPlaced");
          continue;
        }

        // Handle MarketCreated event
        if (evType === "MarketCreated" || evType === "marketCreated") {
          const market = evData.market || evData.data?.market || evData.args?.market || null;
          const creator = evData.creator || evData.data?.creator || evData.args?.creator || null;
          const cutoff_ts = evData.cutoff_ts || evData.cutoffTs || evData.data?.cutoff_ts || evData.args?.cutoff_ts || null;
          const outcomes_count = evData.outcomes_count || evData.outcomesCount || evData.data?.outcomes_count || evData.args?.outcomes_count || null;
          const question_hash = evData.question_hash || evData.questionHash || evData.data?.question_hash || evData.args?.question_hash || null;

          if (market && creator && cutoff_ts != null && outcomes_count != null) {
            const row: any = {
              market_pubkey: String(market),
              creator_pubkey: String(creator),
              cutoff_ts: Number(cutoff_ts),
              outcomes_count: Number(outcomes_count),
              question_hash: question_hash ? String(question_hash) : null,
              block_time: blockTimeIso,
              tx_sig: String(signature),
            };

            const { error } = await supabase.from("market_events").insert(row);
            if (error) {
              if (error.code === "23505" || error.message?.includes("duplicate")) {
                console.log("[index_bet_event] Duplicate MarketCreated (expected):", signature);
              } else {
                console.error("[index_bet_event] MarketCreated insert error:", error);
              }
            } else {
              indexedEvents.push("MarketCreated");
              console.log("[index_bet_event] Indexed MarketCreated:", signature);
            }
          } else {
            const eventSample = JSON.stringify(evData).slice(0, 600);
            console.warn("[index_bet_event] MarketCreated missing required fields", {
              signature,
              eventSample,
            });
          }
        }

        // Handle WinnerResolved event
        if (evType === "WinnerResolved" || evType === "winnerResolved") {
          const market = evData.market || evData.data?.market || evData.args?.market || baseKeys.marketPubkey;
          const winner_index = evData.winner_index !== undefined ? evData.winner_index : (evData.winnerIndex !== undefined ? evData.winnerIndex : (evData.data?.winner_index !== undefined ? evData.data.winner_index : (evData.args?.winner_index !== undefined ? evData.args.winner_index : null)));
          const auto_void = evData.auto_void !== undefined ? evData.auto_void : (evData.autoVoid !== undefined ? evData.autoVoid : (evData.data?.auto_void !== undefined ? evData.data.auto_void : (evData.args?.auto_void !== undefined ? evData.args.auto_void : false)));
          const resolved_total_pool = evData.resolved_total_pool || evData.resolvedTotalPool || evData.data?.resolved_total_pool || evData.args?.resolved_total_pool || null;
          const resolved_win_pool = evData.resolved_win_pool || evData.resolvedWinPool || evData.data?.resolved_win_pool || evData.args?.resolved_win_pool || null;
          const fees_transferred = evData.fees_transferred || evData.feesTransferred || evData.data?.fees_transferred || evData.args?.fees_transferred || null;

          if (market && winner_index != null) {
            const row: any = {
              market_pubkey: String(market),
              winner_index: Number(winner_index),
              auto_void: Boolean(auto_void),
              resolved_total_pool: resolved_total_pool != null ? Number(resolved_total_pool) : null,
              resolved_win_pool: resolved_win_pool != null ? Number(resolved_win_pool) : null,
              fees_transferred: fees_transferred != null ? Number(fees_transferred) : null,
              block_time: blockTimeIso,
              tx_sig: String(signature),
            };

            const { error } = await supabase.from("market_resolutions").insert(row);
            if (error) {
              if (error.code === "23505" || error.message?.includes("duplicate")) {
                console.log("[index_bet_event] Duplicate WinnerResolved (expected):", signature);
              } else {
                console.error("[index_bet_event] WinnerResolved insert error:", error);
              }
            } else {
              indexedEvents.push("WinnerResolved");
              console.log("[index_bet_event] Indexed WinnerResolved:", signature);
            }
          } else {
            const eventSample = JSON.stringify(evData).slice(0, 600);
            console.warn("[index_bet_event] WinnerResolved missing required fields", {
              signature,
              eventSample,
            });
          }
        }

        // Handle WinningsClaimed event
        if (evType === "WinningsClaimed" || evType === "winningsClaimed") {
          const market = evData.market || evData.data?.market || evData.args?.market || baseKeys.marketPubkey;
          const user = evData.user || evData.data?.user || evData.args?.user || baseKeys.bettorPubkey;
          const amount = evData.amount || evData.data?.amount || evData.args?.amount || null;

          if (market && user && amount != null) {
            const row: any = {
              market_pubkey: String(market),
              user_pubkey: String(user),
              amount_lamports: Number(amount),
              block_time: blockTimeIso,
              tx_sig: String(signature),
            };

            const { error } = await supabase.from("claims").insert(row);
            if (error) {
              if (error.code === "23505" || error.message?.includes("duplicate")) {
                console.log("[index_bet_event] Duplicate WinningsClaimed (expected):", signature);
              } else {
                console.error("[index_bet_event] WinningsClaimed insert error:", error);
              }
            } else {
              indexedEvents.push("WinningsClaimed");
              console.log("[index_bet_event] Indexed WinningsClaimed:", signature);
            }
          } else {
            const eventSample = JSON.stringify(evData).slice(0, 600);
            console.warn("[index_bet_event] WinningsClaimed missing required fields", {
              signature,
              eventSample,
            });
          }
        }
      }

      const mergedOutcomeIndex =
        bestEventOutcome ??
        instructionOutcomeNormalized ??
        fromInstructionOutcomeNormalized ??
        baseOutcomeNormalized ??
        null;

      const finalMerged: BetIndexKeys = {
        ...mergedKeys,
        outcomeIndex: mergedOutcomeIndex,
        poolsAfter: bestPoolsAfter ?? mergedKeys.poolsAfter ?? null,
        probsAfter: bestProbsAfter ?? mergedKeys.probsAfter ?? null,
      };

      // Heuristic: treat tx as a bet when we saw a BetPlaced event or when we have
      // clear bet-like base keys and no conflicting market/resolution/claim events.
      // This keeps non-bet events out of bets while still indexing bets when Helius
      // returns programEventsCount = 0.
      if (betRowsInserted === 0) {
        if (!isLikelyBet) {
          console.warn("[index_bet_event] not a BetPlaced tx; skipping fallback insert", {
            signature,
            hasBetPlacedEvent,
            hasMarketCreatedEvent,
            hasWinnerResolvedEvent,
            hasWinningsClaimedEvent,
            programEventsCount,
            baseKeys,
          });
        } else if (!hasBaseKeys) {
          console.warn("[index_bet_event] BetPlaced-like tx but missing base keys; skipping insert", {
            signature,
            baseKeys,
          });
        } else {
          const outcomeIndex = finalMerged.outcomeIndex;
          if (outcomeIndex == null) {
            console.warn("[index_bet_event] BetPlaced-like tx missing outcome index; inserting as Unknown", {
              signature,
              baseKeys,
              finalMergedOutcomeIndex: finalMerged.outcomeIndex,
            });
          }
          console.log("[index_bet_event] inserting bet row", {
            signature,
            marketPubkey: finalMerged.marketPubkey,
            bettorPubkey: finalMerged.bettorPubkey,
            outcomeIndex,
            amountLamports: finalMerged.amountLamports,
          });
          await insertBetRow({
            signature,
            marketPubkey: finalMerged.marketPubkey!,
            bettorPubkey: finalMerged.bettorPubkey!,
            outcomeIndex,
            amountLamports: finalMerged.amountLamports!,
            poolsAfter: finalMerged.poolsAfter ?? null,
            probsAfter: finalMerged.probsAfter ?? null,
            blockTimeIso: finalMerged.blockTimeIso ?? blockTimeIso ?? null,
          });
          betRowsInserted += 1;
          indexedEvents.push("BetPlaced (webhook fallback)");
          console.log("[index_bet_event] ✅ fallback bet row inserted", {
            signature,
            outcomeIndex,
          });
        }
      }

      // Summary log per transaction
      if (indexedEvents.length > 0) {
        console.log("[index_bet_event] Transaction indexed:", {
          signature,
          events: indexedEvents.join(", "),
        });
      } else {
        console.warn("[index_bet_event] No events indexed for transaction", {
          signature,
          programEventsCount: programEvents.length,
          marketPubkey: baseKeys.marketPubkey,
          bettorPubkey: baseKeys.bettorPubkey,
        });
      }
    }
  } catch (err) {
    console.error("[index_bet_event] Processing failed:", err);
  }

  const ms = Date.now() - start;
  console.log(`[index_bet_event] Request handled in ${ms}ms`);

  return new Response("ok", { status: 200 });
});

/**
 * SQL SCHEMA REFERENCE
 * 
 * Run the SQL block below in Supabase SQL Editor to create/update all tables.
 * 
 * ============================================================================
 * -- Supabase schema for yesno_markets indexing
 * -- Run this SQL block once in the Supabase SQL Editor
 * ============================================================================
 * 
 * -- bets table (existing, ensure all columns exist)
 * CREATE TABLE IF NOT EXISTS public.bets (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   market_pubkey text NOT NULL,
 *   bettor_pubkey text NOT NULL,
 *   username text,
 *   outcome_index integer,
 *   outcome_label text,
 *   amount_lamports bigint,
 *   amount_sol numeric,
 *   tx_sig text UNIQUE,
 *   block_time timestamptz,
 *   created_at timestamptz DEFAULT now(),
 *   pools_after jsonb,
 *   probs_after jsonb
 * );
 * 
 * -- market_events table (for MarketCreated)
 * CREATE TABLE IF NOT EXISTS public.market_events (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   market_pubkey text NOT NULL,
 *   creator_pubkey text NOT NULL,
 *   cutoff_ts bigint,
 *   outcomes_count integer,
 *   question_hash text,
 *   block_time timestamptz,
 *   tx_sig text,
 *   created_at timestamptz DEFAULT now()
 * );
 * 
 * -- market_resolutions table (for WinnerResolved)
 * CREATE TABLE IF NOT EXISTS public.market_resolutions (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   market_pubkey text NOT NULL,
 *   winner_index integer,
 *   auto_void boolean DEFAULT false,
 *   resolved_total_pool bigint,
 *   resolved_win_pool bigint,
 *   fees_transferred bigint,
 *   block_time timestamptz,
 *   tx_sig text,
 *   created_at timestamptz DEFAULT now()
 * );
 * 
 * -- claims table (for WinningsClaimed)
 * CREATE TABLE IF NOT EXISTS public.claims (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   market_pubkey text NOT NULL,
 *   user_pubkey text NOT NULL,
 *   amount_lamports bigint,
 *   block_time timestamptz,
 *   tx_sig text,
 *   created_at timestamptz DEFAULT now()
 * );
 * 
 * -- Indexes for performance
 * CREATE INDEX IF NOT EXISTS bets_market_pubkey_idx ON public.bets(market_pubkey);
 * CREATE INDEX IF NOT EXISTS bets_block_time_idx ON public.bets(block_time);
 * CREATE INDEX IF NOT EXISTS bets_bettor_pubkey_idx ON public.bets(bettor_pubkey);
 * CREATE INDEX IF NOT EXISTS bets_tx_sig_unique ON public.bets(tx_sig);
 * 
 * CREATE INDEX IF NOT EXISTS market_events_market_pubkey_idx ON public.market_events(market_pubkey);
 * CREATE INDEX IF NOT EXISTS market_events_block_time_idx ON public.market_events(block_time);
 * 
 * CREATE INDEX IF NOT EXISTS market_resolutions_market_pubkey_idx ON public.market_resolutions(market_pubkey);
 * CREATE INDEX IF NOT EXISTS market_resolutions_block_time_idx ON public.market_resolutions(block_time);
 * 
 * CREATE INDEX IF NOT EXISTS claims_market_pubkey_idx ON public.claims(market_pubkey);
 * CREATE INDEX IF NOT EXISTS claims_user_pubkey_idx ON public.claims(user_pubkey);
 * CREATE INDEX IF NOT EXISTS claims_block_time_idx ON public.claims(block_time);
 * 
 * ============================================================================
 */

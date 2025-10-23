// src/lib/actions/build.ts
// Fully edited version — drop-in replacement (now includes buildSweepFeesTx)

import {
  PublicKey,
  Connection,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  buildPlaceBetIx,
  buildResolveMarketIx,
  buildClaimWinningsIx,
  // If your builders file already exports a sweep helper, keep this import name:
  // e.g., buildSweepFeesIx(connection, { authority, market? })
  buildSweepFeesIx,
} from "@/lib/program/builders";

import {
  resolveRpcUrl,
  decodeCluster,
  type ClusterName as Cluster,
} from "@/lib/actions/connection";

/* ---------------------------------- utils --------------------------------- */

function conn(cluster: Cluster): Connection {
  return new Connection(resolveRpcUrl(cluster), { commitment: "confirmed" });
}

function asPubkey(input: string, field: string): PublicKey {
  try {
    return new PublicKey(input);
  } catch {
    throw new Error(`Invalid public key for "${field}": ${input}`);
  }
}

function assertStr(v: unknown, field: string): string {
  const s = String(v ?? "").trim();
  if (!s) throw new Error(`Missing required field "${field}"`);
  return s;
}

function maybeCUPrice(ixs: TransactionInstruction[], microLamports?: number) {
  if (!microLamports || !Number.isFinite(microLamports) || microLamports <= 0) {
    return;
  }
  ixs.unshift(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: Math.floor(microLamports),
    })
  );
}

/* ------------------------------- place bet -------------------------------- */

export type BuildPlaceBetParams = {
  cluster?: string | null; // "devnet" | "testnet" | "mainnet-beta" (defaults to devnet)
  payer: string; // wallet pubkey (base58)
  market: string; // market pubkey (base58)
  side: "yes" | "no";
  /** Amount in base units (e.g., 1 USDC with 6 decimals => "1000000"). Keep as string to avoid JS precision issues. */
  amountBaseUnits: string;
  /** Client-provided fresh blockhash string */
  recentBlockhash: string;
  /** Optional priority fee (micro lamports per CU) */
  priorityFeeMicroLamports?: number;
};

export async function buildPlaceBetTx(params: BuildPlaceBetParams): Promise<VersionedTransaction> {
  const cluster = decodeCluster(params.cluster);
  const connection = conn(cluster);

  const payer = asPubkey(assertStr(params.payer, "payer"), "payer");
  const market = asPubkey(assertStr(params.market, "market"), "market");
  const side = assertStr(params.side, "side").toLowerCase() === "yes" ? "yes" : "no";
  const amountBaseUnits = assertStr(params.amountBaseUnits, "amountBaseUnits");
  const recentBlockhash = assertStr(params.recentBlockhash, "recentBlockhash");

  const ixs: TransactionInstruction[] = await buildPlaceBetIx(connection, {
    payer,
    market,
    side,
    amountBaseUnits,
  });

  maybeCUPrice(ixs, params.priorityFeeMicroLamports);

  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

/* ---------------------------- resolve market ------------------------------ */

export type BuildResolveMarketParams = {
  cluster?: string | null;
  /** Owner/authority wallet that can resolve the market */
  resolver: string;
  market: string;
  /** "yes" | "no" */
  outcome: "yes" | "no";
  recentBlockhash: string;
  priorityFeeMicroLamports?: number;
};

export async function buildResolveMarketTx(params: BuildResolveMarketParams): Promise<VersionedTransaction> {
  const cluster = decodeCluster(params.cluster);
  const connection = conn(cluster);

  const resolver = asPubkey(assertStr(params.resolver, "resolver"), "resolver");
  const market = asPubkey(assertStr(params.market, "market"), "market");
  const outcome = assertStr(params.outcome, "outcome").toLowerCase() === "yes" ? "yes" : "no";
  const recentBlockhash = assertStr(params.recentBlockhash, "recentBlockhash");

  const ixs: TransactionInstruction[] = await buildResolveMarketIx(connection, {
    resolver,
    market,
    outcome,
  });

  maybeCUPrice(ixs, params.priorityFeeMicroLamports);

  const msg = new TransactionMessage({
    payerKey: resolver,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

/* ----------------------------- claim winnings ----------------------------- */

export type BuildClaimWinningsParams = {
  cluster?: string | null;
  /** Bettor wallet claiming the position */
  claimer: string;
  market: string;
  recentBlockhash: string;
  priorityFeeMicroLamports?: number;
};

export async function buildClaimWinningsTx(params: BuildClaimWinningsParams): Promise<VersionedTransaction> {
  const cluster = decodeCluster(params.cluster);
  const connection = conn(cluster);

  const claimer = asPubkey(assertStr(params.claimer, "claimer"), "claimer");
  const market = asPubkey(assertStr(params.market, "market"), "market");
  const recentBlockhash = assertStr(params.recentBlockhash, "recentBlockhash");

  const ixs: TransactionInstruction[] = await buildClaimWinningsIx(connection, {
    claimer,
    market,
  });

  maybeCUPrice(ixs, params.priorityFeeMicroLamports);

  const msg = new TransactionMessage({
    payerKey: claimer,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

/* -------------------------------- sweep fees ------------------------------ */
/**
 * Supports sweeping fees either for a specific market or (if your program supports it)
 * for the whole program authority. If your builder requires a market, just provide it.
 */
export type BuildSweepFeesParams = {
  cluster?: string | null;
  authority: string;            // owner/authority wallet pubkey (base58)
  market?: string | null;       // optional market pubkey (base58)
  recentBlockhash: string;
  priorityFeeMicroLamports?: number;
};

export async function buildSweepFeesTx(params: BuildSweepFeesParams): Promise<VersionedTransaction> {
  const cluster = decodeCluster(params.cluster);
  const connection = conn(cluster);

  const authority = asPubkey(assertStr(params.authority, "authority"), "authority");
  const recentBlockhash = assertStr(params.recentBlockhash, "recentBlockhash");

  const maybeMarketStr = (params.market ?? "").toString().trim();
  const market = maybeMarketStr ? asPubkey(maybeMarketStr, "market") : undefined;

  const ixs: TransactionInstruction[] = await buildSweepFeesIx(connection, {
    authority,
    ...(market ? { market } : {}),
  });

  maybeCUPrice(ixs, params.priorityFeeMicroLamports);

  const msg = new TransactionMessage({
    payerKey: authority,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

/* ------------------------------ serialization ---------------------------- */
/**
 * Helper for API routes: serialize a VersionedTransaction (unsigned) to base64
 * for transport back to the client for signing.
 */
export function toBase64Unsigned(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

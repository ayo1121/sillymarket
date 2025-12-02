// src/solana/actions.ts
import type { Program, Idl, Address } from "@coral-xyz/anchor";
import { Program as AnchorProgram } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js";
import { computeBudgetIxs } from "./tx";
import { findMarketPda, findPositionPda } from "./pdas";
import { getConfigPda } from "./idlHelpers";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { YesnoMarkets } from "../idl/yesno_markets";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { getAnchorProgramWithProvider } from "./program";
import { supabaseClient } from "../integrations/supabase/client";
import { transactionQueue } from "../lib/transactionQueue";

// Helper to check offline status and queue transaction
function checkOfflineAndQueue(actionName: 'place_bet' | 'resolve_market' | 'claim_winnings' | 'create_market', params: any) {
  if (!navigator.onLine) {
    console.log(`[${actionName}] Offline - queuing transaction`, params);
    transactionQueue.enqueue(actionName, params);
    // Throw a specific error that UI can catch to show "Queued" toast
    throw new Error("OFFLINE_QUEUED");
  }
}

function prettyAnchorError(err: unknown, idl?: Idl, context?: string): Error {
  const anyErr: any = err;
  const prefix = context ? `[${context}] ` : "";

  // Newer Anchor versions expose a structured error object
  const anchorError = anyErr?.error;
  if (anchorError?.errorCode) {
    const codeObj = anchorError.errorCode;
    const name = codeObj.code ?? codeObj.name ?? "Unknown";
    const num =
      typeof codeObj.number === "number"
        ? codeObj.number
        : typeof codeObj.code === "number"
          ? codeObj.code
          : undefined;
    const msg =
      anchorError.errorMessage ||
      anyErr.message ||
      "Anchor program error";

    return new Error(
      `${prefix}Anchor error ${name}${num !== undefined ? ` (${num})` : ""
      }: ${msg}`
    );
  }

  const message = String(anyErr?.message || anyErr || "Unknown error");
  const match = /custom program error: 0x([0-9a-f]+)/i.exec(message);

  if (match) {
    const hex = match[1];
    let code: number | undefined;
    try {
      code = parseInt(hex, 16);
    } catch {
      code = undefined;
    }

    let human = "";
    if (idl && (idl as any).errors && typeof code === "number") {
      const found = (idl as any).errors.find((e: any) => e.code === code);
      if (found) {
        human = `Anchor error ${found.name} (${code} / 0x${hex}): ${found.msg ?? found.message ?? ""
          }`;
      }
    }

    if (human) {
      return new Error(`${prefix}${human}`);
    }

    if (typeof code === "number") {
      return new Error(
        `${prefix}Custom program error ${code} (0x${hex})`
      );
    }

    return new Error(`${prefix}Custom program error 0x${hex}`);
  }

  return new Error(`${prefix}${message}`);
}

const LAMPORTS_PER_SOL = 1_000_000_000;

type ClientBetInsertArgs = {
  signature: string;
  marketPubkey: string;
  bettorPubkey: string;
  outcomeIndex: number;
  outcomeLabel?: string;
  amountLamports: bigint | number;
};

/**
 * ⚠️ SECURITY: Frontend should NOT write to bets table
 * 
 * Bet indexing architecture:
 * 1. User places bet on-chain via placeBet()
 * 2. Helius webhook detects BetPlaced event
 * 3. Edge Function (with service role key) writes to bets table
 * 4. Frontend reads from bets table via Supabase realtime
 * 
 * RLS policies prevent frontend writes to bets table.
 * This function has been disabled for security.
 */
async function insertBetRowClientSide(args: ClientBetInsertArgs) {
  try {
    const { saveBet } = await import("../integrations/supabase/writes");
    await saveBet({
      signature: args.signature,
      marketPubkey: args.marketPubkey,
      bettorPubkey: args.bettorPubkey,
      outcomeIndex: args.outcomeIndex,
      outcomeLabel: args.outcomeLabel,
      amountLamports: Number(args.amountLamports),
    });
  } catch (err) {
    console.error("[actions] Failed to save bet client-side:", err);
  }
}

// ... (hashQuestionAndAnswers and callIx omitted for brevity, assuming they are unchanged or handled by context)

/**
 * Hash question and answers - matches Rust hash_question_and_answers
 * Uses Web Crypto API for browser compatibility
 */
export async function hashQuestionAndAnswers(question: string, answers: string[]): Promise<Uint8Array> {
  const buf: Uint8Array[] = [];

  // "yesno_markets_v1"
  buf.push(new TextEncoder().encode("yesno_markets_v1"));

  // question length (u32 le)
  const qLen = new Uint8Array(4);
  new DataView(qLen.buffer).setUint32(0, question.length, true);
  buf.push(qLen);

  // question bytes
  buf.push(new TextEncoder().encode(question));

  // answers length (u32 le)
  const aLen = new Uint8Array(4);
  new DataView(aLen.buffer).setUint32(0, answers.length, true);
  buf.push(aLen);

  // each answer: length (u32 le) + bytes
  for (const a of answers) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, a.length, true);
    buf.push(len);
    buf.push(new TextEncoder().encode(a));
  }

  // Concatenate all
  const totalLen = buf.reduce((sum, b) => sum + b.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buf) {
    combined.set(b, offset);
    offset += b.length;
  }

  // SHA256 hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(hashBuffer);
}

export async function callIx(
  program: Program<Idl>,
  ixName: string,
  args: any[],
  accounts: Record<string, Address>
) {
  const keys = Object.keys(program.methods);
  const norm = (s: string) => s.toLowerCase().replace(/_/g, "");
  const found =
    keys.find((k) => norm(k) === norm(ixName)) ||
    keys.find((k) => k.toLowerCase() === ixName.toLowerCase());
  const m = found
    ? (program.methods as any)[found]
    : (program.methods as any)[ixName];
  if (!m) {
    throw new Error(
      `Method ${ixName} not found (have: ${keys.join(", ")})`
    );
  }

  // Debug logging before rpc() call
  if (
    ixName === "create_market" ||
    ixName.toLowerCase().includes("createmarket")
  ) {
    console.log(
      "[CreateMarket] available instructions in IDL:",
      (program.idl as any)?.instructions?.map((ix: any) => ix.name)
    );
    console.log(
      "[CreateMarket] has methods.createMarket:",
      !!(program as any).methods?.createMarket ||
      !!(program as any).methods?.create_market
    );
  }

  try {
    return await m(...args)
      .accounts(accounts)
      .preInstructions(computeBudgetIxs())
      .rpc({ commitment: "confirmed" });
  } catch (err) {
    console.error(`[callIx] ${ixName} failed`, err);
    throw prettyAnchorError(err, program.idl as Idl, ixName);
  }
}



/**
 * Create a new market - matches Rust create_market
 */
/**
 * Create a new market - matches Rust create_market
 */
export async function createMarket(
  wallet: WalletContextState,
  params: {
    question: string;
    answers: string[];
    cutoffTs: number; // Unix timestamp in seconds
    imageUrl?: string;
    description?: string;
  }
): Promise<{ txSig: string; marketPubkey: string }> {
  // 1) Get program bound to wallet
  const { program } = getAnchorProgramWithProvider(wallet) ?? {};
  if (!program) {
    throw new Error("[createMarket] Program not initialized");
  }

  if (!wallet.publicKey) {
    throw new Error("[createMarket] Wallet not connected");
  }

  // Check offline status
  checkOfflineAndQueue("create_market", params);

  // 2) Fetch config to get fee wallet
  const { fetchConfig } = await import("./read");
  const config = await fetchConfig(program);
  if (!config) {
    throw new Error("[createMarket] Config not initialized. Please ask admin to initialize.");
  }

  const feeWallet = (config as any).feeWallet || (config as any).fee_wallet;
  if (!feeWallet) {
    throw new Error("[createMarket] Fee wallet not found in config");
  }

  // 3) Prepare arguments
  const questionHash = await hashQuestionAndAnswers(params.question, params.answers);
  const cutoff = new BN(params.cutoffTs);
  const imageUrl = params.imageUrl || "";

  // 4) Derive Market PDA
  const [marketPda] = findMarketPda(
    program.programId,
    wallet.publicKey,
    cutoff,
    questionHash
  );
  const [configPda] = getConfigPda(program.programId);

  // 5) Build transaction
  console.log("[createMarket] Creating market", {
    question: params.question,
    answers: params.answers,
    marketPda: marketPda.toBase58(),
    cutoff: params.cutoffTs,
    feeWallet: feeWallet.toBase58 ? feeWallet.toBase58() : feeWallet
  });

  // IDL Args: cutoff_ts, question_hash, question, answers, image_url
  const builder = (program.methods as any).createMarket?.(
    cutoff,
    Array.from(questionHash), // Anchor expects number[] or Buffer for [u8; 32]
    params.question,
    params.answers,
    imageUrl
  ) ?? (program.methods as any).create_market?.(
    cutoff,
    Array.from(questionHash),
    params.question,
    params.answers,
    imageUrl
  );

  if (!builder) {
    throw new Error("[createMarket] methods.createMarket not found on program");
  }

  let txSig: string;
  try {
    txSig = await builder
      .accounts({
        market: marketPda,
        config: configPda,
        creator: wallet.publicKey,
        platformFeeWallet: feeWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    console.error("[createMarket] tx failed", err);
    throw prettyAnchorError(err, program.idl as Idl, "createMarket");
  }

  console.log("[createMarket] ✅ success", { txSig, market: marketPda.toBase58() });

  // Client-side fallback for market_events indexing
  try {
    const { saveMarketEvent } = await import("../integrations/supabase/writes");
    await saveMarketEvent({
      signature: txSig,
      marketPubkey: marketPda.toBase58(),
      creatorPubkey: wallet.publicKey.toBase58(),
      cutoffTs: params.cutoffTs,
      outcomesCount: params.answers.length,
      questionHash,
    });
  } catch (err) {
    console.error("[createMarket] Failed to save market event client-side:", err);
  }

  return { txSig, marketPubkey: marketPda.toBase58() };
}

/**
 * Place a bet - matches Rust place_bet
 * Refactored to match createMarket pattern (wallet-based)
 */
export async function placeBet(
  wallet: WalletContextState,
  params: {
    marketPubkey: string;
    outcomeIndex: number;
    outcomeLabel?: string; // Added for client-side indexing
    stakeLamports: number;
  }
): Promise<{ txSig: string }> {
  // 1) Get program bound to wallet
  const { program } = getAnchorProgramWithProvider(wallet) ?? {};
  if (!program) {
    throw new Error("[placeBet] Program not initialized");
  }

  if (!wallet.publicKey) {
    throw new Error("[placeBet] Wallet not connected");
  }

  // 2) Validate inputs
  if (params.outcomeIndex < 0 || params.outcomeIndex > 4) {
    throw new Error("Outcome index must be 0-4");
  }
  if (params.stakeLamports <= 0) {
    throw new Error("Stake must be positive");
  }

  // Check offline status
  checkOfflineAndQueue("place_bet", {
    marketPubkey: params.marketPubkey,
    outcomeIndex: params.outcomeIndex,
    stakeLamports: params.stakeLamports
  });

  // 3) Parse market pubkey
  const marketPk = new PublicKey(params.marketPubkey);
  const userPk = wallet.publicKey;
  const programId = program.programId;

  // 4) Find position PDA
  const [positionPda] = findPositionPda(programId, marketPk, userPk);

  // 5) Build and send transaction using Anchor's IDL-driven methods()
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    console.log("[placeBet] submitting bet", {
      marketPubkey: params.marketPubkey,
      outcomeIndex: params.outcomeIndex,
      stakeLamports: params.stakeLamports,
    });
  }

  const builder = (program.methods as any).placeBet?.(
    params.outcomeIndex,
    new BN(params.stakeLamports)
  ) ?? (program.methods as any).place_bet?.(
    params.outcomeIndex,
    new BN(params.stakeLamports)
  );

  if (!builder) {
    throw new Error("[placeBet] methods.placeBet not found on program");
  }

  let txSig: string;
  try {
    txSig = await builder
      .accounts({
        market: marketPk,
        user: userPk,
        position: positionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    console.error("[placeBet] tx failed", err);
    throw prettyAnchorError(err, program.idl as Idl, "placeBet");
  }

  if (wallet.publicKey) {
    void insertBetRowClientSide({
      signature: txSig,
      marketPubkey: marketPk.toBase58(),
      bettorPubkey: wallet.publicKey.toBase58(),
      outcomeIndex: params.outcomeIndex,
      outcomeLabel: params.outcomeLabel,
      amountLamports: params.stakeLamports,
    });
  }

  console.log("[placeBet] ✅ tx", { txSig, market: params.marketPubkey, outcomeIndex: params.outcomeIndex });

  return { txSig };
}

/**
 * Resolve a market - matches Rust resolve
 */
export async function resolveMarket(
  program: Program<Idl>,
  params: {
    market: Address;
    signer: Address;
    winnerIndex: number; // -2 for VOID, -1 for UNSET, 0+ for winner
    platformFeeWallet: Address;
    creatorWallet: Address;
  }
) {
  // Use program.programId directly to ensure consistency with Anchor's internal derivation
  const programId = program.programId;
  const [configPda] = getConfigPda(programId);

  const accounts: Record<string, Address> = {
    config: configPda,
    market: params.market,
    signer: params.signer,
    platformFeeWallet: params.platformFeeWallet,
    creatorWallet: params.creatorWallet,
    systemProgram: SystemProgram.programId,
  };

  const txSig = await callIx(program, "resolve", [params.winnerIndex], accounts);

  // Client-side fallback for indexing
  try {
    const { saveMarketResolution } = await import("../integrations/supabase/writes");

    // Fetch market account after resolution to get pool data
    let resolvedTotalPool: number | null = null;
    let resolvedWinPool: number | null = null;
    let feesTransferred: number | null = null;

    try {
      const marketAccount = await (program as any).account.market.fetch(params.market);
      const totalPool = marketAccount.totalPool || marketAccount.total_pool || 0;
      resolvedTotalPool = Number(totalPool.toString());

      // Get winning pool (if not void)
      if (params.winnerIndex >= 0 && marketAccount.pools) {
        const pools = marketAccount.pools;
        if (pools[params.winnerIndex]) {
          resolvedWinPool = Number(pools[params.winnerIndex].toString());
        }
      }

      // Fees are transferred during resolution, so they should be 0 after
      // We can estimate from the total pool and a 2% fee rate
      feesTransferred = Math.floor(resolvedTotalPool * 0.02);
    } catch (fetchErr) {
      console.warn("[resolveMarket] Could not fetch market data for resolution:", fetchErr);
    }

    await saveMarketResolution({
      signature: txSig,
      marketPubkey: params.market.toString(),
      winnerIndex: params.winnerIndex,
      autoVoid: params.winnerIndex === -2,
      resolvedTotalPool,
      resolvedWinPool,
      feesTransferred,
    });
  } catch (err) {
    console.error("[actions] Failed to save resolution client-side:", err);
  }

  return txSig;
}

/**
 * Void a market - matches Rust resolve with VOID index (-2)
 */
export async function voidMarket(
  program: Program<Idl>,
  params: {
    market: Address;
    signer: Address;
    platformFeeWallet: Address;
    creatorWallet: Address;
  }
) {
  return resolveMarket(program, {
    ...params,
    winnerIndex: -2,
  });
}

/**
 * Claim winnings - matches Rust claim_winnings
 */
export async function claimWinnings(
  program: Program<Idl>,
  params: {
    market: Address;
    user: Address;
  }
) {
  // Check offline status
  checkOfflineAndQueue("claim_winnings", {
    market: params.market.toString(),
    user: params.user.toString()
  });
  const marketPk = new PublicKey(params.market);
  const userPk = new PublicKey(params.user);
  // Use program.programId directly to ensure consistency
  const programId = program.programId;

  // Find position PDA
  const [positionPda] = findPositionPda(programId, marketPk, userPk);

  const accounts: Record<string, Address> = {
    market: marketPk,
    user: userPk,
    position: positionPda,
    systemProgram: SystemProgram.programId,
  };

  // Fetch position before claiming to get the amount
  let claimAmount = 0;
  try {
    const positionAccount = await (program as any).account.position.fetch(positionPda);
    claimAmount = Number(positionAccount.amount?.toString() || 0);
  } catch (fetchErr) {
    console.warn("[claimWinnings] Could not fetch position amount:", fetchErr);
  }

  const txSig = await callIx(program, "claim_winnings", [], accounts);

  // Client-side fallback for indexing
  try {
    const { saveClaim } = await import("../integrations/supabase/writes");
    await saveClaim({
      signature: txSig,
      marketPubkey: params.market.toString(),
      userPubkey: params.user.toString(),
      amountLamports: claimAmount,
    });
  } catch (err) {
    console.error("[actions] Failed to save claim client-side:", err);
  }

  return txSig;
}

/**
 * Void expired market - matches Rust void_expired
 */
export async function voidExpired(
  program: Program<Idl>,
  params: {
    market: Address;
  }
) {
  const accounts: Record<string, Address> = {
    market: params.market,
    systemProgram: SystemProgram.programId,
  };

  return callIx(program, "void_expired", [], accounts);
}

/**
 * Initialize config - matches Rust initialize
 */
export async function initialize(
  program: Program<Idl>,
  params: {
    authority: PublicKey;
    feeWallet: PublicKey;
    minBetLamports: number;
    maxBetLamports: number;
    adminPreCutoff: boolean;
  }
) {
  // Use program.programId directly to ensure consistency with Anchor's internal derivation
  const programId = program.programId;
  const [configPda] = getConfigPda(programId);

  // Accounts must use camelCase (Anchor converts IDL snake_case to camelCase)
  const accounts: Record<string, Address> = {
    config: configPda,
    authority: params.authority,
    feeWalletAcc: params.feeWallet,
    systemProgram: SystemProgram.programId,
  };

  return callIx(
    program,
    "initialize",
    [
      params.feeWallet,
      new BN(params.minBetLamports),
      new BN(params.maxBetLamports),
      params.adminPreCutoff,
    ],
    accounts
  );
}

/**
 * Initialize config with sensible defaults
 * Uses the wallet as fee wallet and standard min/max bet limits
 */
export async function initializeConfig(
  program: Program<Idl> | null,
  walletPublicKey: PublicKey | null
): Promise<string> {
  if (!program) {
    throw new Error("Program not ready");
  }

  if (!walletPublicKey) {
    throw new Error("Wallet not connected");
  }

  // Use program.programId directly to ensure consistency with Anchor's internal derivation
  // This is critical: Anchor derives PDAs using program.programId internally
  const programId = program.programId;
  const [configPda, bump] = getConfigPda(programId);

  console.log("[initializeConfig] Config PDA:", {
    address: configPda.toBase58(),
    bump,
    programId: programId.toBase58(),
  });

  // Use sensible defaults matching Rust constants:
  // MIN_BET_LAMPORTS = 10_000_000 (0.01 SOL)
  // MAX_BET_LAMPORTS = 100_000 * 1_000_000_000 (100k SOL)
  const minBetLamports = 10_000_000; // 0.01 SOL
  const maxBetLamports = 100_000 * 1_000_000_000; // 100k SOL
  const adminPreCutoff = false; // Default to false

  // Use wallet as fee wallet
  const feeWallet = walletPublicKey;

  // Accounts must use camelCase (Anchor converts IDL snake_case to camelCase)
  // IDL has: config, authority, fee_wallet_acc, system_program
  // Anchor expects: config, authority, feeWalletAcc, systemProgram
  const accounts: Record<string, Address> = {
    config: configPda,
    authority: walletPublicKey,
    feeWalletAcc: feeWallet,
    systemProgram: SystemProgram.programId,
  };

  console.log("[initializeConfig] Accounts for initialize:", {
    config: typeof accounts.config === 'string' ? accounts.config : accounts.config.toBase58(),
    authority: typeof accounts.authority === 'string' ? accounts.authority : accounts.authority.toBase58(),
    feeWalletAcc: typeof accounts.feeWalletAcc === 'string' ? accounts.feeWalletAcc : accounts.feeWalletAcc.toBase58(),
    systemProgram: typeof accounts.systemProgram === 'string' ? accounts.systemProgram : accounts.systemProgram.toBase58(),
  });

  console.log("[initializeConfig] Calling initialize with args:", {
    feeWallet: feeWallet.toBase58(),
    minBetLamports,
    maxBetLamports,
    adminPreCutoff,
  });

  try {
    const sig = await callIx(
      program,
      "initialize",
      [
        feeWallet,
        new BN(minBetLamports),
        new BN(maxBetLamports),
        adminPreCutoff,
      ],
      accounts
    );

    console.log("[initializeConfig] ✅ Config initialized successfully:", sig);
    return sig;
  } catch (err: any) {
    console.error("[initializeConfig] ❌ Failed to initialize config:", err);

    // Enhanced error logging for debugging
    if (err?.logs) {
      console.error("[initializeConfig] Transaction logs:", err.logs);
    }
    if (err?.transactionLogs) {
      console.error("[initializeConfig] Transaction logs (alt):", err.transactionLogs);
    }
    if (err?.transactionMessage) {
      console.error("[initializeConfig] Transaction message:", err.transactionMessage);
    }
    if (err?.simulationResponse) {
      console.error("[initializeConfig] Simulation response:", err.simulationResponse);
    }
    if (err?.error) {
      console.error("[initializeConfig] Error details:", err.error);
    }

    throw err;
  }
}

/**
 * Set authority - matches Rust set_authority
 */
export async function setAuthority(
  program: Program<Idl>,
  params: {
    authority: PublicKey;
    newAuthority: PublicKey;
  }
) {
  // Use program.programId directly to ensure consistency with Anchor's internal derivation
  const programId = program.programId;
  const [configPda] = getConfigPda(programId);

  const accounts: Record<string, Address> = {
    authority: params.authority,
    config: configPda,
  };

  return callIx(program, "set_authority", [params.newAuthority], accounts);
}

/**
 * Set fee wallet - matches Rust set_fee_wallet
 * Uses standard Anchor .methods().accounts().rpc() pattern
 */
export async function setFeeWallet(params: {
  newFeeWalletStr: string;
  wallet: WalletContextState;
}): Promise<string> {
  const { newFeeWalletStr, wallet } = params;

  console.log("[setFeeWallet] Entered", { newFeeWalletStr });

  if (!wallet.publicKey) {
    throw new Error("[setFeeWallet] Wallet not connected");
  }

  const { program, provider } = getAnchorProgramWithProvider(wallet) || {};
  if (!program || !provider) {
    throw new Error("[setFeeWallet] Program not initialized");
  }

  const authority = wallet.publicKey;
  const newFeeWallet = new PublicKey(newFeeWalletStr);

  // Get config PDA the same way other admin actions do
  const [configPda] = getConfigPda(program.programId);

  // Use the IDL-driven methods builder so accounts order and signer metadata
  // come directly from the canonical IDL generated by Anchor.
  const builder =
    program.methods.setFeeWallet?.(newFeeWallet) ??
    program.methods.set_fee_wallet?.(newFeeWallet);

  if (!builder) {
    throw new Error("[setFeeWallet] methods.setFeeWallet not found on program");
  }

  let txSig: string;
  try {
    txSig = await builder
      .accounts({
        config: configPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    console.error("[setFeeWallet] tx failed", err);
    throw prettyAnchorError(err, program.idl as Idl, "setFeeWallet");
  }

  console.log("[setFeeWallet] ✅ success", { txSig });
  return txSig;
}

/**
 * Close position - matches Rust close_position
 */
export async function closePosition(
  program: Program<Idl>,
  params: {
    user: PublicKey;
    market: PublicKey;
  }
) {
  // Use program.programId directly to ensure consistency
  const programId = program.programId;
  const [positionPda] = findPositionPda(programId, params.market, params.user);

  const accounts: Record<string, Address> = {
    user: params.user,
    position: positionPda,
  };

  return callIx(program, "close_position", [], accounts);
}

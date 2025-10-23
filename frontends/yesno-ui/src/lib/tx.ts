// frontends/yesno-ui/src/lib/tx.ts
"use client";

import {
  AddressLookupTableAccount,
  MessageCompiledInstruction,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection, getLatestBlockhashFast } from "./actions/connection";
import type { WalletContextState } from "@solana/wallet-adapter-react";

/**
 * Build a v0 versioned transaction from instructions using the shared Connection
 * and the cached latest blockhash (with light RPC usage).
 */
export async function buildV0Tx(params: {
  payer: PublicKey;
  instructions: TransactionInstruction[] | MessageCompiledInstruction[];
  lookupTables?: AddressLookupTableAccount[];
}): Promise<VersionedTransaction> {
  const { payer, instructions } = params;
  const lookupTables = params.lookupTables ?? [];

  const { blockhash } = await getLatestBlockhashFast();

  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: instructions as TransactionInstruction[],
  }).compileToV0Message(lookupTables);

  return new VersionedTransaction(msg);
}

/**
 * Try wallet.signAndSendTransaction; if not available, sign then send via Connection.
 * Returns the signature string.
 */
export async function signAndSend({
  wallet,
  tx,
  skipPreflight = false,
}: {
  wallet: WalletContextState;
  tx: VersionedTransaction;
  skipPreflight?: boolean;
}): Promise<string> {
  const conn = getConnection();

  // Prefer adapter convenience if present
  if (typeof wallet.signAndSendTransaction === "function") {
    const sig = await wallet.signAndSendTransaction(tx, { skipPreflight });
    return typeof sig === "string" ? sig : (sig as any).signature ?? String(sig);
  }

  // Fallback: sign then send
  await wallet.signTransaction!(tx);
  const sig = await conn.sendTransaction(tx, { skipPreflight, maxRetries: 3 });
  // You can confirm here if you want a blocking UX:
  // await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
  return sig;
}

// src/solana/idlHelpers.ts
import type { Program, Idl } from "@coral-xyz/anchor";
import type { YesnoMarkets } from "../idl/yesno_markets";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./program";

export function getAccountByPattern(
  program: Program<YesnoMarkets> | null,
  pattern: string
) {
  if (!program) {
    console.warn("[yesno] getAccountByPattern: program not ready");
    return null;
  }

  if (!(program as any).account) {
    console.warn("[yesno] getAccountByPattern: account namespace missing");
    return null;
  }

  const key = Object.keys(program.account).find((k) =>
    k.toLowerCase().includes(pattern.toLowerCase())
  );
  
  if (!key) {
    console.warn(`[yesno] getAccountByPattern: Account matching "${pattern}" not found in IDL`);
    return null;
  }
  
  // @ts-expect-error dynamic
  return program.account[key] as any;
}

export function getIxByPattern(idl: Idl, pattern: string) {
  const ix = idl.instructions?.find((i) =>
    i.name.toLowerCase().includes(pattern.toLowerCase())
  );
  if (!ix) {
    throw new Error(`Instruction matching "${pattern}" not found`);
  }
  return ix;
}

/**
 * Get the config PDA address and bump seed
 * Uses the same seeds as the Rust program: [b"config"]
 * 
 * Rust seeds: seeds = [b"config"]
 * This must match exactly: [Buffer.from("config")]
 */
export function getConfigPda(programId: PublicKey): [PublicKey, number] {
  // Use the exact same seed as Rust: b"config"
  const CONFIG_SEED = "config";
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    programId
  );
}

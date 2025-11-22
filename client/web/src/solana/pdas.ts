// src/solana/pdas.ts
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export const MARKET_SEED = "market";
export const POS_SEED = "pos";

/**
 * Find market PDA - matches Rust: seeds = [MARKET_SEED, creator, cutoff_ts, question_hash]
 */
export function findMarketPda(
  programId: PublicKey,
  creator: PublicKey,
  cutoffTs: number | BN,
  questionHash: Uint8Array | number[]
): [PublicKey, number] {
  const cutoffBytes = typeof cutoffTs === "number" 
    ? Buffer.from(new BN(cutoffTs).toArray("le", 8))
    : Buffer.from(cutoffTs.toArray("le", 8));
  const hashBytes = Buffer.from(questionHash);
  
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(MARKET_SEED),
      creator.toBuffer(),
      cutoffBytes,
      hashBytes,
    ],
    programId
  );
}

/**
 * Find position PDA - matches Rust: seeds = [POS_SEED, market, user]
 */
export function findPositionPda(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(POS_SEED),
      market.toBuffer(),
      owner.toBuffer(),
    ],
    programId
  );
}

// src/solana/tx.ts
import { web3 } from "@coral-xyz/anchor";
import { PRIORITY_MICROLAMPORTS } from "./env";
export function computeBudgetIxs(units = 400_000, microLamports = PRIORITY_MICROLAMPORTS) {
  const ixs: web3.TransactionInstruction[] = [];
  ixs.push(web3.ComputeBudgetProgram.setComputeUnitLimit({ units }));
  if (microLamports > 0) ixs.push(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  return ixs;
}

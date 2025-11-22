import { PublicKey } from "@solana/web3.js";
import * as pdas from "@/solana/pdas";
import { PROGRAM_ID } from "@/solana/env";

export const SYS = "11111111111111111111111111111111";

export function deriveMarket(seed: string) {
  return pdas.findMarketPda(new PublicKey(PROGRAM_ID), seed).toBase58();
}

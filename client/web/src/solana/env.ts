// src/solana/env.ts
// Public Solana devnet RPC as safe fallback (no API key required)
const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

/**
 * Get the RPC URL to use for Solana connections.
 * Priority:
 * 1. VITE_RPC_URL environment variable (if set)
 * 2. Default public devnet RPC (no API key)
 */
export const RPC_URL =
  (import.meta as any).env?.VITE_RPC_URL || DEFAULT_DEVNET_RPC;

if (typeof window !== "undefined") {
  console.log("[yesno] Using Solana RPC endpoint:", RPC_URL);
}
export const PROGRAM_ID =
  (import.meta as any).env?.VITE_PROGRAM_ID || (undefined as unknown as string);
export const COMMITMENT =
  ((import.meta as any).env?.VITE_COMMITMENT as "processed"|"confirmed"|"finalized") || "confirmed";
export const PRIORITY_MICROLAMPORTS = Number((import.meta as any).env?.VITE_PRIORITY_MICROLAMPORTS || 0);

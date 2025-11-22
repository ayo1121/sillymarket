import BN from "bn.js";

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number | string): number {
  const num = typeof sol === "string" ? parseFloat(sol) : sol;
  if (isNaN(num) || num <= 0) return 0;
  return Math.floor(num * 1_000_000_000);
}

/**
 * Convert lamports to SOL
 */
export function solFromLamports(lamports: number | BN): number {
  const num = typeof lamports === "object" ? lamports.toNumber() : lamports;
  return num / 1e9;
}


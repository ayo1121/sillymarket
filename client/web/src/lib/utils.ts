import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validate Solana address format
 * 
 * Solana addresses are base58 encoded, typically 32-44 characters.
 * This is a basic format check, not a cryptographic validation.
 * 
 * @param address - Address string to validate
 * @returns true if address format is valid
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded, 32-44 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

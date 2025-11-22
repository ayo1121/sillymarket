/**
 * Format utilities for displaying market data
 */

/**
 * Shorten a wallet address for display
 * @param pubkey - Public key string
 * @param startChars - Number of characters to show at start (default: 4)
 * @param endChars - Number of characters to show at end (default: 4)
 * @returns Shortened string like "4Fdc...hRNg"
 */
export function shortenWallet(
  pubkey: string,
  startChars: number = 4,
  endChars: number = 4
): string {
  if (!pubkey || pubkey.length < startChars + endChars) {
    return pubkey;
  }
  return `${pubkey.slice(0, startChars)}...${pubkey.slice(-endChars)}`;
}

/**
 * Format volume in lamports to SOL string
 * @param volumeLamports - Volume in lamports
 * @returns Formatted string like "0.12 SOL" or "2.3 SOL"
 */
export function formatVolume(volumeLamports: number): string {
  const sol = volumeLamports / 1_000_000_000;
  if (sol < 0.01) {
    return "<0.01 SOL";
  }
  // Show up to 2 decimal places, but remove trailing zeros
  return `${sol.toFixed(2).replace(/\.?0+$/, "")} SOL`;
}

/**
 * Format probability as percentage
 * @param prob - Probability between 0 and 1
 * @returns Formatted string like "54%"
 */
export function formatProbability(prob: number): string {
  const percent = Math.round(prob * 100);
  return `${percent}%`;
}



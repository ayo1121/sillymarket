/**
 * Markets to hide from all frontend lists (homepage, search, profile, trending, etc.)
 * These markets will still be accessible directly via URL, but won't appear in any listings.
 * 
 * Add market publicKeys as strings to this array to hide them.
 */
export const HIDDEN_MARKETS: string[] = [
    "bMubjp8yppcJVw7NmgmGSCEm9Mer9fZRyVWC36LzssV",
];

/**
 * Helper function to filter out hidden markets from a list
 * @param markets Array of markets with a pubkey or publicKey property
 * @returns Filtered array excluding hidden markets
 */
export function filterHiddenMarkets<T extends { pubkey?: string; publicKey?: string | { toString(): string } }>(
    markets: T[] | undefined | null
): T[] {
    if (!markets) return [];
    return markets.filter((m) => {
        const key = m.pubkey ?? m.publicKey?.toString?.() ?? m.publicKey;
        return !HIDDEN_MARKETS.includes(key as string);
    });
}

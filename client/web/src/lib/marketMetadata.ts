/**
 * Market metadata cache - stores question text and other metadata locally
 * since the on-chain program only stores question hash
 */

export type MarketMetadata = {
  marketPubkey: string;
  question: string;
  creatorWallet: string | null;
  description?: string | null;
  imageUrl?: string | null;
  creatorName?: string | null;
  answers?: string[]; // labels for outcomes 0..n-1
  createdAt?: string | null; // ISO string
};

const STORAGE_KEY = "yesno_market_metadata";

/**
 * Get all market metadata from localStorage
 */
function getAllMarketMetadata(): Record<string, MarketMetadata> {
  if (typeof window === "undefined") {
    return {};
  }
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {};
    }
    return JSON.parse(stored) as Record<string, MarketMetadata>;
  } catch (e) {
    console.warn("[marketMetadata] Failed to parse stored metadata", e);
    return {};
  }
}

/**
 * Get metadata for a specific market
 */
export function getMarketMetadata(marketPubkey: string): MarketMetadata | null {
  const all = getAllMarketMetadata();
  return all[marketPubkey] || null;
}

/**
 * Upsert metadata for a market (localStorage)
 */
export function upsertLocalMarketMetadata(meta: MarketMetadata): void {
  if (typeof window === "undefined") {
    return;
  }
  
  try {
    const all = getAllMarketMetadata();
    all[meta.marketPubkey] = {
      ...all[meta.marketPubkey], // preserve existing fields
      ...meta,              // override with new data
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    console.log("[metadata] upsert local", { marketPubkey: meta.marketPubkey, meta });
  } catch (e) {
    console.error("[marketMetadata] Failed to save metadata", e);
  }
}

/**
 * Legacy wrapper for backwards compatibility
 */
export function upsertMarketMetadata(meta: MarketMetadata) {
  return upsertLocalMarketMetadata(meta);
}

/**
 * Check if a label is a placeholder (generic default)
 */
function isPlaceholderLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower === "yes" ||
    lower === "no" ||
    lower.startsWith("outcome ")
  );
}

/**
 * Attach metadata to markets, adding displayQuestion field and outcome labels
 */
export function attachMetadataToMarkets<T extends { 
  pubkey: string; 
  displayQuestion?: string; 
  imageUrl?: string | null; 
  creatorLabel?: string; 
  creatorName?: string | null; 
  createdAt?: string | null;
  outcomes?: Array<{ index: number; label: string; poolLamports: bigint; probability: number }>;
}>(
  markets: T[]
): (T & { displayQuestion: string })[] {
  const allMetadata = getAllMarketMetadata();
  
  return markets.map((market) => {
    const metadata = allMetadata[market.pubkey];
    
    // Only overwrite displayQuestion if it's still a placeholder
    const isPlaceholder = market.displayQuestion && 
      market.displayQuestion.startsWith("market ") && 
      market.displayQuestion.endsWith("...");
    
    const displayQuestion = (isPlaceholder && metadata?.question && metadata.question.trim().length > 0)
      ? metadata.question
      : market.displayQuestion || `Market ${market.pubkey.slice(0, 4)}...`;
    
    // Apply local answers to override placeholder outcome labels
    let outcomes = market.outcomes;
    if (Array.isArray(metadata?.answers) && outcomes && outcomes.length > 0) {
      outcomes = outcomes.map((o) => {
        const override =
          metadata.answers && metadata.answers[o.index]
            ? String(metadata.answers[o.index]).trim()
            : "";
        return {
          ...o,
          label:
            override.length > 0 && isPlaceholderLabel(o.label)
              ? override
              : o.label,
        };
      });
    }
    
    if (metadata) {
      console.log("[metadata] read local", { marketPubkey: market.pubkey, meta: metadata });
    }
    
    return {
      ...market,
      displayQuestion,
      ...(outcomes && { outcomes }),
      // Merge in localStorage metadata only if not already set from backend
      imageUrl: market.imageUrl || metadata?.imageUrl || null,
      creatorName: market.creatorName || metadata?.creatorName || null,
      createdAt: market.createdAt || metadata?.createdAt || null,
    };
  });
}


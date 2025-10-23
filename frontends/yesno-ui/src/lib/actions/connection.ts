// frontends/yesno-ui/src/lib/actions/connection.ts
"use client";

import {
  clusterApiUrl,
  Connection,
  type Commitment,
} from "@solana/web3.js";

/**
 * Small wrapper around fetch to handle 429s gracefully and avoid hammering the RPC.
 * Respects Retry-After (seconds or ms). Adds jitter. Caps retries.
 */
function makeFetchWithBackoff(baseFetch: typeof fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const maxRetries = 4;
    let attempt = 0;

    while (true) {
      try {
        const res = await baseFetch(input, init);
        if (res.status !== 429) return res;

        // 429: read Retry-After header (may be seconds or ms)
        let retryAfterMs = 3000;
        const hdr = res.headers.get("retry-after");
        if (hdr) {
          const n = Number(hdr);
          if (!Number.isNaN(n)) {
            // Heuristically assume seconds if small number
            retryAfterMs = n < 1000 ? n * 1000 : n;
          }
        }
        // jitter between 0–400ms
        const jitter = Math.floor(Math.random() * 400);
        await new Promise((r) => setTimeout(r, retryAfterMs + jitter));
      } catch {
        // Network hiccup; brief backoff
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
      }

      attempt += 1;
      if (attempt > maxRetries) {
        // Final try: let it throw so caller surfaces a real error
        return baseFetch(input, init);
      }
    }
  };
}

type ClusterName = "devnet" | "mainnet-beta" | "testnet";

function resolveRpcUrl(cluster?: ClusterName): string {
  const fromEnv = (process.env.NEXT_PUBLIC_RPC_URL || "").trim();
  if (fromEnv) return fromEnv;
  const c = (cluster || (process.env.NEXT_PUBLIC_CLUSTER as ClusterName) || "devnet") as ClusterName;
  return clusterApiUrl(c);
}

// Singleton Connection so the whole app shares sockets, caches, and rate limits.
let _conn: Connection | null = null;

export function getConnection(
  cluster?: ClusterName,
  commitment: Commitment = "confirmed"
): Connection {
  if (_conn) return _conn;
  const url = resolveRpcUrl(cluster);
  _conn = new Connection(url, {
    commitment,
    confirmTransactionInitialTimeout: 90_000,
    // Pass our backoff-enabled fetch to web3.js
    fetch: makeFetchWithBackoff(fetch),
  } as any);
  return _conn;
}

/**
 * Cached latest blockhash to avoid spamming the RPC.
 * Valid ~ 20s by default; refreshes automatically.
 */
let _cachedBH: { value: string; lastSlot: number; fetchedAt: number } | null = null;

export async function getLatestBlockhashFast(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const conn = getConnection();
  const now = Date.now();

  if (_cachedBH && now - _cachedBH.fetchedAt < 20_000) {
    // Return a shape similar to web3.js getLatestBlockhash
    return { blockhash: _cachedBH.value, lastValidBlockHeight: _cachedBH.lastSlot + 150 };
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  _cachedBH = { value: blockhash, lastSlot: lastValidBlockHeight, fetchedAt: now };
  return { blockhash, lastValidBlockHeight };
}

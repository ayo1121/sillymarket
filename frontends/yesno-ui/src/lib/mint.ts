import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";

/**
 * In-memory cache so we don't refetch the same mint repeatedly
 */
const mintCache = new Map<string, { decimals: number }>();

export type MintInfoLite = {
  decimals: number | null;
  symbol?: string | null;
};

export function useMintInfo(mint: PublicKey, fallbackSymbol?: string | null): MintInfoLite {
  const { connection } = useConnection();
  const [decimals, setDecimals] = useState<number | null>(null);

  const symbol = useMemo(() => {
    // Optional symbol from env
    const envSym =
      (process.env.NEXT_PUBLIC_MINT_SYMBOL || "").trim() || undefined;
    return fallbackSymbol ?? envSym ?? undefined;
  }, [fallbackSymbol]);

  useEffect(() => {
    let alive = true;
    const k = mint.toBase58();

    (async () => {
      try {
        if (mintCache.has(k)) {
          if (!alive) return;
          setDecimals(mintCache.get(k)!.decimals);
          return;
        }
        const onChain = await getMint(connection, mint, "processed");
        if (!alive) return;
        mintCache.set(k, { decimals: onChain.decimals });
        setDecimals(onChain.decimals);
      } catch {
        // ignore; we'll just show "?" if it fails
        if (alive) setDecimals(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [connection, mint]);

  return { decimals, symbol };
}

/** Small formatter like: "USDC (6)" or "Token (6)" or "(6)" */
export function formatMintTag(symbol?: string | null, decimals?: number | null) {
  const sym = symbol?.trim();
  const dec = Number.isInteger(decimals ?? NaN) ? String(decimals) : "?";
  return sym ? `${sym} (${dec})` : `(${dec})`;
}

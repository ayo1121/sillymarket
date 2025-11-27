import React from "react";
import { useMarketsCtx } from "@/hooks/marketsContext";
import { formatVolume, formatProbability, shortenWallet } from "@/utils/format";

export default function OnchainList() {
  const { markets, loading, error } = useMarketsCtx();
  if (error) {
    return <div className="p-4 text-red-600 font-mono">{String((window as any).__idlError?.message || error)}</div>;
  }
  if (loading) return <div className="p-4">loading markets…</div>;
  if (!markets?.length) return <div className="p-4 opacity-70">no on-chain markets</div>;
  return (
    <div className="grid gap-4 p-4">
      {markets.map((market) => {
        return (
          <div key={market.pubkey} className="border border-neutral-300 bg-white p-3 rounded-md">
            <div className="text-xs opacity-60">{shortenWallet(market.pubkey)}</div>
            <div className="text-lg font-semibold">{market.displayQuestion}</div>
            <div className="text-sm">
              YES {formatProbability(market.yesProb)} · NO {formatProbability(market.noProb)} · Vol {formatVolume(market.volumeLamports ?? market.volume ?? 0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

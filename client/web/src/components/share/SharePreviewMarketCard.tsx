import React from "react";
import type { UIMarket } from "@/solana/marketMapping";
import { MarketCard } from "@/components/MarketCard";

export const SharePreviewMarketCard: React.FC<{ market: UIMarket }> = ({ market }) => {
  return (
    <div id="share-preview-root" style={{ width: 454 }}>
      <MarketCard market={market} disableNavigation />
    </div>
  );
};

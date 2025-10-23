"use client";

import React from "react";
import { PublicKey } from "@solana/web3.js";
import { useMintInfo, formatMintTag } from "@/lib/mint";
import { MINT, MINT_SYMBOL, DECIMALS } from '@/lib/constants';

type Props = {
  mint?: PublicKey;
  fallbackSymbol?: string | null;
  className?: string;
  titlePrefix?: string; // e.g. "Amount token:"
};

export default function MintBadge({
  mint = MINT,
  fallbackSymbol = MINT_SYMBOL,
  className,
  titlePrefix,
}: Props) {
  // Safe mint handling
  const safeMint = (() => {
    try {
      if (!mint) return MINT;
      return mint;
    } catch (error) {
      console.error('Error processing mint:', error);
      return MINT;
    }
  })();

  const { decimals, symbol } = useMintInfo(safeMint, fallbackSymbol);
  const tag = formatMintTag(symbol, decimals);

  return (
    <span
      className={
        className ??
        "ml-2 inline-flex items-center rounded-full border border-stroke bg-black/30 px-2 py-0.5 text-xs text-white/80"
      }
      title={`${titlePrefix ?? "Token"} ${tag}`}
      aria-label="mint-info"
    >
      {tag}
    </span>
  );
}

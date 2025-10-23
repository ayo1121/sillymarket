'use client';

import React from 'react';
import { PublicKey } from '@solana/web3.js';

export function MintBadge({
  mint,
  symbol,
  decimals,
  className = '',
}: {
  mint: PublicKey | string;
  symbol?: string;
  decimals?: number;
  className?: string;
}) {
  const s = typeof mint === 'string' ? mint : (mint as PublicKey).toBase58();
  return (
    <span
      className={
        'inline-flex items-center gap-2 text-[11px] rounded-lg border border-stroke bg-black/30 px-2.5 py-1 ' +
        className
      }
      title={s}
    >
      <span className="font-semibold">{symbol ?? 'MINT'}</span>
      {typeof decimals === 'number' && <span className="opacity-70">/ {decimals} dp</span>}
      <span className="font-mono opacity-70">{s.slice(0, 4)}…{s.slice(-4)}</span>
    </span>
  );
}

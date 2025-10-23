'use client';

import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export function ConnectGate({
  children,
  className = '',
  when = (connected: boolean) => !connected, // show banner when NOT connected by default
  bannerText = 'Connect wallet to proceed.',
}: {
  children: React.ReactNode;
  className?: string;
  when?: (connected: boolean) => boolean;
  bannerText?: string;
}) {
  const { connected } = useWallet();
  const show = when(connected);
  return (
    <div className={className}>
      {show && (
        <div className="mb-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 px-3 py-2 text-sm">
          {bannerText}
        </div>
      )}
      <div className={show ? 'pointer-events-none opacity-50' : ''}>{children}</div>
    </div>
  );
}

// src/components/wallet/ClientWalletButton.tsx
'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Render the wallet-adapter UI only on the client to avoid SSR hydration mismatches.
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
);

export function ClientWalletButton() {
  return <WalletMultiButton />;
}

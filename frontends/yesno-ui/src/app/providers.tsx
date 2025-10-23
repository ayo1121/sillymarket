// src/app/providers.tsx
'use client';

import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  LedgerWalletAdapter,
  // If you want a burner for dev only, uncomment the next line:
  // UnsafeBurnerWalletAdapter,
} from '@solana/wallet-adapter-wallets';

export default function Providers({ children }: { children: React.ReactNode }) {
  const endpoint =
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_RPC_URL) ||
    'https://api.devnet.solana.com';

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: 'devnet' }),
      new LedgerWalletAdapter(),
      // new UnsafeBurnerWalletAdapter(), // dev-only
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

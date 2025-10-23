"use client";

import React from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import WalletProviders from "./WalletProviders";

const endpoint = process.env.NEXT_PUBLIC_RPC || "https://api.devnet.solana.com";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletProviders>{children}</WalletProviders>
      </WalletProvider>
    </ConnectionProvider>
  );
}

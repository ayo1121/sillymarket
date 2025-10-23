"use client";

import React from "react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function WalletProviders({ children }: { children: React.ReactNode }) {
  return <WalletModalProvider>{children}</WalletModalProvider>;
}

import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

export default function AuthWalletGate({ children }: { children: React.ReactNode }) {
  const requireWallet = import.meta.env.VITE_REQUIRE_WALLET === "1";
  const { connected } = useWallet();

  if (!requireWallet) return <>{children}</>;
  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-neutral-300 bg-white p-5 shadow">
          <div className="text-lg font-semibold mb-2">Connect wallet to continue</div>
          <div className="text-sm text-neutral-600 mb-4">No passwords. Your wallet is your account.</div>
          <WalletMultiButton />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

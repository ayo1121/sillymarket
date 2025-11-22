import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { DEBUG_DOCK } from "@/lib/config";

// SECURITY: Debug UI is forced off in production even if VITE_DEBUG_DOCK is mis-set.
export default function WalletDock() {
  if (!DEBUG_DOCK) return null;
  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 50 }}>
      <WalletMultiButton />
    </div>
  );
}

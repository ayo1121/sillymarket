import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
export default function WalletDock() {
  if (import.meta.env.VITE_DEBUG_DOCK !== "1") return null;
  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 50 }}>
      <WalletMultiButton />
    </div>
  );
}

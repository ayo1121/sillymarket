import { FC, ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider as BaseWalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";
import { RPC_URL } from "./env";

const endpoint = RPC_URL;

if (typeof window !== "undefined") {
  console.log("[yesno] WalletProvider using Solana RPC endpoint:", endpoint);
}

// IMPORTANT: export with the same name main.tsx expects (WalletProvider).
export const WalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter()],
    []
  );

  // Debug logging to confirm Phantom is detected
  if (typeof window !== "undefined") {
    console.log("Wallets configured:", wallets.map(w => w.name));
    // @ts-ignore
    const solana = (window as any).solana;
    console.log("window.solana", solana, "isPhantom:", solana?.isPhantom);
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <BaseWalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </BaseWalletProvider>
    </ConnectionProvider>
  );
};

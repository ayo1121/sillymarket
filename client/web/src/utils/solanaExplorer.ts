import { RPC_URL } from "@/lib/config";

const getCluster = () => {
  if (RPC_URL.includes("devnet")) return "devnet";
  if (RPC_URL.includes("testnet")) return "testnet";
  if (RPC_URL.includes("localhost") || RPC_URL.includes("127.0.0.1")) return "custom";
  // Assume mainnet for everything else (including custom Helius/QuickNode URLs)
  return "mainnet";
};

export const getTxExplorerUrl = (signature: string) => {
  const cluster = getCluster();
  let suffix = "";
  if (cluster === "devnet") suffix = "?cluster=devnet";
  else if (cluster === "testnet") suffix = "?cluster=testnet";
  else if (cluster === "custom") suffix = "?cluster=custom&customUrl=" + encodeURIComponent(RPC_URL);

  return `https://explorer.solana.com/tx/${signature}${suffix}`;
};

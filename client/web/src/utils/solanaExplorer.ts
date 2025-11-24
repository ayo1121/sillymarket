import { RPC_URL } from "@/lib/config";

const getCluster = () => {
  if (RPC_URL.includes("devnet")) return "devnet";
  if (RPC_URL.includes("testnet")) return "testnet";
  if (RPC_URL.includes("localhost") || RPC_URL.includes("127.0.0.1")) return "devnet";
  return "mainnet";
};

export const getTxExplorerUrl = (signature: string) => {
  const cluster = getCluster();
  const suffix = cluster === "mainnet" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
};

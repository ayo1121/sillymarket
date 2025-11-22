// src/solana/connection.ts
import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./env";

const url = RPC_URL;

export const commitment: "processed" | "confirmed" | "finalized" =
  (import.meta.env.VITE_COMMITMENT as any) || "confirmed";

export const connection = new Connection(url, { commitment });

if (typeof window !== "undefined") {
  console.log("[yesno] Connection using Solana RPC endpoint:", url);
}

// src/hooks/useYesNo.ts
import { useEffect, useState, useCallback } from "react";
import { useAnchorProgram } from "../solana/program";
import { fetchAllMarkets, fetchMarket } from "../solana/read";
import { useWallet } from "@solana/wallet-adapter-react";
import { placeBet } from "../solana/actions";
import { PublicKey } from "@solana/web3.js";

export function useProgram(): any | null {
  return useAnchorProgram();
}

export function useMarkets() {
  const program = useProgram();
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!program) return;
      setLoading(true);
      try {
        const rows = await fetchAllMarkets(program);
        setData(rows);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [program]);
  return { data, loading, error };
}

export function useMarket(marketPk?: string) {
  const program = useProgram();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!program || !marketPk) return;
      setLoading(true);
      try {
        const acc = await fetchMarket(program, marketPk);
        setData(acc);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [program, marketPk]);
  return { data, loading, error };
}

export function usePlaceBet(marketPk?: string) {
  const program = useProgram();
  const { publicKey } = useWallet();
  return useCallback(
    async (sideIndex: number, lamports: number) => {
      if (!program) throw new Error("Program not ready");
      if (!publicKey) throw new Error("Connect wallet");
      if (!marketPk) throw new Error("Missing market");
      return placeBet(program as any, {
        marketPubkey: marketPk,
        outcomeIndex: sideIndex,
        stakeLamports: lamports,
      });
    },
    [program, publicKey, marketPk]
  );
}

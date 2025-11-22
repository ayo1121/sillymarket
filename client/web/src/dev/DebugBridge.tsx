import { deriveMarket, SYS } from "./DebugExtras";
// src/dev/DebugBridge.tsx
import React, { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "../solana/program";
import { fetchAllMarkets, fetchMarket } from "../solana/read";
import { placeBet, callIx } from "../solana/actions";
import { PublicKey } from "@solana/web3.js";
import idl from "../idl/yesno_markets.json";
import { PROGRAM_ID } from "../solana/env";

declare global {
  interface Window {
    yesno?: any;
    __idlError?: any;
  }
}

export default function DebugBridge() {
  const program = useAnchorProgram();
  const { publicKey } = useWallet();

  useEffect(() => {
    const base = {
      idl: () => idl,
      programId: PROGRAM_ID || (idl as any).address || null,
      pk: () => publicKey?.toBase58() || null,
      ix: () => (idl as any).instructions?.map((i: any) => i.name) || [],
      schema: (name: string) => (idl as any).instructions?.find((i: any) => i.name === name) || null,
      lastInitError: () => (window as any).__idlError || null,
    };
    if (!program) {
      window.yesno = base;
      return;
    }
    window.yesno = {
      ...base,
      listMarkets: async () =>
        (await fetchAllMarkets(program)).map((r: any) => ({ pk: r.publicKey.toBase58(), a: r.account })),
      getMarket: async (pk: string) => fetchMarket(program, new PublicKey(pk)),
      placeBet: async (market: string, side: number, lamports: number) =>
        placeBet(program, { market: new PublicKey(market), payer: publicKey!, sideIndex: side, lamports }),
      call: async (name: string, accounts: Record<string, string>, ...args: any[]) => {
        const accs: Record<string, any> = {};
        for (const [k, v] of Object.entries(accounts)) {
          try {
            accs[k] = new PublicKey(v as string);
          } catch {
            accs[k] = v;
          }
        }
        return callIx(program, name, args, accs);
      },
      derive: {
        market: (seed: string) => deriveMarket(seed),
      },
      async createDemo(seed: string, ...args: any[]) {
        const accounts: any = { payer: this.pk(), systemProgram: SYS };
        try {
          const market = (this as any).derive.market(seed);
          accounts.market = market;
        } catch {}
        const name = (this as any).ix().find((n: string) => /create/i.test(n)) || "createMarket";
        return (this as any).call(name, accounts, ...args);
      },
    };
    console.log("[yesno] Ready. Try: yesno.idl(), yesno.ix()");
  }, [program, publicKey]);

  return null;
}

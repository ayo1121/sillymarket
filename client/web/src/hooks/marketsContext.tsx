// src/hooks/marketsContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { useAnchorProgram } from "../solana/program";
import type { UIMarket } from "../solana/marketMapping";

type Ctx = { markets: UIMarket[]; loading: boolean; error: string|null };
const MarketsCtx = createContext<Ctx>({ markets: [], loading: true, error: null });

export function MarketsProvider({ children }: { children: React.ReactNode }) {
  const program = useAnchorProgram();
  const [markets, setMarkets] = useState<UIMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!program) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { fetchAllMarkets } = await import("../solana/read");
        const res = await fetchAllMarkets(program);
        setMarkets(res);
        setErr(null);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [program]);
  return (
    <>
      {error && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 0,
            padding: "6px 10px",
            fontFamily: "monospace",
            background: "#fdecea",
            color: "#b00020",
            zIndex: 60,
          }}
        >
          IDL/Program error: {(window as any).__idlError?.message || error}
        </div>
      )}
      <MarketsCtx.Provider value={{ markets, loading, error }}>{children}</MarketsCtx.Provider>
    </>
  );
}

export function useMarketsCtx() {
  return useContext(MarketsCtx);
}

// src/hooks/marketsContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { useAnchorProgram } from "../solana/program";
import type { UIMarket } from "../solana/marketMapping";
import { WIN_VOID, STATE_RESOLVED } from "../solana/marketMapping";
import { fetchUserPositions } from "../solana/read";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

type PositionRecord = { publicKey: PublicKey; account: any };

type Ctx = {
  markets: UIMarket[];
  loading: boolean;
  error: string | null;
  positions: PositionRecord[];
  positionsLoading: boolean;
  refreshPositions: () => Promise<void>;
  hasClaimablePositions: boolean;
  claimableCount: number;
};

const MarketsCtx = createContext<Ctx>({
  markets: [],
  loading: true,
  error: null,
  positions: [],
  positionsLoading: false,
  refreshPositions: async () => {},
  hasClaimablePositions: false,
  claimableCount: 0,
});

export function MarketsProvider({ children }: { children: React.ReactNode }) {
  const program = useAnchorProgram();
  const wallet = useWallet();
  const [markets, setMarkets] = useState<UIMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  const refreshPositions = useCallback(async () => {
    if (!program || !wallet.publicKey) {
      setPositions([]);
      return;
    }
    setPositionsLoading(true);
    try {
      const res = await fetchUserPositions(program, wallet.publicKey);
      setPositions(res as any);
    } catch (e: any) {
      console.error("[marketsContext] fetchUserPositions failed", e);
    } finally {
      setPositionsLoading(false);
    }
  }, [program, wallet.publicKey]);

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

  useEffect(() => {
    refreshPositions();
  }, [refreshPositions]);

  const { hasClaimablePositions, claimableCount } = useMemo(() => {
    if (!positions.length || !markets.length) {
      return { hasClaimablePositions: false, claimableCount: 0 };
    }

    const marketMap = new Map<string, UIMarket>();
    markets.forEach((m) => marketMap.set(m.pubkey, m));

    let count = 0;
    for (const pos of positions) {
      const market = marketMap.get(pos.account.market?.toBase58?.() || pos.account.market?.toString?.());
      if (!market) continue;
      const raw = market.rawAccount || market;
      const winningIndex = raw.winningIndex ?? raw.winning_index;
      const state = raw.state ?? 0;
      const isVoid = winningIndex === WIN_VOID;
      const outcomeIndex = pos.account.outcomeIndex ?? pos.account.outcome_index;
      const claimed = pos.account.claimed ?? false;

      if (state === STATE_RESOLVED && !isVoid && !claimed && winningIndex === outcomeIndex) {
        count += 1;
      }
    }

    return { hasClaimablePositions: count > 0, claimableCount: count };
  }, [positions, markets]);

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
      <MarketsCtx.Provider
        value={{
          markets,
          loading,
          error,
          positions,
          positionsLoading,
          refreshPositions,
          hasClaimablePositions,
          claimableCount,
        }}
      >
        {children}
      </MarketsCtx.Provider>
    </>
  );
}

export function useMarketsCtx() {
  return useContext(MarketsCtx);
}

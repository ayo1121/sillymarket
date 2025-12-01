// src/hooks/marketsContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { useAnchorProgram } from "../solana/program";
import type { UIMarket } from "../solana/marketMapping";
import { WIN_VOID, STATE_RESOLVED, WIN_UNSET } from "../solana/marketMapping";
import { fetchAllMarkets, fetchUserPositions } from "../solana/read";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

type PositionRecord = { publicKey: PublicKey; account: any };

export type BetStatus = "active" | "won" | "lost";

export function getBetStatus(position: any, market: any): BetStatus {
  const rawMarket = market?.rawAccount || market || {};
  const state = rawMarket.state ?? 0;
  const winningIndex = rawMarket.winningIndex ?? rawMarket.winning_index ?? WIN_UNSET;
  const outcomeIndex = position?.outcomeIndex ?? position?.outcome_index;

  const isResolved = state === STATE_RESOLVED;
  if (!isResolved || winningIndex === null || winningIndex === undefined || winningIndex === WIN_UNSET) {
    return "active";
  }

  if (winningIndex === WIN_VOID) {
    // Voided markets refund all bets, treat as "won" so they appear in won tab and show claim button
    return "won";
  }

  if (outcomeIndex === winningIndex) {
    return "won";
  }

  return "lost";
}

export function isPositionClaimable(position: any, market: any): boolean {
  if (!position || !market) return false;

  const rawMarket = market?.rawAccount || market || {};
  const winningIndex = rawMarket.winningIndex ?? rawMarket.winning_index ?? WIN_UNSET;
  const state = rawMarket.state ?? 0;
  const claimed = position.claimed ?? false;
  const outcomeIndex = position?.outcomeIndex ?? position?.outcome_index;

  if (claimed) return false;
  if (state !== STATE_RESOLVED) return false;

  if (winningIndex === WIN_VOID) {
    return true;
  }

  return outcomeIndex === winningIndex;
}

export function computePnL(position: any, market: any) {
  const rawMarket = market?.rawAccount || market || {};
  const stakeLamports = BigInt(position?.amount ?? position?.amountLamports ?? position?.stakeLamports ?? 0);
  const winningIndex = rawMarket.winningIndex ?? rawMarket.winning_index ?? WIN_UNSET;
  const state = rawMarket.state ?? 0;
  const outcomeIndex = position?.outcomeIndex ?? position?.outcome_index;

  const resolved = state === STATE_RESOLVED && winningIndex !== WIN_UNSET && winningIndex !== null && winningIndex !== undefined;

  if (winningIndex === WIN_VOID) {
    return {
      pnlLamports: 0n,
      realized: true,
      payoutLamports: stakeLamports
    };
  }

  if (!resolved) {
    return { pnlLamports: 0n, realized: false, payoutLamports: 0n };
  }

  let payoutLamports = 0n;

  if (outcomeIndex === winningIndex) {
    const totalPool = rawMarket.totalPool ?? rawMarket.total_pool ?? market?.volumeLamports ?? 0;
    const winPool = market?.outcomes?.[winningIndex]?.poolLamports ?? 0n;
    const totalPoolLamports = BigInt(totalPool || 0);
    const winPoolLamports = BigInt(winPool || 0);

    if (totalPoolLamports > 0n && winPoolLamports > 0n) {
      payoutLamports = (stakeLamports * totalPoolLamports) / winPoolLamports;
    } else {
      payoutLamports = stakeLamports;
    }
  } else {
    payoutLamports = 0n;
  }

  return {
    pnlLamports: payoutLamports - stakeLamports,
    realized: true,
    payoutLamports,
  };
}

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
  refreshPositions: async () => { },
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
      if (isPositionClaimable(pos.account, market)) {
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

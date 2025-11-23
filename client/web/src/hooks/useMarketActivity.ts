import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MarketActivityItem, MarketHistoryPoint, UIMarket } from "@/solana/marketMapping";
import { fetchBetEvents } from "@/solana/read";
import { resolveOutcomeLabelFromMarket } from "@/solana/marketMapping";

export function useMarketActivity(market?: UIMarket | null) {
  const marketPubkey = market?.pubkey ?? null;
  const [history, setHistory] = useState<MarketHistoryPoint[]>([]);
  const [activity, setActivity] = useState<MarketActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  const outcomesCount = market?.outcomes?.length ?? 0;

  const normalizeArray = (value: any, expectedLength: number): number[] | null => {
    let arr: any[] | null = null;
    if (Array.isArray(value)) {
      arr = value;
    } else if (value && typeof value === "object") {
      try {
        arr = Object.values(value);
      } catch {
        arr = null;
      }
    }
    if (!arr || arr.length < expectedLength) return null;
    const nums = arr.slice(0, expectedLength).map((v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });
    return nums;
  };

  useEffect(() => {
    if (!market || !marketPubkey) {
      setHistory([]);
      setActivity([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const { history, activity } = await fetchBetEvents(marketPubkey, market);
        if (cancelled) return;
        setHistory(history ?? []);
        setActivity(activity ?? []);
      } catch (err) {
        console.error("[useMarketActivity] failed to load", err);
        if (!cancelled) {
          setHistory([]);
          setActivity([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel(`bets:activity:${marketPubkey}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bets",
          filter: `market_pubkey=eq.${marketPubkey}`,
        },
        async (payload) => {
          try {
            // Append from payload for immediate responsiveness
            const row: any = payload.new;
            const ts =
              Date.parse(row?.block_time ?? row?.created_at ?? new Date().toISOString()) ||
              Date.now();

            // Build history point
            let probs: number[] | null = null;
            if (outcomesCount > 0) {
              probs = normalizeArray(row?.probs_after, outcomesCount);
              if (!probs) {
                const pools = normalizeArray(row?.pools_after, outcomesCount);
                if (pools) {
                  const total = pools.reduce((a, b) => a + b, 0);
                  if (total > 0) {
                    probs = pools.map((p) => p / total);
                  }
                }
              }
              if (probs) {
                probs = probs.map((p) => Math.max(0, Math.min(1, p)));
                const sum = probs.reduce((a, b) => a + b, 0);
                if (sum > 0) {
                  probs = probs.map((p) => p / sum);
                }
              }
            }

            if (probs && probs.length === outcomesCount) {
              setHistory((prev) => [...prev, { ts, probs: [...probs] }]);
            }

            // Build activity item
            const outcomeIndexRaw = row?.outcome_index;
            const outcomeIndex =
              outcomeIndexRaw == null ? null : Number(outcomeIndexRaw);
            const outcomeLabel =
              (row?.outcome_label as string | null) ??
              resolveOutcomeLabelFromMarket(market, outcomeIndex);

            const wallet = row?.bettor_pubkey ?? "";
            const username = row?.username ?? null;
            const amountSol =
              typeof row?.amount_sol === "number"
                ? row.amount_sol
                : row?.amount_lamports != null
                  ? Number(row.amount_lamports) / 1_000_000_000
                  : 0;

            const newActivity: MarketActivityItem = {
              kind: "bet",
              ts,
              wallet,
              username,
              outcomeIndex,
              outcomeLabel: outcomeLabel ?? "Unknown",
              amountSol,
              txSig: row?.tx_sig ?? null,
            };

            setActivity((prev) => {
              const next = [...prev, newActivity];
              return next.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
            });
          } catch (err) {
            console.error("[useMarketActivity] realtime refresh failed", err);
            try {
              const { history, activity } = await fetchBetEvents(marketPubkey, market);
              if (!cancelled) {
                setHistory(history ?? []);
                setActivity(activity ?? []);
              }
            } catch (nestedErr) {
              console.error("[useMarketActivity] fallback fetch failed", nestedErr);
            }
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [marketPubkey, market]);

  const sortedActivity = useMemo(
    () =>
      [...activity].sort(
        (a, b) => (b?.ts ?? 0) - (a?.ts ?? 0)
      ),
    [activity]
  );

  return { history, activity: sortedActivity, loading };
}

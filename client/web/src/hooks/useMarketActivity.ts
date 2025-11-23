import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MarketActivityItem, MarketHistoryPoint, UIMarket } from "@/solana/marketMapping";
import { fetchBetEvents } from "@/solana/read";

export function useMarketActivity(market?: UIMarket | null) {
  const marketPubkey = market?.pubkey ?? null;
  const [history, setHistory] = useState<MarketHistoryPoint[]>([]);
  const [activity, setActivity] = useState<MarketActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

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
        async () => {
          try {
            const { history, activity } = await fetchBetEvents(marketPubkey, market);
            if (!cancelled) {
              setHistory(history ?? []);
              setActivity(activity ?? []);
            }
          } catch (err) {
            console.error("[useMarketActivity] realtime refresh failed", err);
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

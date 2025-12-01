import { useMemo } from "react";
import type { UIMarket } from "@/solana/marketMapping";
import { OUTCOME_COLORS } from "@/solana/outcomeColors";

export type OutcomeSeriesPoint = { t: number; prob: number };

export type OutcomeSeries = {
  index: number;
  label: string;
  color: string;
  points: OutcomeSeriesPoint[];
};

export type ProbabilitySnapshotOutcome = {
  index: number;
  label: string;
  color: string;
  prob: number; // 0-1
  odds: number;
};

export type ProbabilitySnapshot = {
  outcomes: ProbabilitySnapshotOutcome[];
};

export type OutcomeSnapshot = {
  index: number;
  label: string;
  color: string;
  prob: number;
  probPct: number;
  odds: number;
  seriesPoints: { value: number }[];
};

export function getOutcomeColor(index: number): string {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}

export function computeOutcomeSnapshotsFromHistory(args: {
  market?: UIMarket | null;
  series: OutcomeSeries[];
}): OutcomeSnapshot[] {
  const { market, series } = args;
  if (!market) return [];
  const outcomeCount = market.outcomes?.length ?? 0;
  if (!outcomeCount) return [];

  return market.outcomes.map((o, idx) => {
    const s = series.find((s) => s.index === idx);
    const lastProb = s?.points?.[s.points.length - 1]?.prob ?? o.probability ?? 1 / outcomeCount;
    const odds = lastProb > 0 ? 1 / lastProb : 2.0;
    const seriesPoints = s?.points?.map((p) => ({ value: p.prob ?? 0 })) ?? [];
    return {
      index: idx,
      label: o.label,
      color: getOutcomeColor(idx),
      prob: lastProb,
      probPct: Math.round(lastProb * 100),
      odds,
      seriesPoints,
    };
  });
}

/**
 * Centralized hook for probability history + latest snapshot.
 * Uses the market.history from Supabase (already on the UIMarket).
 */
export function useMarketProbabilityHistory(market?: UIMarket | null): {
  loading: boolean;
  error?: Error;
  series: OutcomeSeries[];
  latestSnapshot: ProbabilitySnapshot | null;
} {
  const series = useMemo<OutcomeSeries[]>(() => {
    if (!market || !Array.isArray(market.history)) return [];
    const outcomeCount = market.outcomes?.length ?? 0;
    if (!outcomeCount) return [];

    // Build per-outcome series from history points that have matching probs length
    const filtered = market.history.filter(
      (p) => Array.isArray(p.probs) && p.probs.length === outcomeCount
    );

    return market.outcomes.map((outcome, idx) => ({
      index: idx,
      label: outcome.label,
      color: getOutcomeColor(idx),
      points: filtered.map((p) => ({
        t: p.ts ?? (p as any).time ?? Date.now(),
        prob: p.probs?.[idx] ?? 0,
      })),
    }));
  }, [market]);

  const latestSnapshot = useMemo<ProbabilitySnapshot | null>(() => {
    if (!market) return null;
    const outcomes = computeOutcomeSnapshotsFromHistory({ market, series }).map((o) => ({
      index: o.index,
      label: o.label,
      color: o.color,
      prob: o.prob,
      odds: o.odds,
    }));
    return { outcomes };
  }, [market, series]);

  return {
    loading: false,
    series,
    latestSnapshot,
  };
}

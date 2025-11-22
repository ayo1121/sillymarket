import React from "react";
import { Line } from "react-chartjs-2";
import "../lib/chart";
import { OUTCOME_COLORS } from "@/solana/outcomeColors";
import type { UIMarket, MarketHistoryPoint, UIMarketOutcome } from "../solana/marketMapping";

type ProbabilityChartProps = {
  market?: UIMarket;
  history?: MarketHistoryPoint[];
  outcomes?: UIMarketOutcome[];
};

export default function ProbabilityChart({ market, history, outcomes }: ProbabilityChartProps) {
  const effectiveOutcomes = outcomes ?? market?.outcomes ?? [];
  const effectiveHistory = history ?? market?.history ?? [];

  console.log("[ProbabilityChart] props", {
    outcomesCount: effectiveOutcomes?.length ?? 0,
    historyCount: effectiveHistory?.length ?? 0,
    historySample: effectiveHistory?.slice?.(0, 3) ?? [],
  });

  const outcomeCount = effectiveOutcomes.length;

  // Peek at each history point vs outcomeCount
  console.log("[ProbabilityChart] pre-filter", {
    outcomeCount,
    rawHistorySample: effectiveHistory.slice(0, 5).map((p) => ({
      ts: p.ts,
      probsLength: Array.isArray(p.probs) ? p.probs.length : null,
      probs: p.probs,
    })),
  });

  if (!effectiveHistory || effectiveHistory.length === 0 || !effectiveOutcomes || effectiveOutcomes.length === 0) {
    console.log("[ProbabilityChart] no data", { historyCount: effectiveHistory?.length ?? 0, outcomesCount: effectiveOutcomes?.length ?? 0 });
    return null;
  }

  const filteredHistory = effectiveHistory.filter(
    (p) => Array.isArray(p.probs) && p.probs.length === outcomeCount
  );

  if (!filteredHistory.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        no probability history yet
      </div>
    );
  }

  const labels = filteredHistory.map((p) =>
    new Date(p.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  const datasets = effectiveOutcomes.map((outcome, idx) => ({
    label: outcome.label,
    data: filteredHistory.map((h) => (h.probs[idx] ?? 0) * 100),
    borderColor: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
    backgroundColor: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
    fill: false,
    tension: 0.2,
    pointRadius: 0,
  }));

  return (
    <div style={{ height: "220px" }}>
      <Line
        data={{ labels, datasets }}
        options={{
          plugins: {
            legend: {
              display: outcomeCount > 1,
              position: "bottom",
              labels: { usePointStyle: true },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              min: 0,
              max: 100,
              ticks: { callback: (v) => v + "%" },
              grid: { color: "#e5e5e5" },
            },
          },
          elements: { line: { borderWidth: 2 }, point: { radius: 0 } },
          animation: { duration: 0 },
          responsive: true,
          maintainAspectRatio: false,
        }}
      />
    </div>
  );
}

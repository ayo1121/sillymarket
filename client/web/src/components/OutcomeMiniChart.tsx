import React from "react";
import { Line } from "react-chartjs-2";
import "../lib/chart";
import { OUTCOME_COLORS } from "@/solana/outcomeColors";

type HistoryPoint = {
  ts: number;
  probs: number[];
};

type Props = {
  history?: HistoryPoint[];
  outcomeIndex: number;
  currentProb: number; // 0..1
};

export default function OutcomeMiniChart({
  history,
  outcomeIndex,
  currentProb,
}: Props) {
  const hasHistory = Array.isArray(history) && history.length > 0;

  const effectiveHistory: HistoryPoint[] = hasHistory
    ? (history as HistoryPoint[])
    : (() => {
        // simple 2-point synthetic history from 0.25 * current to current
        const now = Date.now();
        const start = currentProb * 0.25;
        return [
          { ts: now - 30 * 60 * 1000, probs: [start] },
          { ts: now, probs: [currentProb] },
        ];
      })();

  const labels = effectiveHistory.map((h) =>
    new Date(h.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  const data = effectiveHistory.map((h) => {
    const arr = h.probs || [];
    const v = arr.length > 1 ? arr[outcomeIndex] ?? currentProb : arr[0];
    return (v ?? currentProb) * 100;
  });

  const color = OUTCOME_COLORS[outcomeIndex] ?? OUTCOME_COLORS[0];

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Line
        data={{
          labels,
          datasets: [
            {
              label: "",
              data,
              borderColor: color,
              backgroundColor: color,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
            },
          ],
        }}
        options={{
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
          scales: {
            x: { display: false, grid: { display: false } },
            y: {
              display: false,
              grid: { display: false },
              min: 0,
              max: 100,
            },
          },
          layout: { padding: 0 },
          elements: {
            line: { borderWidth: 2 },
            point: { radius: 0 },
          },
          responsive: true,
          maintainAspectRatio: false,
        }}
      />
    </div>
  );
}

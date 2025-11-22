import React from "react";

export interface MiniOutcomeSparklinePoint {
  value: number;
}

export type MiniOutcomeSparklineProps = {
  series?: MiniOutcomeSparklinePoint[];
  stroke?: string;
};

/**
 * Tiny sparkline used inside outcome cards.
 * Defensive: renders a baseline when no numeric data exists.
 */
export function MiniOutcomeSparkline({
  series,
  stroke = "#000000",
}: MiniOutcomeSparklineProps) {
  const safeSeries = Array.isArray(series)
    ? series.filter((p) => typeof p?.value === "number")
    : [];

  if (safeSeries.length === 0) {
    return (
      <svg
        className="w-full h-[12px]"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
      >
        <line x1="0" y1="8" x2="100" y2="8" stroke={stroke} strokeWidth="1" />
      </svg>
    );
  }

  const values = safeSeries.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = safeSeries.map((p, idx) => {
    const x = (idx / Math.max(1, safeSeries.length - 1)) * 100;
    const y = 10 - ((p.value - min) / range) * 8 - 1; // padding
    return `${x},${y}`;
  });

  return (
    <svg
      className="w-full h-[12px]"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
    >
      <polyline fill="none" stroke={stroke} strokeWidth="1" points={points.join(" ")} />
    </svg>
  );
}

export default MiniOutcomeSparkline;

import React from "react";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import type { UIMarket } from "@/solana/marketMapping";
import { getOutcomeColorStyles } from "@/solana/outcomeColors";
import { getOutcomeTheme } from "@/solana/outcomeTheme";
import { formatVolume } from "@/utils/format";

type MarketShareCardProps = {
  market: UIMarket;
  timeRemainingLabel: string;
  width?: number;
};

const computeProbabilities = (market: UIMarket) => {
  const latestHistory = market.history?.[market.history.length - 1];
  const probs = latestHistory?.probs ?? [];

  return market.outcomes.map((outcome, i) => {
    let prob: number;
    if (latestHistory && latestHistory.probs?.[i] != null) {
      prob = latestHistory.probs[i];
    } else {
      const pool = Number(outcome.poolLamports ?? 0);
      const pools = market.outcomes.map((o) => Number(o.poolLamports ?? 0));
      const total = pools.reduce((a, b) => a + b, 0);
      prob = total === 0 ? 1 / market.outcomes.length : pool / Math.max(total, 1);
    }
    return prob;
  });
};

export const MarketShareCard: React.FC<MarketShareCardProps> = ({
  market,
  timeRemainingLabel,
  width = 1200,
}) => {
  const status = market.state;
  const statusClass =
    status === "open"
      ? "text-green-700 border-green-600 bg-green-50"
      : status === "locked"
      ? "text-orange-700 border-orange-600 bg-orange-50"
      : "text-gray-700 border-gray-500 bg-gray-100";

  const probabilities = computeProbabilities(market);

  return (
    <div
      style={{
        width,
        border: "2px solid #000",
        boxShadow: "2px 2px 0 rgba(0,0,0,0.3)",
        background: "#dcdcdc",
        fontFamily: "var(--win95-font, 'MS Sans Serif', system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "hsl(var(--primary, 220 14% 20%))",
          color: "hsl(var(--primary-foreground, 0 0% 100%))",
          padding: "12px 20px",
          marginBottom: "2px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <img src={lightbulbIcon} alt="" style={{ width: 28, height: 28, opacity: 0.9 }} />
          <span style={{ fontWeight: 800, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {market.displayQuestion}
          </span>
        </div>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
          className={statusClass}
        >
          {status}
        </span>
      </div>

      <div style={{ padding: 18, background: "#f7f7f7" }}>
        <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
          {market.imageUrl && (
            <div
              style={{
                border: "2px solid hsl(var(--primary, 220 14% 20%))",
                padding: 6,
                background: "#ededed",
              }}
            >
              <img
                src={market.imageUrl}
                alt={market.displayQuestion}
                crossOrigin="anonymous"
                style={{ width: 120, height: 120, objectFit: "cover" }}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              style={{
                fontSize: 24,
                fontWeight: 800,
                marginBottom: 8,
                lineHeight: 1.25,
                wordBreak: "break-word",
              }}
            >
              {market.displayQuestion}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "#4b5563", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700 }}>by {market.creatorName ?? market.creatorLabel}</span>
                <span>•</span>
                <span style={{ fontFamily: "monospace" }}>
                  {market.pubkey.slice(0, 8)}...{market.pubkey.slice(-4)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontWeight: 700 }}>
                <span>{timeRemainingLabel}</span>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginTop: 12,
            marginBottom: 16,
          }}
        >
          {market.outcomes.map((outcome, i) => {
            const prob = probabilities[i] ?? 0;
            const percentage = prob * 100;
            const odds = prob > 0 ? `${(1 / prob).toFixed(1)}x` : "∞";
            const theme = getOutcomeTheme(i);
            const colorStyles = getOutcomeColorStyles(i, false);
            return (
              <div
                key={i}
                style={{
                  border: "2px solid",
                  borderColor: colorStyles.borderColor,
                  background: "#f8f8f8",
                  boxShadow: `0 0 0 1px ${colorStyles.borderColor}`,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minHeight: 110,
                }}
                className={theme.border}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className={`h-2.5 w-2.5 rounded-full ${theme.dot}`} />
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: colorStyles.color,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      className={theme.text}
                    >
                      {outcome.label}
                    </span>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12 }}>
                    <div style={{ fontWeight: 800 }}>{odds}</div>
                    <div style={{ color: "#6b7280" }}>odds</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: colorStyles.color }}>{percentage.toFixed(0)}% prob</span>
                  <span style={{ textTransform: "uppercase", letterSpacing: 0.5, color: "#6b7280" }}>payout</span>
                </div>
                <div
                  style={{
                    height: 22,
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {/* simple placeholder sparkline */}
                  <div
                    style={{
                      position: "absolute",
                      left: 6,
                      right: 6,
                      top: "50%",
                      height: 2,
                      background: colorStyles.color,
                      transform: "translateY(-50%)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
            border: "2px solid #9ca3af",
            background: "#e5e7eb",
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 0.6, textTransform: "uppercase" }}>
              volume
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              {formatVolume(market.volumeLamports ?? market.volume ?? 0)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 0.6, textTransform: "uppercase" }}>
              closes
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{timeRemainingLabel}</div>
          </div>
        </div>
      </div>

      <div
        style={{
        background: "#1f2937",
        color: "#fff",
        padding: "10px 16px",
        textAlign: "right",
        fontSize: 16,
        fontWeight: 700,
      }}
    >
      sillymarket.fun
    </div>
    </div>
  );
};

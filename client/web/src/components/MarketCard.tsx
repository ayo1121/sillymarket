import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import type { UIMarket } from "@/solana/marketMapping";
import { useTimeRemaining } from "@/hooks/useTimeRemaining";
import { copyToClipboard } from "@/utils/clipboard";
import { cn } from "@/lib/utils";
import { getMarketImageUrl } from "@/solana/marketImage";
import { getOutcomeColor } from "@/solana/outcomeColors";
import { MiniOutcomeSparkline } from "@/components/charts/MiniOutcomeSparkline";
import {
  useMarketProbabilityHistory,
  OutcomeSeriesPoint,
  computeOutcomeSnapshotsFromHistory,
} from "@/hooks/useMarketProbabilityHistory";

export type MarketCardProps = {
  market: UIMarket;
  onOutcomeClick?: (outcomeIndex: number) => void;
  onShare?: (market: UIMarket) => void;
  className?: string;
  disableNavigation?: boolean;
};

type MarketStatsRowProps = {
  totalVolumeSol: string;
  closesLabel: string;
  statusLabel: string;
  isResolved?: boolean;
  isVoid?: boolean;
  winnerOutcomeLabel?: string | null;
  winnerOutcomeIndex?: number | null;
};

export const MarketStatsRow: React.FC<MarketStatsRowProps> = ({
  totalVolumeSol,
  closesLabel,
  statusLabel,
  isResolved,
  isVoid,
  winnerOutcomeLabel,
  winnerOutcomeIndex,
}) => {
  const normalizedStatus = statusLabel.toLowerCase();
  const showWinner =
    !!isResolved &&
    !isVoid &&
    !!winnerOutcomeLabel &&
    winnerOutcomeLabel.trim().length > 0;

  // Show just the winner label (e.g., "yes") instead of "winner: yes"
  const statusPillText = showWinner ? winnerOutcomeLabel : statusLabel;

  // Apply outcome color class when showing winner
  const hasWinnerColor = showWinner && winnerOutcomeIndex != null;
  const outcomeColorClass = hasWinnerColor ? `bg-outcome-${winnerOutcomeIndex}` : '';

  const statusBoxClasses = [
    "market-stat-box",
    "market-stat-box--status",
    normalizedStatus === "open" && "market-stat-box--status-open",
    (normalizedStatus === "locked" || normalizedStatus === "closed") &&
    "market-stat-box--status-locked",
    !!isResolved && !isVoid && "market-stat-box--status-resolved",
    !!isVoid && "market-stat-box--status-void",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground pt-3 border-t border-border/50 mt-2">
      <div className="flex items-center gap-1.5">
        <span className="font-bold text-xs uppercase tracking-wider opacity-70">Vol</span>
        <span className="font-mono font-bold text-foreground">{totalVolumeSol} SOL</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-bold text-xs uppercase tracking-wider opacity-70">Ends</span>
        <span className="font-bold text-foreground">{closesLabel}</span>
      </div>
    </div>
  );
};

export type OutcomeCardProps = {
  label: string;
  probPct: number | null;
  odds: number | null;
  color: string;
  series?: OutcomeSeriesPoint[] | { value: number }[];
  disabled?: boolean;
  onClick?: () => void;
  compact?: boolean;
};

/**
 * Pure presentational outcome card used by homepage + details to keep visuals in sync.
 */
export const OutcomeCard: React.FC<OutcomeCardProps> = ({
  label,
  probPct,
  odds,
  color,
  series = [],
  disabled,
  onClick,
  compact,
}) => {
  const safeSeries = Array.isArray(series)
    ? series.map((p) => ({ value: (p as any)?.prob ?? (p as any)?.value ?? 0 }))
    : [];
  return (
    <button
      type="button"
      className={cn(
        "outcome-btn h-full", // Added h-full to make button stretch
        compact && "outcome-btn--compact",
        disabled && "outcome-btn--disabled"
      )}
      style={{
        borderColor: color,
        // CSS var used for hover/active tinting in CSS
        "--outcome-color": color,
      } as React.CSSProperties}
      onClick={disabled ? undefined : onClick}
    >
      <div className="outcome-btn__header">
        <span className="outcome-btn__dot" style={{ backgroundColor: color }} />
        <span className="outcome-btn__label" style={{ color }}>
          {label}
        </span>
      </div>
      <div className="outcome-btn__meta">
        <div className="outcome-btn__row">
          <span className="outcome-btn__meta-label">prob</span>
          <span className="outcome-btn__meta-value">
            {probPct != null ? `${probPct}%` : "—"}
          </span>
        </div>
        <div className="outcome-btn__row">
          <span className="outcome-btn__meta-label">odds</span>
          <span className="outcome-btn__meta-value">
            {odds != null ? `${odds.toFixed(2)}x` : "—"}
          </span>
        </div>
      </div>
      <div className="outcome-btn__bar">
        <span
          className="outcome-btn__bar-fill"
          style={{
            width: `${probPct ?? 0}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <MiniOutcomeSparkline series={safeSeries} stroke={color} />
    </button>
  );
};

const getMarketStatusLabelAndClass = (
  status: UIMarket["state"] | string,
  isResolved?: boolean,
  isVoid?: boolean,
  winnerOutcomeLabel?: string | null,
  winnerOutcomeIndex?: number | null
) => {
  // If resolved with a winner, show "Winner: [outcome]"
  if (isResolved && !isVoid && winnerOutcomeLabel) {
    const outcomeColorClass = winnerOutcomeIndex != null ? `bg-outcome-${winnerOutcomeIndex}` : '';
    return {
      label: `Winner: ${winnerOutcomeLabel}`,
      className: `text-white border-green-600 ${outcomeColorClass}`,
      hasWinnerColor: true,
      winnerOutcomeIndex
    };
  }

  switch (status) {
    case "open":
      return { label: "open", className: "text-green-700 border-green-600 bg-green-50" };
    case "locked":
      return { label: "locked", className: "text-orange-700 border-orange-600 bg-orange-50" };
    case "resolved":
    case "closed":
      return { label: "closed", className: "text-gray-700 border-gray-500 bg-gray-100" };
    default:
      return { label: String(status), className: "text-gray-700 border-gray-400 bg-gray-100" };
  }
};

export const MarketCard: React.FC<MarketCardProps> = ({
  market,
  onOutcomeClick,
  onShare,
  className,
  disableNavigation,
}) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const { label: timeRemaining } = useTimeRemaining(
    market?.closesAt?.getTime?.() ?? (market as any)?.cutoff_ts ?? null
  );
  const imageUrl = getMarketImageUrl(market);
  const baseStatus =
    (market as any).statusText ??
    (market as any).statusLabel ??
    (market as any).status ??
    market.state ??
    "";
  const isResolved: boolean =
    market.state === "resolved" ||
    baseStatus.toString().toLowerCase?.() === "resolved";
  const isVoid: boolean =
    Boolean((market as any)?.isVoid) ||
    Boolean((market as any)?.rawAccount?.isVoid) ||
    baseStatus.toString().toLowerCase?.() === "void";
  // Compute winner label only when resolved and not void
  const winnerIndex =
    typeof (market as any)?.rawAccount?.winningIndex === "number"
      ? (market as any)?.rawAccount?.winningIndex
      : typeof (market as any)?.rawAccount?.winning_index === "number"
        ? (market as any)?.rawAccount?.winning_index
        : null;
  const winnerOutcomeLabel =
    isResolved &&
      !isVoid &&
      winnerIndex != null &&
      winnerIndex >= 0 &&
      winnerIndex < (market.outcomes?.length ?? 0) &&
      market.outcomes?.[winnerIndex]
      ? market.outcomes[winnerIndex].label
      : undefined;

  // Get status pill with winner information
  const statusPill = getMarketStatusLabelAndClass(
    market.state,
    isResolved,
    isVoid,
    winnerOutcomeLabel,
    winnerIndex
  );
  const statusLabelValue = baseStatus?.toString?.() ?? "";
  const totalVolumeSolLabel = (() => {
    const lamports =
      (market as any)?.volumeLamports ??
      (market as any)?.totalVolumeLamports ??
      market.volumeLamports ??
      0n;
    const sol = Number(lamports) / 1_000_000_000;
    if (!Number.isFinite(sol)) return "0.00";
    return sol.toFixed(2);
  })();
  const { series, latestSnapshot } = useMarketProbabilityHistory(market);
  const snapshots = computeOutcomeSnapshotsFromHistory({ market, series });
  const snapshotMap = new Map(snapshots.map((s) => [s.index, s]));

  const handleCardClick = () => {
    if (!disableNavigation) {
      navigate(`/market/${market.pubkey}`);
    }
  };

  return (
    <div
      className={`win95-window bg-background p-1 mb-2 hover:translate-x-[1px] hover:translate-y-[1px] transition-transform cursor-pointer flex flex-col ${className ?? ""}`}
      onClick={handleCardClick}
    >
      <div className="bg-primary text-primary-foreground px-3 py-2 flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img src={lightbulbIcon} alt="" className="w-6 h-6 opacity-90 flex-shrink-0" />
          <span className="font-black tracking-tight text-base truncate">{market.displayQuestion}</span>
        </div>
        <div className="flex gap-2 flex-shrink-0 items-center">
          <span className={`px-2 py-[2px] border rounded-full text-xs font-bold uppercase ${statusPill.className}`}>
            {statusPill.label}
          </span>
        </div>
      </div>

      <div className="win95-sunken bg-background p-2 relative flex-1 flex flex-col">
        <div className="space-y-2 relative z-10 flex-1 flex flex-col">
          {/* Market Info Header */}
          <div className="flex items-start gap-3 mb-3">
            {imageUrl && (
              <div className="win95-sunken p-1 bg-input flex-shrink-0" style={{ borderColor: 'hsl(var(--primary))' }}>
                <img
                  src={imageUrl}
                  alt={market.displayQuestion}
                  className="w-16 h-16 object-cover"
                  crossOrigin="anonymous"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-black mb-1 leading-tight line-clamp-2">{market.displayQuestion}</h3>
              <div className="space-y-1 text-xs leading-tight">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <span className="font-bold truncate">by {market.creatorName ?? market.creatorLabel}</span>
                  <span>•</span>
                  <button
                    type="button"
                    className="market-card-address font-mono text-xs truncate"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await copyToClipboard(market.pubkey);
                      if (ok) {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      }
                    }}
                  >
                    {market.pubkey.slice(0, 8)}...{market.pubkey.slice(-4)}
                    {copied && <span className="copy-pill">copied</span>}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <span className="font-bold">{timeRemaining}</span>
                </div>
              </div>
            </div>
          </div>

          {market.outcomes.length === 0 || snapshots.length === 0 ? (
            <div className="text-center text-muted-foreground text-xs">No outcomes</div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 min-h-[100px] flex-1" style={{ gridAutoRows: '1fr' }}>
              {market.outcomes.map((outcome, i) => {
                const snap = snapshotMap.get(i);

                // Try to get series points from snapshots first, fallback to direct history extraction
                let outcomeSeriesPoints = Array.isArray(snap?.seriesPoints)
                  ? snap.seriesPoints
                    .filter((p) => typeof p?.value === "number")
                    .map((p) => ({ value: p.value }))
                  : [];

                // Fallback: extract directly from market.history if snapshots don't have data
                if (outcomeSeriesPoints.length === 0 && market.history && Array.isArray(market.history)) {
                  outcomeSeriesPoints = market.history
                    .map(point => ({
                      value: point.probs?.[i] || 0
                    }))
                    .filter(p => typeof p.value === 'number');
                }

                return (
                  <div key={outcome.label} className="space-y-2">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <OutcomeCard
                        label={outcome.label}
                        probPct={snap?.probPct ?? null}
                        odds={snap?.odds ?? null}
                        color={snap?.color ?? getOutcomeColor(i)}
                        series={outcomeSeriesPoints}
                        disabled={market.state !== "open"}
                        onClick={() => onOutcomeClick?.(i)}
                        compact={true}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-auto">
            <MarketStatsRow
              totalVolumeSol={totalVolumeSolLabel}
              closesLabel={timeRemaining}
              statusLabel={statusLabelValue}
              isResolved={isResolved}
              isVoid={isVoid}
              winnerOutcomeLabel={winnerOutcomeLabel}
              winnerOutcomeIndex={winnerIndex}
            />
          </div>

          <div className="absolute inset-0 opacity-[0.03] pointer-events-none flex items-center justify-center text-[10rem] font-black leading-none">
            :)
          </div>
        </div>
      </div>
    </div>

  );
};

export default MarketCard;

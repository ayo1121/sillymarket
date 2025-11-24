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
import { shortenWallet } from "@/utils/format";
import {
  useMarketProbabilityHistory,
  OutcomeSeriesPoint,
  computeOutcomeSnapshotsFromHistory,
} from "@/hooks/useMarketProbabilityHistory";
import { Lock, CheckCircle, XCircle, Flame } from "lucide-react";

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
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border/10 mt-auto">
      <div className="flex items-center gap-1.5">
        <span className="font-bold uppercase tracking-wider opacity-50 text-[10px]">Vol</span>
        <span className="font-mono font-bold text-foreground opacity-80">{totalVolumeSol} SOL</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-bold uppercase tracking-wider opacity-50 text-[10px]">Ends</span>
        <span className="font-bold text-foreground opacity-80">{closesLabel}</span>
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
  series,
  disabled,
  onClick,
  compact,
}) => {
  const probDisplay = probPct !== null ? Math.round(probPct) : 0;
  const oddsDisplay = odds !== null ? odds.toFixed(2) : "1.00";

  // Ensure series data is in the correct format for sparkline
  const safeSeries = Array.isArray(series)
    ? series.map((p: any) => ({ value: p.value ?? p.prob ?? 0 }))
    : [];

  return (
    <div
      className={cn(
        "relative overflow-hidden transition-all duration-200",
        "bg-background border border-border/20 rounded-[4px]",
        "hover:border-primary/40 hover:shadow-sm group",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer active:scale-[0.98]",
        compact ? "p-2" : "p-3"
      )}
      onClick={!disabled ? onClick : undefined}
    >
      {/* Background probability bar */}
      <div
        className="absolute bottom-0 left-0 top-0 transition-all duration-500 opacity-[0.08] group-hover:opacity-[0.12]"
        style={{ width: `${probDisplay}%`, backgroundColor: color }}
      />

      <div className="relative z-10 flex flex-col h-full justify-between gap-2">
        <div className="flex justify-between items-start">
          <span className="font-bold text-sm uppercase tracking-tight leading-none text-foreground/90">{label}</span>
          <span className="font-mono text-xs font-bold opacity-50 group-hover:opacity-80 transition-opacity">{oddsDisplay}x</span>
        </div>

        <div className="flex justify-between items-end">
          <span className="text-2xl font-black tracking-tighter leading-none" style={{ color }}>
            {probDisplay}%
          </span>
          {safeSeries.length > 0 && (
            <div className="w-12 h-6 opacity-40 group-hover:opacity-60 transition-opacity">
              <MiniOutcomeSparkline series={safeSeries} stroke={color} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const MarketCard: React.FC<MarketCardProps> = ({
  market,
  onOutcomeClick,
  onShare,
  className,
  disableNavigation,
}) => {
  const navigate = useNavigate();
  const { label: timeRemainingLabel } = useTimeRemaining(market.closesAt);

  const handleCardClick = (e: React.MouseEvent) => {
    if (disableNavigation) return;
    // Don't navigate if clicking buttons/interactive elements
    if ((e.target as HTMLElement).closest("button")) return;
    navigate(`/market/${market.pubkey}`);
  };

  const totalVolumeSol = (market.volumeLamports / 1_000_000_000).toFixed(2);
  const imageUrl = getMarketImageUrl(market);

  // Status logic
  const normalizedStatus = market.state.toLowerCase();
  const isResolved = market.state === "resolved";
  const isVoid = market.state === "void" || (isResolved && market.rawAccount?.winningIndex === -2);
  const isLocked = market.state === "locked" || (market.state === "open" && market.isLocked);
  const isOpen = normalizedStatus === "open" && !isLocked && !isResolved && !isVoid;

  // Probability history hook
  const { series, loading: historyLoading } = useMarketProbabilityHistory(market);
  const outcomeSnapshots = computeOutcomeSnapshotsFromHistory({ market, series });

  return (
    <div
      className={cn(
        "market-card bg-card/50 p-4 flex flex-col h-full transition-all duration-200 ease-out relative",
        "border border-border/40 rounded-[4px] shadow-[0_4px_12px_rgba(0,0,0,0.03)]",
        "hover:-translate-y-[2px] hover:shadow-[0_8px_16px_rgba(0,0,0,0.06)] hover:border-border/60",
        isOpen && "border-l-4 border-l-green-500/50",
        (isResolved || isVoid) && "opacity-[0.85] grayscale-[0.1]",
        isLocked && "market-card--locked bg-muted/5",
        className
      )}
      onClick={handleCardClick}
    >
      {/* Header: Image + Title */}
      <div className="flex gap-4 mb-5">
        {/* Image */}
        <div className="relative flex-shrink-0">
          <div className="w-14 h-14 rounded-[3px] overflow-hidden border border-border/20 bg-muted/10">
            <img
              src={imageUrl || lightbulbIcon}
              alt="market"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = lightbulbIcon;
              }}
            />
          </div>
        </div>

        {/* Title & Meta */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div className="flex justify-between items-start gap-2">
            <h3 className="font-bold text-[1.15rem] leading-tight line-clamp-2 text-foreground/90 tracking-tight">
              {market.displayQuestion}
            </h3>

            {/* Status Badge (Top Right) */}
            <div className="flex-shrink-0">
              {isLocked && <Lock className="w-4 h-4 text-orange-500/70" />}
              {isResolved && !isVoid && <CheckCircle className="w-4 h-4 text-green-600/70" />}
              {isVoid && <XCircle className="w-4 h-4 text-[#7a7a7a]/70" />}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#7a7a7a] mt-1">
            <span className="font-medium">
              by {market.creatorUsername || shortenWallet(market.creatorPubkey, 4)}
            </span>
            <span className="font-mono opacity-60">
              {shortenWallet(market.pubkey, 4)}
            </span>
            <span className={cn(
              "font-bold uppercase tracking-wider text-[10px]",
              isOpen && "text-green-600/90",
              isLocked && "text-orange-500/90",
              isResolved && !isVoid && "text-brand-yes/90",
              isVoid && "text-[#7a7a7a]"
            )}>
              {isVoid ? "VOID" : isResolved ? "RESOLVED" : isLocked ? "LOCKED" : "OPEN"}
            </span>
          </div>
        </div>
      </div>

      {/* Outcomes Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4 flex-1">
        {market.outcomes.map((outcome, idx) => {
          const color = getOutcomeColor(idx);
          const seriesPoints = outcomeSnapshots[idx]?.seriesPoints || [];

          // Calculate odds
          const pool = Number(outcome.poolLamports);
          const total = Number(market.volumeLamports);
          const odds = pool > 0 ? total / pool : 0;

          return (
            <OutcomeCard
              key={idx}
              label={outcome.label}
              probPct={outcome.probability * 100}
              odds={odds}
              color={color}
              series={seriesPoints}
              disabled={!isOpen}
              onClick={() => {
                if (isOpen && onOutcomeClick) {
                  onOutcomeClick(idx);
                }
              }}
            />
          );
        })}
      </div>

      {/* Footer Stats */}
      <MarketStatsRow
        totalVolumeSol={totalVolumeSol}
        closesLabel={timeRemainingLabel}
        statusLabel={market.state}
        isResolved={isResolved}
        isVoid={isVoid}
        winnerOutcomeLabel={
          isResolved && !isVoid && market.rawAccount?.winningIndex !== undefined
            ? market.outcomes[market.rawAccount.winningIndex]?.label
            : null
        }
        winnerOutcomeIndex={market.rawAccount?.winningIndex}
      />
    </div>
  );
};

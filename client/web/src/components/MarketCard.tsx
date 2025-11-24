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
  onClick?: (e?: React.MouseEvent) => void;
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
        "outcome-card relative overflow-hidden transition-all duration-200",
        "border rounded-[4px]",
        "hover:shadow-sm group",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer active:scale-[0.98]",
        compact ? "p-2" : "p-3"
      )}
      style={{
        borderColor: `${color}40`, // 25% opacity border
        backgroundColor: `${color}08` // 3% opacity bg
      }}
      onClick={!disabled ? onClick : undefined}
    >
      {/* Background probability bar */}
      <div
        className="absolute bottom-0 left-0 top-0 transition-all duration-500 opacity-[0.15] group-hover:opacity-[0.2]"
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
    // Don't navigate if clicking buttons/interactive elements or outcome cards
    if ((e.target as HTMLElement).closest("button")) return;
    if ((e.target as HTMLElement).closest(".outcome-card")) return;
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

  const copyAddress = (e: React.MouseEvent, address: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    // Could add a toast here if we had a toast hook easily accessible in this component
  };

  return (
    <div
      className={cn(
        "market-card bg-[#e5e5e5] p-4 flex flex-col h-full transition-all duration-200 ease-out relative",
        "border border-[#8a8a8a] rounded-[4px] shadow-[0_2px_4px_rgba(0,0,0,0.15)]",
        "hover:-translate-y-[3px] hover:shadow-[0_8px_16px_rgba(0,0,0,0.2)] hover:bg-[#f0f0f0]",
        isOpen && "border-l-[3px] border-l-[#15a349]",
        (isResolved || isVoid) && "opacity-[0.9] grayscale-[0.2] border-l-0",
        // Removed watermark class
        className
      )}
      onClick={handleCardClick}
    >
      {/* Header: Image + Title */}
      <div className="flex gap-4 mb-5">
        {/* Image */}
        <div className="relative flex-shrink-0">
          <div className="w-14 h-14 rounded-[3px] overflow-hidden border border-[#8a8a8a] bg-white">
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
            <h3 className="font-bold text-[1.15rem] leading-tight line-clamp-2 text-[#111] tracking-tight">
              {market.displayQuestion}
            </h3>

            {/* Status Badge (Top Right) */}
            <div className="flex-shrink-0 flex gap-1 flex-wrap justify-end max-w-[80px]">
              {isLocked && <div className="bg-orange-100 border border-orange-200 rounded-full p-1"><Lock className="w-3 h-3 text-[#ff8a2a]" /></div>}
              {isResolved && !isVoid && <div className="bg-green-100 border border-green-200 rounded-full p-1"><CheckCircle className="w-3 h-3 text-[#15a349]" /></div>}
              {isVoid && <div className="bg-red-100 border border-red-200 rounded-full p-1"><XCircle className="w-3 h-3 text-[#e64545]" /></div>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5f5f5f] mt-1">
            <span className="font-medium whitespace-nowrap">
              by {market.creatorUsername || market.creatorPubkey}
            </span>
            <span className="opacity-40">•</span>
            <button
              onClick={(e) => copyAddress(e, market.pubkey)}
              className="font-mono opacity-60 hover:opacity-100 hover:text-[#111] cursor-copy transition-opacity flex items-center gap-1"
              title="Copy Market Address"
            >
              {shortenWallet(market.pubkey, 4)}
              <span className="sr-only">Copy</span>
            </button>
            <span className="opacity-40">•</span>
            <span className={cn(
              "font-bold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded-[2px] border whitespace-nowrap",
              isOpen && "bg-green-50 text-[#15a349] border-green-100",
              isLocked && "bg-orange-50 text-[#ff8a2a] border-orange-100",
              isResolved && !isVoid && "bg-green-50 text-[#15a349] border-green-100",
              isVoid && "bg-red-50 text-[#e64545] border-red-100"
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

          // Symmetry: if odd number of outcomes, last one spans 2 cols
          const isLastAndOdd = (market.outcomes.length % 2 !== 0) && (idx === market.outcomes.length - 1);

          return (
            <div
              key={idx}
              className={cn(
                "rounded-[4px] p-0.5 transition-all", // p-0.5 for slight gap if needed, or just rely on OutcomeCard
                isLastAndOdd ? "col-span-2" : ""
              )}
            >
              <OutcomeCard
                label={outcome.label}
                probPct={outcome.probability * 100}
                odds={odds}
                color={color}
                series={seriesPoints}
                disabled={!isOpen}
                onClick={(e) => {
                  console.log('[MarketCard] OutcomeCard clicked', { idx, isOpen, hasCallback: !!onOutcomeClick });
                  if (e) {
                    e.stopPropagation(); // Prevent card click
                  }
                  if (isOpen && onOutcomeClick) {
                    console.log('[MarketCard] Calling onOutcomeClick', idx);
                    onOutcomeClick(idx);
                  } else {
                    console.log('[MarketCard] Not calling onOutcomeClick', { isOpen, hasCallback: !!onOutcomeClick });
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Footer Stats */}
      <div className="border-t border-[#d4d4d4] pt-3 mt-auto">
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
    </div>
  );
};

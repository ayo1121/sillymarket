import React from "react";
import { getOutcomeColor } from "@/solana/outcomeColors";

export type MarketState = "open" | "locked" | "resolved" | "void";

interface MarketStatusBadgeProps {
    state: MarketState | string;
    isVoid?: boolean;
    winnerOutcomeLabel?: string;
    winnerOutcomeIndex?: number | null;
    className?: string;
}

/**
 * Shared status badge component for markets and bets
 * 
 * Display rules:
 * - Void markets: "VOID" (gray)
 * - Resolved with winner: "Winner: [outcome]" (outcome color)
 * - Resolved without winner: "RESOLVED" (green)
 * - Locked/Closed: "LOCKED" (orange)
 * - Open: "OPEN" (green)
 */
export const MarketStatusBadge: React.FC<MarketStatusBadgeProps> = ({
    state,
    isVoid,
    winnerOutcomeLabel,
    winnerOutcomeIndex,
    className = "",
}) => {
    const normalized = state?.toString().toLowerCase?.() ?? "";
    const showWinner = !isVoid && typeof winnerOutcomeLabel === "string" && winnerOutcomeLabel.trim().length > 0;

    let text = state || "unknown";
    let bgColor = "#e0e0e0";
    let textColor = "#111";

    if (isVoid) {
        text = "VOID";
        bgColor = "#666";
        textColor = "#fff";
    } else if (normalized === "resolved" || normalized === "settled") {
        text = showWinner ? `Winner: ${winnerOutcomeLabel}` : "RESOLVED";
        if (showWinner && winnerOutcomeIndex != null) {
            const outcomeColor = getOutcomeColor(winnerOutcomeIndex);
            bgColor = outcomeColor;
            textColor = "#fff";
        } else {
            bgColor = "#4caf50";
            textColor = "#fff";
        }
    } else if (normalized === "locked" || normalized === "closed") {
        text = "LOCKED";
        bgColor = "#ff9800";
        textColor = "#fff";
    } else if (normalized === "open") {
        text = "OPEN";
        bgColor = "#4caf50";
        textColor = "#fff";
    }

    return (
        <div
            className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide shadow-sm ${className}`}
            style={{ backgroundColor: bgColor, color: textColor }}
        >
            {text}
        </div>
    );
};

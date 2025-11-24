import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { BettingModal } from "@/components/BettingModal";
import { CommentsSection } from "@/components/CommentsSection";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { ArrowLeft } from "lucide-react";
import { useAnchorProgram } from "@/solana/program";
import { ShareMarketModal } from "@/components/ShareMarketModal";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchMarket,
  fetchConfig,
  fetchUserPositions,
  canResolveMarket,
  canClaimPosition,
} from "@/solana/read";
import { resolveMarket, claimWinnings, voidMarket } from "@/solana/actions";
import type { UIMarket, MarketActivityItem } from "@/solana/marketMapping";
import { resolveOutcomeLabelFromMarket } from "@/solana/marketMapping";
import { getOutcomeColor } from "@/solana/outcomeColors";
import { formatVolume, shortenWallet } from "@/utils/format";
import { formatTimeAgo } from "@/utils/time";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { BetPlacedPayload } from "../components/BettingModal";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { supabase } from "@/integrations/supabase/client";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { useTimeRemaining } from "@/hooks/useTimeRemaining";
import { useMarketProbabilityHistory } from "@/hooks/useMarketProbabilityHistory";
import { getMarketImageUrl } from "@/solana/marketImage";
import { OutcomeCard, MarketStatsRow } from "@/components/MarketCard";
import ProbabilityChart from "@/components/ProbabilityChart";
import { showErrorToast } from "@/lib/errorHandling";
import type { MarketHistoryPoint } from "@/solana/marketMapping";
import { useMarketActivity } from "@/hooks/useMarketActivity";
import { FeeDecayInfo } from "@/components/FeeDecayInfo";

type ResolutionPillProps = {
  state: string | null | undefined;
  isVoid?: boolean;
  winnerOutcomeLabel?: string;
  winnerOutcomeIndex?: number | null;
};

/**
 * Status pill component for market resolution state.
 * Display rules:
 * - Void markets: "void"
 * - Resolved with winner: shows "Winner: [outcome]" (e.g., "Winner: yes", "Winner: no") with outcome color
 * - Resolved without winner: "resolved"
 * - Locked/Closed: "locked" or "closed"
 * - Open: "open"
 */
const ResolutionPill: React.FC<ResolutionPillProps> = ({ state, isVoid, winnerOutcomeLabel, winnerOutcomeIndex }) => {
  const normalized = state?.toString().toLowerCase?.() ?? "";
  const showWinner = !isVoid && typeof winnerOutcomeLabel === "string" && winnerOutcomeLabel.trim().length > 0;

  let text = state || "unknown";
  let variant: "open" | "locked" | "resolved" | "void" | "unknown" = "unknown";

  if (isVoid) {
    text = "void";
    variant = "void";
  } else if (normalized === "resolved" || normalized === "settled") {
    // Show "Winner: [outcome]" for resolved markets with a winner
    text = showWinner ? `Winner: ${winnerOutcomeLabel}` : "resolved";
    variant = "resolved";
  } else if (normalized === "locked" || normalized === "closed") {
    text = state ?? "locked";
    variant = "locked";
  } else if (normalized === "open") {
    text = "open";
    variant = "open";
  } else {
    console.warn("[ResolutionPill] unknown status", state);
  }

  // Apply outcome color when showing winner
  const hasWinnerColor = showWinner && winnerOutcomeIndex != null;
  const outcomeColorClass = hasWinnerColor ? `bg-outcome-${winnerOutcomeIndex}` : '';

  return (
    <div className={`market-resolution-pill market-stat-box--status-${variant}`}>
      <span
        className={`market-stat-pill ${outcomeColorClass} truncate max-w-[150px]`}
        style={hasWinnerColor ? { color: '#ffffff', fontWeight: 'bold' } : undefined}
      >
        {text}
      </span>
    </div>
  );
};

const MarketDetails = () => {
  const { id: marketId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const wallet = useWallet();
  const { publicKey } = wallet;
  const identity = useWalletIdentity();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);
  const [market, setMarket] = useState<UIMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<any | null>(null);
  const [config, setConfig] = useState<any | null>(null);
  const [resolving, setResolving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [shareTarget, setShareTarget] = useState<UIMarket | null>(null);
  const handleOpenShare = useCallback((m: UIMarket) => setShareTarget(m), []);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedCreator, setCopiedCreator] = useState(false);
  const closesAtMs = useMemo(
    () =>
      market?.closesAt?.getTime?.() ??
      (market as any)?.cutoff_ts ??
      (market as any)?.cutoffTs ??
      null,
    [market]
  );
  const { label: liveClosesLabel } = useTimeRemaining(closesAtMs);
  const imageUrl = getMarketImageUrl(market);
  const outcomeCount = market?.outcomes.length ?? 0;
  const pools = useMemo(() => {
    if (!market) return [];
    return market.outcomes.map((o) => Number(o.poolLamports ?? 0));
  }, [market]);
  const poolProbabilities = useMemo(() => {
    const total = pools.reduce((sum, v) => sum + v, 0);
    if (!total || !Number.isFinite(total)) {
      return Array(outcomeCount).fill(0);
    }
    return pools.map((p) => Number(p) / total);
  }, [pools, outcomeCount]);
  const outcomesWithProb = useMemo(() => {
    if (!market) return [];
    return market.outcomes.map((o, idx) => {
      const prob = Number.isFinite(poolProbabilities[idx]) ? poolProbabilities[idx] : 0;
      const probPct = Number.isFinite(prob) ? Number((prob * 100).toFixed(1)) : 0;
      const odds = prob > 0 ? Number((1 / prob).toFixed(2)) : 0;
      return {
        ...o,
        index: idx,
        probPct,
        odds,
      };
    });
  }, [market, poolProbabilities]);

  // Activity with labels - moved here to ensure all hooks are called before early returns
  const { history: liveHistory, activity: liveActivity } = useMarketActivity(market);

  const activityWithLabels = useMemo(() => {
    if (!market) return [];
    const rawActivity = (liveActivity && liveActivity.length > 0 ? liveActivity : market?.activity) ?? [];
    return rawActivity
      .filter((item) => item.outcomeIndex !== null && item.outcomeIndex !== undefined)
      .map((item) => ({
        ...item,
        outcomeLabel: resolveOutcomeLabelFromMarket(market, item.outcomeIndex),
      }));
  }, [market, liveActivity]);

  // Probability history for chart - must be called before early returns
  const probabilityHistory = useMarketProbabilityHistory(market);
  const [probHistory, setProbHistory] = useState<MarketHistoryPoint[]>([]);

  // Seed history when market changes
  useEffect(() => {
    if (!market) {
      setProbHistory([]);
      return;
    }
    const initialHistory =
      (liveHistory && liveHistory.length > 0 ? liveHistory : market.history) ?? [];
    setProbHistory(initialHistory);
  }, [market?.pubkey, liveHistory]);

  // Append new point whenever probabilities change
  useEffect(() => {
    if (!market) return;
    if (!poolProbabilities.length) return;
    if (poolProbabilities.length !== outcomeCount) return;

    setProbHistory((prev) => {
      const last = prev[prev.length - 1];
      const unchanged =
        last &&
        last.probs?.length === poolProbabilities.length &&
        poolProbabilities.every((p, i) => Math.abs((last.probs?.[i] ?? 0) - p) < 1e-6);
      if (unchanged) return prev;
      const nextPoint: MarketHistoryPoint = {
        ts: Date.now(),
        probs: poolProbabilities.slice(),
      };
      return [...prev, nextPoint];
    });
  }, [market?.pubkey, poolProbabilities, outcomeCount]);

  const MAX_VISIBLE_RECENT = 10;

  // Fetch market data
  useEffect(() => {
    if (!program || !marketId) {
      setLoading(false);
      return;
    }

    const loadMarket = async () => {
      try {
        setLoading(true);
        setError(null);
        const marketData = await fetchMarket(program as any, marketId, wallet.publicKey ?? null);
        if (marketData) {
          setMarket(marketData);

          // Fetch user position if wallet is connected
          if (wallet.publicKey && program) {
            try {
              const positions = await fetchUserPositions(program as any, wallet.publicKey);
              const positionForMarket = positions.find((p: any) => {
                const posMarket = p.account.market;
                const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
                return marketPubkey === marketId;
              });
              setUserPosition(positionForMarket || null);
            } catch (posErr) {
              console.error("Error fetching user position:", posErr);
              setUserPosition(null);
            }
          }

          // Fetch config for resolve checks
          if (program) {
            try {
              const configData = await fetchConfig(program as any);
              setConfig(configData);
            } catch (configErr) {
              console.error("Error fetching config:", configErr);
              setConfig(null);
            }
          }
        } else {
          setError("Market not found");
        }
      } catch (e: any) {
        console.error("Error fetching market:", e);
        setError(e?.message || "Failed to load market");
      } finally {
        setLoading(false);
      }
    };

    loadMarket();
  }, [program, marketId, wallet.publicKey]);

  // Helper functions for pool calculations
  // Refresh market data from Supabase bets + on-chain
  const refreshMarket = useCallback(async () => {
    if (!marketId || !program) return;
    try {
      console.log("[MarketDetails] Refreshing market from Supabase bets + on-chain...");
      const refreshed = await fetchMarket(program as any, new PublicKey(marketId), wallet.publicKey ?? null);
      if (refreshed) {
        setMarket(refreshed);

        // Refresh user position
        if (wallet.publicKey) {
          try {
            const positions = await fetchUserPositions(program as any, wallet.publicKey);
            const positionForMarket = positions.find((p: any) => {
              const posMarket = p.account.market;
              const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
              return marketPubkey === marketId;
            });
            setUserPosition(positionForMarket || null);
          } catch (posErr) {
            console.error("Error refreshing user position:", posErr);
            setUserPosition(null);
          }
        }
      }
    } catch (err) {
      console.error("[MarketDetails] refreshMarket failed", err);
    }
  }, [marketId, program, wallet.publicKey]);

  // Handler for when a bet is placed - refresh after indexer processes the event
  const handleBetPlaced = useCallback(
    (payload: BetPlacedPayload) => {
      console.log("[MarketDetails] Bet placed, waiting for indexer", payload.txSig);
      // Polling refresh after bet tx as local fallback (Realtime should handle it too)
      setTimeout(() => {
        console.log("[MarketDetails] Polling refresh after bet tx", payload.txSig);
        refreshMarket();
      }, 2000);
    },
    [refreshMarket]
  );

  const handleCopyAddress = useCallback(async () => {
    if (!market?.pubkey) return;
    try {
      await navigator.clipboard.writeText(market.pubkey);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 1500);
    } catch (err) {
      console.error("[MarketDetails] failed to copy address", err);
    }
  }, [market]);

  const handleCopyCreator = useCallback(async () => {
    if (!market?.creatorPubkey) return;
    try {
      await navigator.clipboard.writeText(market.creatorPubkey);
      setCopiedCreator(true);
      setTimeout(() => setCopiedCreator(false), 1500);
    } catch (err) {
      console.error("[MarketDetails] failed to copy creator address", err);
    }
  }, [market]);

  // Supabase Realtime subscription for bet inserts
  useEffect(() => {
    if (!marketId) {
      console.log("[MarketDetails] Realtime: no marketId, skipping subscription");
      return;
    }

    console.log("[MarketDetails] Realtime: subscribing for bets on market", marketId);

    const channel = supabase
      .channel(`bets:market:${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bets",
          filter: `market_pubkey=eq.${marketId}`,
        },
        (payload) => {
          console.log("[MarketDetails] Realtime bet insert", payload);
          // When any new bet for this market is indexed, refresh full market view
          refreshMarket();
        }
      )
      .subscribe((status) => {
        console.log("[MarketDetails] Realtime channel status", status);
      });

    // Optional: extra error/close hooks if using supabase-js v2 RealtimeChannel API
    channel.on("broadcast", { event: "error" }, (err: any) => {
      console.error("[MarketDetails] Realtime channel error", err);
    });

    return () => {
      console.log("[MarketDetails] Realtime: cleaning up channel for", marketId);
      supabase.removeChannel(channel);
    };
  }, [marketId, refreshMarket]);

  if (loading) {
    return (
      <div className="min-h-screen bg-win95-teal">
        <Header />
        <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
          <div className="text-center">Loading market...</div>
        </main>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen bg-win95-teal">
        <Header />
        <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
          <div className="text-center text-red-600">{error || "Market not found"}</div>
          <Button onClick={() => navigate("/")} className="mt-4">Back to markets</Button>
        </main>
      </div>
    );
  }

  const baseStatus =
    (market as any)?.statusText ??
    (market as any)?.statusLabel ??
    (market as any)?.status ??
    market?.state ??
    "";
  const isResolved =
    market?.state === "resolved" ||
    baseStatus.toString().toLowerCase?.() === "resolved";
  const isVoid =
    Boolean((market as any)?.isVoid) ||
    Boolean((market as any)?.rawAccount?.isVoid) ||
    baseStatus.toString().toLowerCase?.() === "void";
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
  const statsStatusLabel = baseStatus;
  const totalVolumeLamports =
    (market as any)?.volumeLamports ??
    (market as any)?.totalVolumeLamports ??
    market.volumeLamports ??
    0n;
  const totalVolumeLabel = (() => {
    const sol = Number(totalVolumeLamports) / 1_000_000_000;
    if (!Number.isFinite(sol)) return "0.00";
    return sol.toFixed(2);
  })();

  console.log("[MarketDetails] hooks OK, market loaded?", !!market);

  const filteredActivity = activityWithLabels.filter(
    (item) => item.outcomeIndex !== null && item.outcomeLabel !== "Unknown"
  );

  const visibleActivity = showAllActivity
    ? filteredActivity
    : filteredActivity.slice(0, MAX_VISIBLE_RECENT);

  const hasMoreActivity = filteredActivity.length > MAX_VISIBLE_RECENT;

  const handleBetClick = (outcomeIndex: number) => {
    setSelectedOutcomeIndex(outcomeIndex);
    setModalOpen(true);
  };



  const title = market.displayQuestion || `Market ${market.pubkey.slice(0, 4)}...`;

  return (
    <div className="min-h-screen bg-win95-teal">
      <Header />

      <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
        <div className="max-w-6xl mx-auto">
          <Button
            variant="default"
            onClick={() => navigate("/")}
            className="mb-4 sm:mb-6 font-black text-sm sm:text-base"
          >
            <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4 mr-2" />
            back to markets
          </Button>

          {/* Claim Status Banner */}
          {market && (() => {
            const configAuthority = config?.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
            const canClaim = canClaimPosition({
              market: market.rawAccount,
              position: userPosition?.account || userPosition,
              wallet: publicKey,
            });

            if (canClaim) {
              return (
                <div className="win95-window bg-background p-1 mb-4 sm:mb-6" style={{ textAlign: "center", padding: "16px" }}>
                  <div className="win95-sunken bg-background p-4" style={{ backgroundColor: "#fff3cd", border: "2px solid #ffc107" }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: "16px" }}>You have unclaimed winnings</div>
                    <div style={{ marginBottom: 12, fontSize: 13 }}>
                      Click the <strong>Claim</strong> button below to withdraw your winnings.
                    </div>
                  </div>
                </div>
              );
            } else if (market.isResolved && publicKey) {
              return (
                <div className="win95-window bg-background p-1 mb-4 sm:mb-6" style={{ textAlign: "center" }}>
                  <div className="win95-sunken bg-background p-3" style={{ padding: "12px" }}>
                    <span style={{ fontSize: 12 }}>Market resolved · no claimable position on this wallet.</span>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Fee Decay Information (for creators after cutoff) */}
          {market && publicKey && publicKey.toBase58() === market.creatorPubkey && (
            <FeeDecayInfo
              cutoffTs={market.closesAt}
              isResolved={isResolved}
              isCreator={true}
            />
          )}

          {/* Market Header */}
          <div className="win95-window bg-background p-1 mb-4 sm:mb-6">
            <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <img src={lightbulbIcon} alt="" className="w-4 h-4 sm:w-5 sm:h-5 opacity-80" />
                <span className="font-black tracking-tight text-xs sm:text-sm">market details</span>
              </div>
              <div className="flex gap-2 items-center min-w-0">
                <div className="max-w-[200px]">
                  <ResolutionPill
                    state={statsStatusLabel}
                    isVoid={isVoid}
                    winnerOutcomeLabel={winnerOutcomeLabel}
                    winnerOutcomeIndex={winnerIndex}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="font-black text-xs sm:text-sm"
                  onClick={() => handleOpenShare(market)}
                >
                  share
                </Button>
              </div>
            </div>

            <div className="win95-sunken bg-background p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 mb-4 sm:mb-6">
                {imageUrl && (
                  <div className="win95-sunken p-2 bg-input flex-shrink-0 w-full sm:w-auto" style={{ borderColor: 'hsl(var(--primary))' }}>
                    <img
                      src={imageUrl}
                      alt={title}
                      className="w-full h-48 sm:w-32 sm:h-32 object-cover"
                      crossOrigin="anonymous"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl sm:text-4xl font-black mb-3 sm:mb-4 break-words">{title}</h1>
                  <div className="space-y-2 mb-3 sm:mb-4">
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm sm:text-base">
                      <button
                        type="button"
                        onClick={handleCopyCreator}
                        className="font-bold hover:underline flex items-center gap-1 group"
                        title="Copy creator address"
                      >
                        by {market.creatorName ?? market.creatorLabel}{" "}
                        <span className="creator-wallet text-muted-foreground text-xs sm:text-sm font-normal group-hover:text-foreground transition-colors">
                          {shortenWallet(market.creatorPubkey ?? "")}
                        </span>
                        {copiedCreator && <span className="text-xs font-normal ml-1 text-green-600">• copied</span>}
                      </button>
                      <span className="hidden sm:inline">•</span>
                      <button
                        type="button"
                        onClick={handleCopyAddress}
                        className="font-mono text-xs sm:text-sm truncate underline-offset-2 hover:underline"
                        title="Copy market address"
                      >
                        {market.pubkey.slice(0, 8)}...{market.pubkey.slice(-4)}{" "}
                        <span className="font-semibold">{copiedAddress ? "• copied" : ""}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {market && (
                <MarketStatsRow
                  totalVolumeSol={totalVolumeLabel}
                  closesLabel={liveClosesLabel}
                  statusLabel={statsStatusLabel}
                  isResolved={isResolved}
                  isVoid={isVoid}
                  winnerOutcomeLabel={winnerOutcomeLabel}
                  winnerOutcomeIndex={winnerIndex}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Betting Panel */}
            <div className="lg:col-span-1">
              <div className="win95-window bg-background p-1">
                <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                  <span className="font-black text-xs sm:text-sm tracking-tight">place your bet</span>
                </div>

                <div className="win95-sunken bg-background p-3 sm:p-4 space-y-2">
                  {outcomesWithProb.length === 0 ? (
                    <div className="text-center text-muted-foreground text-xs">No outcomes</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      {outcomesWithProb.map((o) => {
                        // Extract probability history for this specific outcome
                        const historySource = (liveHistory && liveHistory.length > 0 ? liveHistory : market.history) || [];
                        const outcomeSeries = historySource
                          .map(point => ({
                            value: point.probs[o.index] || 0
                          }))
                          .filter(p => typeof p.value === 'number');

                        return (
                          <div key={o.index} onClick={() => handleBetClick(o.index)}>
                            <OutcomeCard
                              label={o.label}
                              probPct={o.probPct}
                              odds={o.odds}
                              color={getOutcomeColor(o.index)}
                              series={outcomeSeries}
                              disabled={market.state !== "open"}
                              onClick={() => handleBetClick(o.index)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Resolve/Claim Actions */}
              {publicKey && market && (() => {
                const configAuthority = config?.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
                const canResolve = canResolveMarket({
                  market: market.rawAccount,
                  wallet: publicKey,
                  configAuthority,
                  configAdminPreCutoff: config?.adminPreCutoff ?? config?.admin_pre_cutoff ?? false,
                });

                const canClaim = canClaimPosition({
                  market: market.rawAccount,
                  position: userPosition?.account || userPosition,
                  wallet: publicKey,
                });

                return (
                  <>
                    {canResolve && (
                      <div className="win95-window bg-background p-1">
                        <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                          <span className="font-black text-xs sm:text-sm tracking-tight">resolve market</span>
                        </div>
                        <div className="win95-sunken bg-background p-3 sm:p-4 space-y-2">
                          {market.isLocked && (
                            <div className="text-xs text-muted-foreground mb-2">Status: Locked (cutoff passed)</div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {market.outcomes.slice(0, 5).map((outcome, i) => (
                              <Button
                                key={i}
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  if (!program || !publicKey || !marketId || resolving) return;

                                  // Get fee wallet from config
                                  const feeWallet = (config as any)?.feeWallet || (config as any)?.fee_wallet || (config as any)?.feeWalletAcc;
                                  if (!feeWallet) {
                                    toast.error("Config fee wallet not found");
                                    return;
                                  }

                                  // Get creator wallet
                                  const creatorWallet = (market.rawAccount as any)?.creator;
                                  if (!creatorWallet) {
                                    toast.error("Market creator wallet not found");
                                    return;
                                  }

                                  setResolving(true);
                                  try {
                                    const marketPk = new PublicKey(marketId);
                                    const sig = await resolveMarket(program as any, {
                                      market: marketPk,
                                      signer: publicKey,
                                      winnerIndex: i,
                                      platformFeeWallet: new PublicKey(feeWallet),
                                      creatorWallet: new PublicKey(creatorWallet),
                                    });
                                    toast.success(`Market resolved! Transaction: ${sig.slice(0, 8)}...`);
                                    await refreshMarket();
                                  } catch (error: any) {
                                    console.error("Resolve error:", error);
                                    showErrorToast(error, "Failed to resolve market");
                                  } finally {
                                    setResolving(false);
                                  }
                                }}
                                disabled={resolving}
                                className="font-bold"
                              >
                                Resolve: {outcome.label}
                              </Button>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!program || !publicKey || !marketId || resolving) return;

                                // Get fee wallet from config
                                const feeWallet = (config as any)?.feeWallet || (config as any)?.fee_wallet || (config as any)?.feeWalletAcc;
                                if (!feeWallet) {
                                  toast.error("Config fee wallet not found");
                                  return;
                                }

                                // Get creator wallet
                                const creatorWallet = (market.rawAccount as any)?.creator;
                                if (!creatorWallet) {
                                  toast.error("Market creator wallet not found");
                                  return;
                                }

                                setResolving(true);
                                try {
                                  const marketPk = new PublicKey(marketId);
                                  const sig = await voidMarket(program as any, {
                                    market: marketPk,
                                    signer: publicKey,
                                    platformFeeWallet: new PublicKey(feeWallet),
                                    creatorWallet: new PublicKey(creatorWallet),
                                  });
                                  toast.success(`Market voided! Transaction: ${sig.slice(0, 8)}...`);
                                  await refreshMarket();
                                } catch (error: any) {
                                  console.error("Void error:", error);
                                  showErrorToast(error, "Failed to void market");
                                } finally {
                                  setResolving(false);
                                }
                              }}
                              disabled={resolving}
                              className="font-bold"
                            >
                              VOID
                            </Button>
                          </div>
                          {resolving && (
                            <div className="text-xs text-muted-foreground">Submitting transaction...</div>
                          )}
                        </div>
                      </div>
                    )}

                    {market.isResolved && canClaim && (
                      <div className="win95-window bg-background p-1">
                        <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                          <span className="font-black text-xs sm:text-sm tracking-tight">claim winnings</span>
                        </div>
                        <div className="win95-sunken bg-background p-3 sm:p-4">
                          <Button
                            variant="primary"
                            onClick={async () => {
                              if (!program || !publicKey || !marketId || claiming) return;
                              setClaiming(true);
                              try {
                                const marketPk = new PublicKey(marketId);
                                const sig = await claimWinnings(program as any, {
                                  market: marketPk,
                                  user: publicKey,
                                });
                                toast.success(`Winnings claimed! Transaction: ${sig.slice(0, 8)}...`);
                                await refreshMarket();
                              } catch (error: any) {
                                console.error("Claim error:", error);
                                showErrorToast(error, "Failed to claim winnings");
                              } finally {
                                setClaiming(false);
                              }
                            }}
                            disabled={claiming}
                            className="w-full"
                          >
                            {claiming ? "Claiming..." : "Claim Winnings"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {market.isResolved && publicKey && !canClaim && (
                      <div className="win95-window bg-background p-1">
                        <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                          <span className="font-black text-xs sm:text-sm tracking-tight">claim status</span>
                        </div>
                        <div className="win95-sunken bg-background p-3 sm:p-4 text-xs text-muted-foreground">
                          No claimable position. You may not have a winning position or it may already be claimed.
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Charts and Activity */}
            <div className="lg:col-span-2 space-y-4 sm:space-y-6">
              {/* Chart */}
              <div className="win95-window bg-background p-1">
                <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                  <span className="font-black text-xs sm:text-sm tracking-tight">probability over time</span>
                </div>
                <div className="win95-sunken bg-background p-3 sm:p-6">
                  <div className="h-48 sm:h-64 win95-sunken p-2 sm:p-4 bg-input">
                    <ProbabilityChart market={market} history={probHistory} />
                  </div>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="win95-window bg-background p-1">
                <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                  <span className="font-black text-xs sm:text-sm tracking-tight">recent activity</span>
                </div>

                <div className="win95-sunken bg-background p-3 sm:p-4">
                  <div className="border border-gray-400 border-t-0 bg-[#d3d3d3]">
                    {visibleActivity.length === 0 ? (
                      <div className="px-4 py-6 text-xs text-gray-700 italic">
                        no activity yet. be the first!
                      </div>
                    ) : (
                      <>
                        <div className="divide-y divide-gray-400">
                          {visibleActivity.map((item) => {
                            const solscanUrl = item.txSig
                              ? `https://solscan.io/tx/${item.txSig}?cluster=devnet`
                              : undefined;
                            const timeStr = new Date(item.ts).toLocaleTimeString();
                            const displayName = item.username || shortenWallet(item.wallet);

                            let activityText = "";
                            if (item.kind === "bet") {
                              activityText = `bet ${item.outcomeLabel ?? "Unknown"}`;
                            } else if (item.kind === "market_created") {
                              activityText = "created market";
                            } else if (item.kind === "resolved") {
                              activityText = `resolved ${item.outcomeLabel ?? "Unknown"}`;
                            }

                            return (
                              <button
                                key={`${item.kind}-${item.ts}-${item.wallet}`}
                                type="button"
                                className={
                                  item.txSig
                                    ? "w-full text-left cursor-pointer hover:bg-muted px-4 py-2 text-xs border-t border-gray-400"
                                    : "w-full text-left px-4 py-2 text-xs border-t border-gray-400"
                                }
                                onClick={() => {
                                  if (item.txSig && solscanUrl) {
                                    window.open(solscanUrl, "_blank", "noopener,noreferrer");
                                  }
                                }}
                              >
                                <div className="flex justify-between items-center">
                                  <div>
                                    <div>{displayName}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {activityText}
                                      {item.kind === "bet" && item.amountSol != null && ` • ${item.amountSol.toFixed(3)} SOL`}
                                    </div>
                                  </div>
                                  <div className="text-right text-xs">
                                    {item.kind === "bet" && item.amountSol != null && (
                                      <div>{item.amountSol.toFixed(2)} sol</div>
                                    )}
                                    <div className="text-muted-foreground">{timeStr}</div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {hasMoreActivity && (
                          <div className="px-4 py-2 border-t border-gray-400">
                            <button
                              type="button"
                              onClick={() => setShowAllActivity(v => !v)}
                              className="text-xs text-primary hover:underline cursor-pointer"
                              style={{ textDecoration: "underline", color: "#0066cc" }}
                            >
                              {showAllActivity ? "show less activity" : `show more activity (${filteredActivity.length - MAX_VISIBLE_RECENT} more)`}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Comments Section */}
              <CommentsSection marketId={market.pubkey} />
              {shareTarget && (
                <ShareMarketModal
                  open={Boolean(shareTarget)}
                  onOpenChange={(open) => {
                    if (!open) setShareTarget(null);
                  }}
                  market={shareTarget}
                />
              )}
            </div>
          </div>


        </div>
      </main>

      <BettingModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        market={market}
        initialAnswerIndex={selectedOutcomeIndex}
        onBetPlaced={handleBetPlaced}
      />
    </div>
  );
};

export default MarketDetails;

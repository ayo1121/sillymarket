import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { BettingModal } from "@/components/BettingModal";
import { CommentsSection } from "@/components/CommentsSection";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { ArrowLeft, Share2 } from "lucide-react";
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
import { formatVolume, shortenWallet, formatSol } from "@/utils/format";
import { formatTimeAgo } from "@/utils/time";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { BetPlacedPayload } from "../components/BettingModal";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { supabase } from "@/integrations/supabase/client";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { logPageView } from "@/lib/analytics";
import { useTimeRemaining } from "@/hooks/useTimeRemaining";
import { useMarketProbabilityHistory } from "@/hooks/useMarketProbabilityHistory";
import { getMarketImageUrl } from "@/solana/marketImage";
import { OutcomeCard, MarketStatsRow } from "@/components/MarketCard";
import ProbabilityChart from "@/components/ProbabilityChart";
import { showErrorToast } from "@/lib/errorHandling";
import type { MarketHistoryPoint } from "@/solana/marketMapping";
import { useMarketActivity } from "@/hooks/useMarketActivity";
import { FeeDecayInfo } from "@/components/FeeDecayInfo";
import { getTxExplorerUrl } from "@/utils/solanaExplorer";
import { MarketDetailsSkeleton } from "@/components/skeletons/MarketDetailsSkeleton";
import confetti from "canvas-confetti";
import { SEO } from "@/components/SEO";
import { MarketStructuredData } from "@/components/StructuredData";

import { MarketStatusBadge } from "@/components/common/MarketStatusBadge";
import { useRealtimeBets } from "@/hooks/useRealtimeSubscription";

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
  const [reloadTrigger, setReloadTrigger] = useState(0);
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
  }, [market, liveHistory]);

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
  }, [market, poolProbabilities, outcomeCount]);

  const MAX_VISIBLE_RECENT = 10;

  // Realtime subscription for new bets
  useRealtimeBets(marketId || "", (newBet) => {
    console.log("[MarketDetails] New bet received via realtime:", newBet);
    // Trigger a reload of market data to reflect the new bet
    setReloadTrigger(prev => prev + 1);
  });

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

          // Track page view for analytics
          logPageView('market_details', { market_pubkey: marketId });

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
  }, [program, marketId, wallet.publicKey, reloadTrigger]);


  // Helper functions for pool calculations
  // Refresh market data from Supabase bets + on-chain
  const refreshMarket = useCallback(async () => {
    if (!marketId || !program) return;
    try {
      console.log("[MarketDetails] Refreshing market from Supabase bets + on-chain...");
      const m = await fetchMarket(program as any, new PublicKey(marketId), publicKey ?? null);
      if (m) {
        setMarket(m);

        // Refresh user position
        if (publicKey) {
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
  }, [marketId, program, publicKey, wallet.publicKey]);

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

  // SKELETON LOADING: Show skeleton on initial load instead of generic text
  if (loading) {
    return <MarketDetailsSkeleton />;
  }

  if (error || !market) {
    return (
      <div className="min-h-screen bg-[#c0c0c0]">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="text-center text-red-600 mb-4">{error || "Market not found"}</div>
          <div className="text-center">
            <Button onClick={() => navigate("/")} variant="outline" className="font-semibold">
              Back to Markets
            </Button>
          </div>
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
    return formatSol(sol, 2);
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
    <div className="min-h-screen bg-background text-foreground transition-colors">
      {/* SEO: Dynamic meta tags for market page */}
      <SEO
        title={market.displayQuestion}
        description={market.backendDescription || `Prediction market: ${market.displayQuestion}. Created by ${market.creatorLabel}. ${market.outcomes.map((o, i) => `${o.label}: ${(poolProbabilities[i] * 100).toFixed(1)}%`).join(', ')}`}
        image={imageUrl}
        url={`/market/${market.pubkey}`}
        type="article"
      />

      {/* Structured Data: JSON-LD for rich snippets */}
      <MarketStructuredData
        market={{
          displayQuestion: market.displayQuestion,
          description: market.backendDescription,
          createdAt: market.createdAt,
          closesAt: market.closesAt,
          creatorLabel: market.creatorLabel,
          pubkey: market.pubkey,
        }}
      />

      <Header />

      <main className="container mx-auto px-3 sm:px-4 py-6 max-w-6xl space-y-6">
        {/* Top Navigation Bar - Retro Toolbar Style */}
        <div className="bg-[#d4d0c8] dark:bg-[#242424] border border-[#8b8b8b] dark:border-[#3a3a3a] rounded-sm shadow-[inset_1px_1px_0_rgba(255,255,255,0.8),inset_-1px_-1px_0_rgba(0,0,0,0.2)] px-3 py-2">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="font-semibold text-sm hover:bg-[#e8e8e8] dark:hover:bg-[#323232] px-3 py-2 h-auto"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Markets
          </Button>
        </div>

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
              <div className="bg-[#fff9e6] dark:bg-[#332a00] border-2 border-[#ffc107] rounded p-4 shadow-md">
                <div className="font-black text-base mb-2 text-[#111] dark:text-white">🎉 You have unclaimed winnings!</div>
                <div className="text-sm text-[#333] dark:text-[#f1f1f1]">
                  Click the <strong>Claim Winnings</strong> button below to withdraw your earnings.
                </div>
              </div>
            );
          } else if (market.isResolved && publicKey) {
            return (
              <div className="bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded p-3 text-center text-sm text-muted-foreground">
                Market resolved · no claimable position on this wallet.
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

        {/* Market Header Card - Enhanced */}
        <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-6 mb-4 sm:mb-6 relative overflow-hidden">
          {/* Faint smiley watermark */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[120px] sm:text-[200px] font-black text-gray-400 select-none">
            : )
          </div>

          <div className="relative z-10">
            {/* Top Row: Status + Share Button */}
            <div className="flex justify-between items-center mb-4 sm:mb-5 gap-3 flex-wrap">
              <MarketStatusBadge
                state={statsStatusLabel}
                isVoid={isVoid}
                winnerOutcomeLabel={winnerOutcomeLabel}
                winnerOutcomeIndex={winnerIndex}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenShare(market)}
                className="font-semibold border-[#8b8b8b] hover:bg-[#e8e8e8] shadow-sm h-8 sm:h-9 text-xs sm:text-sm"
              >
                <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                Share
              </Button>
            </div>

            {/* Main Content Row */}
            <div className="flex flex-col md:flex-row items-start gap-4 sm:gap-6">
              {/* Market Image */}
              {imageUrl && (
                <div className="flex-shrink-0 border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded overflow-hidden w-full sm:w-24 sm:h-24 md:w-36 md:h-36 shadow-sm hidden sm:block">
                  <img
                    src={imageUrl}
                    alt={title}
                    className="w-full h-full object-cover"
                    crossOrigin="anonymous"
                  />
                </div>
              )}

              {/* Market Info */}
              <div className="flex-1 min-w-0 w-full">
                <div className="flex gap-3 sm:hidden mb-3">
                  {imageUrl && (
                    <div className="flex-shrink-0 border border-[#8b8b8b] dark:border-[#3a3a3a] rounded overflow-hidden w-16 h-16 shadow-sm">
                      <img
                        src={imageUrl}
                        alt={title}
                        className="w-full h-full object-cover"
                        crossOrigin="anonymous"
                      />
                    </div>
                  )}
                  <h1 className="text-xl font-black leading-tight text-[#111] dark:text-white line-clamp-3">{title}</h1>
                </div>

                <h1 className="hidden sm:block text-2xl sm:text-3xl md:text-4xl font-black mb-3 sm:mb-4 break-words leading-tight text-[#111] dark:text-white">{title}</h1>

                {/* Creator & Market Info */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm text-[#555] dark:text-[#c7c7c7]">
                  <Link
                    to={`/profile/${market.creatorPubkey}`}
                    className="font-semibold hover:text-[#111] dark:hover:text-white transition-colors hover:underline flex items-center gap-1"
                    title="View creator profile"
                  >
                    by {market.creatorUsername ?? market.creatorName ?? market.creatorLabel}
                  </Link>
                  <span className="text-[#999]">•</span>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="font-mono text-[10px] sm:text-xs hover:text-[#111] dark:hover:text-white transition-colors hover:underline flex items-center gap-1"
                    title="Copy market address"
                  >
                    {shortenWallet(market.pubkey)}
                    {copiedAddress && <span className="text-green-600 font-bold">✓</span>}
                  </button>
                  <span className="text-[#999]">•</span>
                  <span className={Number(totalVolumeLabel) > 0 ? "text-green-600 font-semibold" : ""}>
                    Vol: {totalVolumeLabel} SOL
                  </span>
                  <span className="text-[#999]">•</span>
                  <span className="font-semibold">{liveClosesLabel}</span>
                </div>

                {/* Description */}
                {market.backendDescription && (
                  <div className="mt-4 pt-4 border-t border-[#e0e0e0] dark:border-[#333]">
                    <p className="text-sm text-[#333] dark:text-[#d7d7d7] whitespace-pre-wrap leading-relaxed">
                      {market.backendDescription}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Betting Panel */}
          <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
            {/* Place Your Bet Panel */}
            <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
                : )
              </div>

              <div className="relative z-10">
                <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-4 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
                  Place Your Bet
                </h2>

                {outcomesWithProb.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-8">No outcomes</div>
                ) : (
                  <div className="space-y-3">
                    {outcomesWithProb.map((o) => {
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
                    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5">
                      <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-4 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
                        Resolve Market
                      </h2>
                      {market.isLocked && (
                        <div className="text-xs text-muted-foreground mb-3 bg-[#fff9e6] dark:bg-[#332a00] border border-[#ffc107] rounded px-2 py-1">
                          Status: Locked (cutoff passed)
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {market.outcomes.slice(0, 5).map((outcome, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (!program || !publicKey || !marketId || resolving) return;

                              const feeWallet = (config as any)?.feeWallet || (config as any)?.fee_wallet || (config as any)?.feeWalletAcc;
                              if (!feeWallet) {
                                toast.error("Config fee wallet not found");
                                return;
                              }

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
                                toast.success(
                                  <div className="flex flex-col gap-1 text-sm">
                                    <span>Market resolved! Transaction: {sig.slice(0, 8)}...</span>
                                    <a
                                      href={getTxExplorerUrl(sig)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline font-semibold text-xs"
                                    >
                                      View on Explorer
                                    </a>
                                  </div>
                                );
                                await refreshMarket();
                              } catch (error: any) {
                                console.error("Resolve error:", error);
                                showErrorToast(error, "Failed to resolve market");
                              } finally {
                                setResolving(false);
                              }
                            }}
                            disabled={resolving}
                            className="font-semibold border-[#8b8b8b] hover:bg-[#e8e8e8]"
                          >
                            {resolving ? "Resolving..." : outcome.label}
                          </Button>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (!program || !publicKey || !marketId || resolving) return;

                            const feeWallet = (config as any)?.feeWallet || (config as any)?.fee_wallet || (config as any)?.feeWalletAcc;
                            if (!feeWallet) {
                              toast.error("Config fee wallet not found");
                              return;
                            }

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
                              toast.success(
                                <div className="flex flex-col gap-1 text-sm">
                                  <span>Market voided! Transaction: {sig.slice(0, 8)}...</span>
                                  <a
                                    href={getTxExplorerUrl(sig)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline font-semibold text-xs"
                                  >
                                    View on Explorer
                                  </a>
                                </div>
                              );
                              await refreshMarket();
                            } catch (error: any) {
                              console.error("Void error:", error);
                              showErrorToast(error, "Failed to void market");
                            } finally {
                              setResolving(false);
                            }
                          }}
                          disabled={resolving}
                          className="font-semibold border-[#8b8b8b] hover:bg-[#e8e8e8]"
                        >
                          {resolving ? "Resolving..." : "VOID"}
                        </Button>
                      </div>
                      {resolving && (
                        <div className="text-xs text-muted-foreground mt-2">Submitting transaction...</div>
                      )}
                    </div>
                  )}

                  {market.isResolved && canClaim && (
                    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5">
                      <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-4 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
                        Claim Winnings
                      </h2>
                      <Button
                        variant="default"
                        onClick={async () => {
                          if (!program || !publicKey || !marketId || claiming) return;
                          setClaiming(true);
                          try {
                            const marketPk = new PublicKey(marketId);
                            const sig = await claimWinnings(program as any, {
                              market: marketPk,
                              user: publicKey,
                            });
                            toast.success(
                              <div className="flex flex-col gap-1 text-sm">
                                <span>Winnings claimed! Transaction: {sig.slice(0, 8)}...</span>
                                <a
                                  href={getTxExplorerUrl(sig)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline font-semibold text-xs"
                                >
                                  View on Explorer
                                </a>
                              </div>
                            );

                            // MICRO-INTERACTION: Confetti celebration on successful claim
                            confetti({
                              particleCount: 100,
                              spread: 70,
                              origin: { y: 0.6 }
                            });

                            // MICRO-INTERACTION: Haptic feedback (mobile only)
                            if (navigator.vibrate) {
                              navigator.vibrate([100, 50, 100, 50, 200]);
                            }

                            await refreshMarket();
                          } catch (error: any) {
                            console.error("Claim error:", error);
                            showErrorToast(error, "Failed to claim winnings");
                          } finally {
                            setClaiming(false);
                          }
                        }}
                        disabled={claiming}
                        className="w-full font-bold shadow-md"
                      >
                        {claiming ? "Claiming..." : "Claim Winnings"}
                      </Button>
                    </div>
                  )}

                  {market.isResolved && publicKey && !canClaim && (
                    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5">
                      <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-3 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
                        Claim Status
                      </h2>
                      <div className="text-xs text-muted-foreground">
                        No claimable position. You may not have a winning position or it may already be claimed.
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Right Column - Chart, Comments, Activity */}
          <div className="lg:col-span-2 space-y-6 order-1 lg:order-2">
            {/* Probability Chart */}
            <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
                : )
              </div>
              <div className="relative z-10">
                <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-4 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
                  Probability History
                </h2>
                <div className="h-[250px] sm:h-[300px] w-full">
                  <ProbabilityChart
                    history={probHistory}
                    outcomes={market.outcomes}
                  />
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
                : )
              </div>
              <div className="relative z-10">
                <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-4 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
                  Recent Activity
                </h2>
                <div className="space-y-0">
                  {visibleActivity.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm py-8">No recent activity</div>
                  ) : (
                    visibleActivity.map((item, i) => {
                      const isBuy = item.kind === "bet";
                      const isSell = false; // No sell event yet
                      const isResolve = item.kind === "resolved";

                      // Format time
                      const timeLabel = formatTimeAgo(new Date(item.ts));

                      const content = (
                        <>
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${isBuy ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800" :
                              isResolve ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800" :
                                "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
                              }`}>
                              {isBuy ? "BET" : isResolve ? "RES" : "UNK"}
                            </div>
                            <div className="flex flex-col">
                              <div className="text-sm font-bold text-[#111] dark:text-white">
                                {item.username ? (
                                  <span className="text-primary dark:text-white mr-1">@{item.username}</span>
                                ) : (
                                  shortenWallet(item.wallet)
                                )}
                                <span className="font-normal text-[#666] dark:text-[#999] mx-1">
                                  {isBuy ? "bet on" : isResolve ? "resolved" : "acted on"}
                                </span>
                                <span className={`font-bold ${item.outcomeIndex !== undefined ? getOutcomeColor(item.outcomeIndex) : ""
                                  }`}>
                                  {item.outcomeLabel}
                                </span>
                              </div>
                              <div className="text-xs text-[#999]">
                                {timeLabel}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-[#111] dark:text-white text-sm">
                              {item.amountSol ? `${formatSol(item.amountSol)} SOL` : "-"}
                            </div>
                          </div>
                        </>
                      );

                      if (item.txSig) {
                        return (
                          <a
                            key={i}
                            href={getTxExplorerUrl(item.txSig)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between py-3 border-b border-[#f0f0f0] dark:border-[#333] last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                          >
                            {content}
                          </a>
                        );
                      }

                      return (
                        <div key={i} className="flex items-center justify-between py-3 border-b border-[#f0f0f0] dark:border-[#333] last:border-0">
                          {content}
                        </div>
                      );
                    })
                  )}
                </div>

                {hasMoreActivity && (
                  <div className="mt-4 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllActivity(!showAllActivity)}
                      className="text-xs font-bold text-[#666] dark:text-[#999] hover:text-[#111] dark:hover:text-white"
                    >
                      {showAllActivity ? "Show Less" : "Show All Activity"}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Comments Section */}
            <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
                : )
              </div>
              <div className="relative z-10">
                <CommentsSection marketId={marketId!} />
              </div>
            </div>


          </div>
        </div>
      </main>

      {market?.state === "open" && (
        <div className="fixed bottom-4 left-0 right-0 px-4 md:hidden">
          <div className="max-w-xl mx-auto bg-[#e0e0e0] dark:bg-[#1f1f1f] border border-[#8b8b8b] dark:border-[#333] shadow-[2px_2px_0_rgba(0,0,0,0.25)] rounded-full flex items-center justify-between px-4 py-3">
            <div className="flex flex-col">
              <span className="text-xs uppercase font-black text-[#555] dark:text-[#c7c7c7]">Ready to bet?</span>
              <span className="text-sm font-bold text-[#111] dark:text-white">{title}</span>
            </div>
            <Button
              size="sm"
              onClick={() => handleBetClick(selectedOutcomeIndex || 0)}
              className="font-bold h-10 px-4 rounded-md shadow-[2px_2px_0_rgba(0,0,0,0.25)]"
            >
              Place Bet
            </Button>
          </div>
        </div>
      )}

      <BettingModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        market={market}
        initialAnswerIndex={selectedOutcomeIndex}
        onBetPlaced={handleBetPlaced}
      />

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
  );
};

export default MarketDetails;

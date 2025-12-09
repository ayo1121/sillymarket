import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowRight } from "lucide-react";
import { useAnchorProgram } from "@/solana/program";
import { useWallet } from "@solana/wallet-adapter-react";
import { claimWinnings } from "@/solana/actions";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { getBetStatus, computePnL, BetStatus, isPositionClaimable } from "@/hooks/marketsContext";
import { formatSol, shortenWallet } from "@/utils/format";
import { MarketCard } from "@/components/MarketCard";
import { resolveMarket } from "@/solana/actions";
import { fetchConfig, fetchUserPositions, fetchMarketsBatch, fetchUserMarkets } from "@/solana/read";
import { getTxExplorerUrl } from "@/utils/solanaExplorer";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { BetCardSkeletonList } from "@/components/skeletons/BetCardSkeleton";
import { MarketCardSkeletonGrid } from "@/components/skeletons/MarketCardSkeleton";
import confetti from "canvas-confetti";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/integrations/supabase/client";
import { logPageView, logClick } from "@/lib/analytics";
import type { BetRow } from "@/supabase/bets";
import { MarketStatusBadge } from "@/components/common/MarketStatusBadge";
import { WalletNotConnected } from "@/components/WalletNotConnected";
import { filterHiddenMarkets } from "@/constants/hiddenMarkets";

interface BetView {
  id: string;
  question: string;
  prediction: string;
  amount: number;
  odds: number;
  pnlLamports: bigint;
  payoutLamports: bigint | null;
  status: BetStatus;
  realized: boolean;
  stakeLamports: bigint;
  createdAt: string;
  imageUrl?: string;
  category: string;
  marketAddress: string;
  creatorAddress: string;
  marketPubkey: string;
  position: any | null;
  canClaim: boolean;
  txSig?: string | null; // Transaction signature for Solscan link
}

const MyBets = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const { publicKey } = useWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<"active" | "won" | "lost">("active");
  const [claiming, setClaiming] = useState<Map<string, boolean>>(new Map());
  const [claimingAll, setClaimingAll] = useState(false);

  // Initialize view mode from URL query param
  const [viewMode, setViewMode] = useState<"bets" | "markets">(() => {
    return searchParams.get("view") === "markets" ? "markets" : "bets";
  });

  // Sync state changes to URL (one-way: state → URL only)
  // This prevents the infinite loop by only syncing in one direction
  useEffect(() => {
    const currentView = searchParams.get("view");

    if (viewMode === "markets" && currentView !== "markets") {
      setSearchParams({ view: "markets" }, { replace: true });
    } else if (viewMode === "bets" && currentView === "markets") {
      setSearchParams({}, { replace: true });
    }
  }, [viewMode]); // Only depend on viewMode, not searchParams

  const [marketFilter, setMarketFilter] = useState<"active" | "resolved">("active");
  const [resolving, setResolving] = useState<Map<string, boolean>>(new Map());
  const [config, setConfig] = useState<any>(null);

  // Fetch config on mount
  useEffect(() => {
    if (program) {
      fetchConfig(program as any).then(setConfig).catch(console.error);
    }
  }, [program]);

  // Track page view
  useEffect(() => {
    logPageView('my_bets');
  }, []);

  // Fetch user positions with React Query
  const { data: positions = [], isLoading: positionsLoading, refetch: refetchPositions } = useQuery({
    queryKey: queryKeys.positions.user(publicKey?.toBase58() || ''),
    queryFn: async () => {
      if (!program || !publicKey) return [];

      if (import.meta.env.DEV) {
        console.log('[MyBets] Fetching positions for:', publicKey.toBase58());
      }

      return fetchUserPositions(program as any, publicKey);
    },
    enabled: !!program && !!publicKey,
    staleTime: 60_000, // 1 minute
  });

  // Extract market pubkeys from positions
  const marketPubkeys = useMemo(() => {
    return positions.map((p: any) => {
      const marketPk = p.account.market;
      return marketPk?.toBase58?.() || marketPk?.toString?.() || '';
    }).filter(Boolean);
  }, [positions]);

  // Batch fetch only markets for user's positions
  const { data: marketsMap = new Map(), isLoading: marketsLoading } = useQuery({
    queryKey: queryKeys.markets.batch(marketPubkeys),
    queryFn: async () => {
      if (!program || marketPubkeys.length === 0) return new Map();

      if (import.meta.env.DEV) {
        console.log(`[MyBets] Batch fetching ${marketPubkeys.length} markets`);
      }

      return fetchMarketsBatch(program as any, marketPubkeys);
    },
    enabled: !!program && marketPubkeys.length > 0,
    staleTime: 60_000, // 1 minute
  });

  // Fetch user's created markets (for Markets tab)
  const { data: myMarkets = [], isLoading: myMarketsLoading } = useQuery({
    queryKey: queryKeys.markets.creator(publicKey?.toBase58() || ''),
    queryFn: async () => {
      if (!program || !publicKey) return [];

      if (import.meta.env.DEV) {
        console.log('[MyBets] Fetching created markets for:', publicKey.toBase58());
      }

      return fetchUserMarkets(program as any, publicKey);
    },
    enabled: !!program && !!publicKey && viewMode === 'markets',
    staleTime: 60_000, // 1 minute
  });

  // Fetch user bets from Supabase for tx_sig enrichment
  const { data: userBetsData = [] } = useQuery({
    queryKey: ['userBets', publicKey?.toBase58() || ''],
    queryFn: async () => {
      if (!publicKey) return [];

      const { data, error } = await (supabase as any)
        .from('bets')
        .select('market_pubkey, outcome_index, tx_sig, amount_lamports')
        .eq('bettor_pubkey', publicKey.toBase58())
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[MyBets] Error fetching bets:', error);
        return [];
      }

      return (data || []) as BetRow[];
    },
    enabled: !!publicKey,
    staleTime: 60_000,
  });

  // Helper to refresh positions (for claim callbacks)
  const refreshPositions = async () => {
    await refetchPositions();
  };

  // MOBILE FEATURE: Swipe gestures for bet status tab navigation
  // Allows swiping left/right to change between Active/Won/Lost tabs on mobile
  const betStatusFilters: ("active" | "won" | "lost")[] = ["active", "won", "lost"];
  const currentBetStatusIndex = betStatusFilters.indexOf(statusFilter);

  useSwipeGesture(
    () => {
      // Swipe left - next status (only in bets view)
      if (viewMode === "bets") {
        const nextIndex = (currentBetStatusIndex + 1) % betStatusFilters.length;
        setStatusFilter(betStatusFilters[nextIndex]);
      }
    },
    () => {
      // Swipe right - previous status (only in bets view)
      if (viewMode === "bets") {
        const prevIndex = (currentBetStatusIndex - 1 + betStatusFilters.length) % betStatusFilters.length;
        setStatusFilter(betStatusFilters[prevIndex]);
      }
    }
  );

  // MOBILE FEATURE: Swipe gestures for market filter tab navigation
  // Allows swiping left/right to change between Active/Resolved tabs on mobile
  const marketFilters: ("active" | "resolved")[] = ["active", "resolved"];
  const currentMarketFilterIndex = marketFilters.indexOf(marketFilter);

  useSwipeGesture(
    () => {
      // Swipe left - next filter (only in markets view)
      if (viewMode === "markets") {
        const nextIndex = (currentMarketFilterIndex + 1) % marketFilters.length;
        setMarketFilter(marketFilters[nextIndex]);
      }
    },
    () => {
      // Swipe right - previous filter (only in markets view)
      if (viewMode === "markets") {
        const prevIndex = (currentMarketFilterIndex - 1 + marketFilters.length) % marketFilters.length;
        setMarketFilter(marketFilters[prevIndex]);
      }
    }
  );

  const betsView: BetView[] = useMemo(() => {
    if (!publicKey) return [];
    return positions
      .map((pos: any) => {
        const marketPk = pos.account.market?.toBase58?.() || pos.account.market?.toString?.();
        const market = marketsMap.get(marketPk);
        if (!market) return null;

        const rawMarket = market.rawAccount || market;
        const outcomeIndex: number | null = pos.account.outcomeIndex ?? pos.account.outcome_index ?? null;
        const outcomeName =
          outcomeIndex != null
            ? market.outcomes?.[outcomeIndex]?.label ?? `Outcome ${outcomeIndex}`
            : "Unknown";

        const stakeLamports = BigInt(pos.account.amount ?? 0);
        const stakeSol = Number(stakeLamports) / LAMPORTS_PER_SOL;

        const totalPoolLamports = Number(rawMarket.totalPool ?? rawMarket.total_pool ?? market.volumeLamports ?? 0);
        const outcomePoolLamports = Number(market.outcomes?.[outcomeIndex ?? -1]?.poolLamports ?? 0);
        const odds = outcomePoolLamports > 0 ? totalPoolLamports / outcomePoolLamports : 1;

        const status = getBetStatus(pos.account, market);
        const pnlResult = computePnL(pos.account, market);
        const pnlLamports = pnlResult.pnlLamports;
        const payoutLamports = pnlResult.payoutLamports ?? null;

        const canClaim = isPositionClaimable(pos.account, market);

        const createdTs =
          rawMarket.createdTs?.toNumber?.() ??
          rawMarket.created_ts?.toNumber?.() ??
          rawMarket.createdTs ??
          rawMarket.created_ts ??
          Date.now();
        const createdDate = new Date(createdTs * 1000);
        const createdAt = formatDistanceToNow(createdDate, { addSuffix: true });

        const imageUrl = market.imageUrl;
        const category = market.category || "General";
        const marketAddress = shortenWallet(marketPk);
        const creatorAddress = market.creatorPubkey || "";

        // Enrich with tx_sig from Supabase bets
        // Match by market + outcome + approximate amount
        const matchingBet = userBetsData.find((bet: BetRow) => {
          if (bet.market_pubkey !== marketPk) return false;
          if (bet.outcome_index !== outcomeIndex) return false;
          // Approximate amount match (within 1% tolerance for rounding)
          const betAmount = Number(bet.amount_lamports || 0);
          const posAmount = Number(stakeLamports);
          if (betAmount === 0 || posAmount === 0) return false;
          const diff = Math.abs(betAmount - posAmount) / posAmount;
          return diff < 0.01;
        });

        return {
          id: `${marketPk}-${outcomeIndex}`,
          question: market.displayQuestion || market.question || "Unknown Market",
          prediction: outcomeName,
          amount: stakeSol,
          odds: Number(odds.toFixed(2)),
          pnlLamports,
          payoutLamports,
          status,
          realized: status !== "active",
          stakeLamports,
          createdAt,
          imageUrl,
          category,
          marketAddress,
          creatorAddress,
          marketPubkey: marketPk,
          position: pos,
          canClaim,
          txSig: matchingBet?.tx_sig || null,
        };
      })
      .filter((bet): bet is BetView => bet !== null);
  }, [positions, marketsMap, publicKey, userBetsData]);

  const filteredBets = useMemo(() => {
    return betsView.filter((bet) => {
      if (statusFilter === "active") return bet.status === "active";
      if (statusFilter === "won") return bet.status === "won";
      if (statusFilter === "lost") return bet.status === "lost";
      return true;
    });
  }, [betsView, statusFilter]);

  const totalBet = useMemo(() => {
    return betsView.reduce((sum, bet) => sum + bet.amount, 0);
  }, [betsView]);

  const realizedPnl = useMemo(() => {
    return betsView
      .filter((bet) => bet.realized)
      .reduce((sum, bet) => sum + Number(bet.pnlLamports) / LAMPORTS_PER_SOL, 0);
  }, [betsView]);

  const claimableBets = useMemo(() => {
    return betsView.filter((bet) => bet.canClaim);
  }, [betsView]);

  const handleClaimAll = async () => {
    if (!program || !publicKey || claimingAll) return;

    setClaimingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const bet of claimableBets) {
      try {
        const marketPk = new PublicKey(bet.marketPubkey);
        const sig = await claimWinnings(program, {
          market: marketPk,
          user: publicKey,
        });
        console.log(`Claimed ${bet.id}: ${sig}`);
        successCount++;
      } catch (error: any) {
        console.error(`Failed to claim ${bet.id}:`, error);
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Claimed ${successCount} position(s)!`);
      await refreshPositions();
    }
    if (failCount > 0) {
      toast.error(`Failed to claim ${failCount} position(s)`);
    }

    setClaimingAll(false);
  };

  const handleClaim = async (bet: BetView) => {
    if (!program || !publicKey || claiming.get(bet.id)) return;

    const nextClaiming = new Map(claiming);
    nextClaiming.set(bet.id, true);
    setClaiming(nextClaiming);
    try {
      const marketPk = new PublicKey(bet.marketPubkey);
      const sig = await claimWinnings(program, {
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

      await refreshPositions();
    } catch (error: any) {
      console.error("Claim error:", error);
      const errorMsg = error?.message || "Failed to claim winnings";
      if (errorMsg.includes("Unauthorized") || errorMsg.includes("InvalidState") || errorMsg.includes("AlreadyClaimed")) {
        toast.error("Cannot claim: " + errorMsg);
      } else {
        toast.error(errorMsg);
      }
    } finally {
      const resetClaiming = new Map(claiming);
      resetClaiming.set(bet.id, false);
      setClaiming(resetClaiming);
    }
  };

  // Filter created markets by status (active/resolved)
  const filteredMyMarkets = useMemo(() => {
    return filterHiddenMarkets(myMarkets)
      .filter(market => {
        const isResolved = market.state === "resolved" || market.isResolved;
        if (marketFilter === "active") {
          return !isResolved;
        } else {
          return isResolved;
        }
      })
      .sort((a, b) => {
        const aTs = a.rawAccount?.createdTs?.toNumber?.() ?? a.rawAccount?.created_ts?.toNumber?.() ?? 0;
        const bTs = b.rawAccount?.createdTs?.toNumber?.() ?? b.rawAccount?.created_ts?.toNumber?.() ?? 0;
        return bTs - aTs; // Newest first
      });
  }, [myMarkets, marketFilter]);

  // Calculate market stats from user's created markets
  const marketStats = useMemo(() => {
    if (!publicKey || myMarkets.length === 0) return { totalVolume: 0, feesCollected: 0 };

    const totalVolumeLamports = myMarkets.reduce((sum, market) => {
      const vol = Number(market.volumeLamports || market.rawAccount?.totalPool || 0);
      return sum + vol;
    }, 0);

    const feesCollectedLamports = myMarkets.reduce((sum, market) => {
      // For resolved markets, fees are already distributed and reset to 0 on-chain.
      // We estimate creator fees as ~1% of volume (50% of the 2% total fee).
      if (market.isResolved) {
        return sum + (Number(market.volumeLamports) * 0.01);
      }

      // For active markets, use the accrued total (which is the full 2% fee).
      // We estimate the creator's potential share as 50% (1% total).
      const rawFees = Number(market.rawAccount?.feesAccruedTotal ?? market.rawAccount?.fees_accrued_total ?? 0);
      return sum + (rawFees * 0.5);
    }, 0);

    return {
      totalVolume: totalVolumeLamports / LAMPORTS_PER_SOL,
      feesCollected: feesCollectedLamports / LAMPORTS_PER_SOL,
    };
  }, [myMarkets, publicKey]);

  const handleResolveMarket = async (marketPubkey: string, winnerIndex: number) => {
    if (!program || !publicKey || resolving.get(marketPubkey)) return;

    const market = myMarkets.find(m => m.pubkey === marketPubkey);
    if (!market) return;

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

    const nextResolving = new Map(resolving);
    nextResolving.set(marketPubkey, true);
    setResolving(nextResolving);

    try {
      const marketPk = new PublicKey(marketPubkey);
      const sig = await resolveMarket(program as any, {
        market: marketPk,
        signer: publicKey,
        winnerIndex,
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
      await refreshPositions();
    } catch (error: any) {
      console.error("Resolve error:", error);
      const errorMsg = error?.message || "Failed to resolve market";
      toast.error(errorMsg);
    } finally {
      const resetResolving = new Map(resolving);
      resetResolving.set(marketPubkey, false);
      setResolving(resetResolving);
    }
  };

  const loading = marketsLoading || positionsLoading;

  return <div className="min-h-screen bg-background text-foreground">
    <Header />

    <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-6xl">
      <div className="bg-[#f5f5f5] dark:bg-[#1a1a1a] border border-[#d3d3d3] dark:border-[#333] rounded shadow-sm p-4 sm:p-6 mb-6 sm:mb-8 relative overflow-hidden">
        {/* Faint smiley watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08] text-[120px] font-black text-gray-400 select-none">
          : )
        </div>

        <div className="relative z-10">
          {/* Header with toggle */}
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black">
              {viewMode === "bets" ? "my bets :)" : "my markets :)"}
            </h1>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setViewMode(viewMode === "bets" ? "markets" : "bets")}
              className="font-semibold border-[#8b8b8b] dark:border-[#3a3a3a] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a]"
            >
              {viewMode === "bets" ? "My Markets" : "My Bets"}
            </Button>
          </div>

          {/* Green accent bar */}
          <div className="h-1 w-24 bg-gradient-to-r from-green-400 to-green-600 mb-6 rounded-full"></div>

          {viewMode === "bets" ? (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded-md p-4 sm:p-5 shadow-sm">
                  <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-2 tracking-wide">Total Bet</div>
                  <div className="text-2xl font-bold text-[#111] dark:text-white">{formatSol(totalBet, 2)} SOL</div>
                </div>
                <div className="bg-white dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded-md p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold tracking-wide">Realized PnL</div>
                    {claimableBets.length > 0 && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={handleClaimAll}
                        disabled={claimingAll}
                        className="text-xs h-7 px-3 font-semibold"
                      >
                        {claimingAll ? "Claiming..." : `Claim All (${claimableBets.length})`}
                      </Button>
                    )}
                  </div>
                  <div className={`text-2xl font-bold ${realizedPnl > 0 ? "text-green-600" : realizedPnl < 0 ? "text-red-600" : "text-[#111]"}`}>
                    {formatSol(realizedPnl, 2)} SOL
                  </div>
                </div>
              </div>

              {/* MOBILE: Touch target optimized tabs - min 44px height */}
              <div className="flex flex-wrap gap-3 mb-6" role="tablist">
                {(["active", "won", "lost"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-4 py-2 rounded text-sm font-semibold transition-all min-h-[44px] ${statusFilter === status
                      ? "bg-[#111] text-white shadow-sm"
                      : "bg-[#e8e8e8] dark:bg-[#2a2a2a] text-[#111] dark:text-white hover:bg-[#d8d8d8] dark:hover:bg-[#3a3a3a] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
                      }`}
                    role="tab"
                    aria-selected={statusFilter === status}
                    aria-label={`${status.charAt(0).toUpperCase() + status.slice(1)} bets`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Market Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-[#111] border border-[#e0e0e0] dark:border-[#2f2f2f] rounded-md p-4 sm:p-5 shadow-sm">
                  <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-2 tracking-wide">Total Volume</div>
                  <div className="text-2xl font-bold text-[#111] dark:text-white">{formatSol(marketStats.totalVolume, 2)} SOL</div>
                </div>
                <div className="bg-white dark:bg-[#111] border border-[#e0e0e0] dark:border-[#2f2f2f] rounded-md p-4 sm:p-5 shadow-sm">
                  <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-2 tracking-wide">Fees Collected</div>
                  <div className="text-2xl font-bold text-green-600">{formatSol(marketStats.feesCollected, 2)} SOL</div>
                </div>
              </div>

              {/* MOBILE: Touch target optimized market tabs - min 44px height */}
              <div className="flex flex-wrap gap-3 mb-6" role="tablist">
                {(["active", "resolved"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setMarketFilter(filter)}
                    className={`px-4 py-2 rounded text-sm font-semibold transition-all min-h-[44px] ${marketFilter === filter
                      ? "bg-[#111] text-white shadow-sm"
                      : "bg-[#e8e8e8] dark:bg-[#2a2a2a] text-[#111] dark:text-white hover:bg-[#d8d8d8] dark:hover:bg-[#3a3a3a] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
                      }`}
                    role="tab"
                    aria-selected={marketFilter === filter}
                    aria-label={`${filter.charAt(0).toUpperCase() + filter.slice(1)} markets`}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === "bets" ? (
        <TooltipProvider>
          <div className="space-y-4">
            {/* SKELETON LOADING: Show bet card skeletons instead of generic text */}
            {loading ? (
              <BetCardSkeletonList count={5} />
            ) : !program || !publicKey ? (
              <WalletNotConnected
                title="My Bets"
                message="Connect your wallet to see your betting history."
              />
            ) : filteredBets.length === 0 ? (
              <div className="bg-[#f5f5f5] dark:bg-[#1a1a1a] border border-[#d3d3d3] dark:border-[#333] rounded shadow-sm p-12 text-center">
                <div className="text-6xl mb-4 opacity-20">:(</div>
                <div className="text-muted-foreground dark:text-gray-400 mb-4">no bets yet. go make some predictions!</div>
                <Button onClick={() => window.location.href = "/"} className="font-semibold">
                  Browse Markets
                </Button>
              </div>
            ) : (
              filteredBets.map(bet => <Tooltip key={bet.id}>
                <TooltipTrigger asChild>
                  <div
                    className="bg-[#f5f5f5] dark:bg-[#181818] border border-[#d3d3d3] dark:border-[#333] rounded-md shadow-sm p-4 sm:p-5 cursor-pointer hover:shadow-md transition-all relative group overflow-hidden"
                    onClick={() => navigate(`/market/${bet.marketPubkey}`)}
                  >
                    {/* Faint smiley watermark */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08] text-[80px] font-black text-gray-400 select-none">
                      : )
                    </div>

                    <div className="relative z-10">
                      {/* Status Badge */}
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-bold text-[#111] dark:text-white">Bet Details</span>
                        <MarketStatusBadge
                          state={bet.status === "active" ? "open" : bet.status === "won" ? "resolved" : "resolved"}
                          isVoid={false}
                          winnerOutcomeLabel={bet.status === "won" ? bet.prediction : undefined}
                        />
                      </div>

                      {/* Market Info */}
                      <div className="flex flex-col sm:flex-row items-start gap-4 mb-4">
                        {bet.imageUrl && (
                          <div className="flex-shrink-0 border border-[#d3d3d3] dark:border-[#333] rounded overflow-hidden w-full sm:w-20 h-32 sm:h-20 bg-[#f0f0f0] dark:bg-[#1f1f1f]">
                            <img src={bet.imageUrl} alt={bet.question} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-bold mb-2 leading-tight break-words text-foreground dark:text-white">{bet.question}</h3>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground dark:text-[#c7c7c7]">
                            <span className="font-semibold">{bet.category}</span>
                            <span>•</span>
                            <span className="font-mono">{bet.marketAddress}</span>
                            <span>•</span>
                            <span>{bet.createdAt}</span>
                          </div>
                        </div>
                      </div>

                      {/* Bet Stats */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded p-3 sm:p-4">
                        <div>
                          <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 tracking-wide">Prediction</div>
                          <div className={`font-bold ${bet.status === "won" ? "text-green-600" :
                            bet.status === "lost" ? "text-red-600" :
                              "text-[#111] dark:text-white"
                            }`}>
                            {bet.prediction} {bet.status === "won" ? ":)" : bet.status === "lost" ? ":(" : ":|"}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 tracking-wide">Bet Amount</div>
                          <div className="font-bold text-[#111] dark:text-white">{formatSol(bet.amount, 2)} SOL</div>
                        </div>

                        <div>
                          <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 tracking-wide">Odds</div>
                          <div className="font-bold text-[#111] dark:text-white">{bet.odds}x</div>
                        </div>

                        <div>
                          <div className="text-xs uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 tracking-wide">PNL</div>
                          <div
                            className={`font-bold ${bet.realized
                              ? Number(bet.pnlLamports) / LAMPORTS_PER_SOL > 0
                                ? "text-green-600"
                                : Number(bet.pnlLamports) / LAMPORTS_PER_SOL < 0
                                  ? "text-red-600"
                                  : "text-[#111]"
                              : "text-muted-foreground"
                              }`}
                          >
                            {bet.realized
                              ? `${formatSol(Number(bet.pnlLamports) / LAMPORTS_PER_SOL, 2)} SOL`
                              : "unrealized"}
                          </div>
                        </div>
                      </div>

                      {/* Solscan link */}
                      {bet.txSig && (
                        <div className="mt-3">
                          <a
                            href={getTxExplorerUrl(bet.txSig)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center text-xs font-medium underline text-[#666] dark:text-[#c7c7c7] hover:text-[#111] dark:hover:text-white transition-colors"
                          >
                            View on Solscan
                          </a>
                        </div>
                      )}

                      {/* Claim button */}
                      {bet.canClaim && (
                        <div className="mt-4">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClaim(bet);
                            }}
                            disabled={claiming.get(bet.id)}
                            className="w-full font-semibold"
                          >
                            {claiming.get(bet.id) ? "Claiming..." : "Claim Winnings"}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ArrowRight className="w-5 h-5 text-[#111]" />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Click to view market details</p>
                </TooltipContent>
              </Tooltip>)
            )}
          </div>
        </TooltipProvider>
      ) : (
        // Markets View
        <div className="space-y-4">
          {myMarketsLoading ? (
            <MarketCardSkeletonGrid count={6} />
          ) : !program || !publicKey ? (
            <WalletNotConnected
              title="My Markets"
              message="Connect your wallet to see your created markets."
            />
          ) : filteredMyMarkets.length === 0 ? (
            <div className="bg-[#f5f5f5] dark:bg-[#1a1a1a] border border-[#d3d3d3] dark:border-[#333] rounded shadow-sm p-12 text-center">
              <div className="text-6xl mb-4 opacity-20">:(</div>
              <div className="text-muted-foreground dark:text-gray-400 mb-4">
                No {marketFilter} markets yet. {marketFilter === "active" ? "Create your first market!" : ""}
              </div>
              <Button onClick={() => navigate("/create")} className="font-semibold">
                Create Market
              </Button>
            </div>
          ) : (
            filteredMyMarkets.map(market => {
              const canResolve = market.isLocked && !market.isResolved && !(market as any).isVoid;
              const isResolving = resolving.get(market.pubkey);

              return (
                <div key={market.pubkey} className={canResolve ? "grid grid-cols-1 lg:grid-cols-3 gap-4" : ""}>
                  <div className={canResolve ? "lg:col-span-2" : ""}>
                    <MarketCard
                      market={market}
                      disableNavigation={false}
                    />
                  </div>
                  {canResolve && (
                    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 relative overflow-hidden flex flex-col justify-center">
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[60px] font-black text-gray-400 select-none">
                        : )
                      </div>

                      <div className="relative z-10">
                        <h3 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-3 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">Resolve Market</h3>
                        <div className="text-[10px] font-bold text-[#999] mb-2 uppercase">Select winning outcome:</div>
                        <div className="flex flex-col gap-2">
                          {market.outcomes.slice(0, 5).map((outcome, i) => (
                            <Button
                              key={i}
                              variant="outline"
                              size="sm"
                              onClick={() => handleResolveMarket(market.pubkey, i)}
                              disabled={isResolving}
                              className="font-bold text-xs border-2 border-[#d3d3d3] dark:border-[#333] hover:border-[#111] dark:hover:border-white hover:bg-transparent w-full justify-start h-10"
                            >
                              {isResolving ? "Resolving..." : outcome.label}
                            </Button>
                          ))}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResolveMarket(market.pubkey, -2)}
                            disabled={isResolving}
                            className="font-bold text-xs border-2 border-red-200 dark:border-red-900/30 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 w-full justify-start h-10 mt-2"
                          >
                            {isResolving ? "Resolving..." : "Void Market (Refund All)"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </main>
  </div>;
};
export default MyBets;

import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAnchorProgram } from "@/solana/program";
import { fetchAllMarkets } from "@/solana/read";
import { useState, useEffect, useCallback } from "react";
import { MarketCard } from "@/components/MarketCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarketSearch } from "@/components/MarketSearch";
import { Search, Filter, Plus, ExternalLink, Loader2, Info, Twitter } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import type { UIMarket } from "@/solana/marketMapping";
import { BettingModal } from "@/components/BettingModal";
import { useWallet } from "@solana/wallet-adapter-react";
import { ShareMarketModal } from "@/components/ShareMarketModal";
import { TrendingStrip } from "@/components/TrendingStrip";
import { cn } from "@/lib/utils";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { MarketCardSkeletonGrid } from "@/components/skeletons/MarketCardSkeleton";
import { useQuery } from "@tanstack/react-query";
import { useLiveMarketUpdates } from "@/hooks/useLiveMarketUpdates";
import { queryKeys } from "@/lib/queryKeys";
import { formatSol } from "@/utils/format";
import { logPageView } from "@/lib/analytics";

const Index = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const wallet = useWallet();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [visibleCount, setVisibleCount] = useState(15);

  // Bet modal state
  const [betState, setBetState] = useState<{ market: UIMarket; answerIndex: number } | null>(null);
  const [shareMarket, setShareMarket] = useState<UIMarket | null>(null);

  // Helper functions for bet modal
  const handleOpenBet = (market: UIMarket, outcomeIndex: number) => {
    setBetState({ market, answerIndex: outcomeIndex });
  };

  const closeBetModal = () => {
    setBetState(null);
  };

  // REACT QUERY: Fetch markets with stale-while-revalidate
  // Shows cached data instantly, refetches in background
  const {
    data: markets = [],
    isLoading,
    isRefetching,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.markets.all,
    queryFn: async () => {
      if (!program) return [];
      console.log('[Index] Fetching markets...');
      return fetchAllMarkets(program, wallet.publicKey ?? null);
    },
    enabled: !!program,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  // REAL-TIME UPDATES: Subscribe to bet updates
  // Automatically invalidates cache when new bets are placed
  const { isConnected: isLiveConnected } = useLiveMarketUpdates(true);

  // MOBILE FEATURE: Pull-to-refresh for markets list
  // Triggers refetch when user pulls down on mobile
  const { isPulling, pullDistance, isRefreshing: isPullRefreshing } = usePullToRefresh(async () => {
    await refetch();
  });

  // Track page view
  useEffect(() => {
    logPageView('index');
  }, []);

  // MOBILE FEATURE: Swipe gestures for status filter navigation
  // Allows swiping left/right to change between All/Active/Closed filters on mobile
  const statusFilters = ["all", "active", "closed"];
  const currentFilterIndex = statusFilters.indexOf(statusFilter);

  useSwipeGesture(
    () => {
      // Swipe left - next filter
      const nextIndex = (currentFilterIndex + 1) % statusFilters.length;
      setStatusFilter(statusFilters[nextIndex]);
    },
    () => {
      // Swipe right - previous filter
      const prevIndex = (currentFilterIndex - 1 + statusFilters.length) % statusFilters.length;
      setStatusFilter(statusFilters[prevIndex]);
    }
  );

  // Filter and sort markets
  const filteredAndSortedMarkets = markets.filter(market => {
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      if (!market.displayQuestion.toLowerCase().includes(query) &&
        !market.creatorLabel.toLowerCase().includes(query) &&
        !market.pubkey.toLowerCase().includes(query)) {
        return false;
      }
    }

    // Filter by status
    if (statusFilter !== "all") {
      if (statusFilter === "active" && market.state !== "open") return false;
      if (statusFilter === "closed" && market.state === "open") return false;
    }

    // Special filter for "ending-soon": only show active markets
    if (sortBy === "ending-soon" && market.state !== "open") {
      return false;
    }

    return true;
  }).sort((a, b) => {
    switch (sortBy) {
      case "volume": {
        const aVol = a.volumeLamports ?? a.volume ?? 0;
        const bVol = b.volumeLamports ?? b.volume ?? 0;
        return bVol - aVol;
      }
      case "ending-soon":
        return a.closesAt.getTime() - b.closesAt.getTime();
      case "newest":
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });

  const visibleMarkets = filteredAndSortedMarkets.slice(0, visibleCount);

  return (
    <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#111] pb-24">
      <Header />

      {/* Live indicator */}
      {isLiveConnected && (
        <div className="fixed top-24 right-4 z-[60]">
          <div className="bg-green-600 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1 shadow-lg border border-white/20">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            Live
          </div>
        </div>
      )}

      {/* Pull-to-refresh indicator */}
      {(isPulling || isPullRefreshing) && (
        <div
          className={cn(
            "pull-to-refresh-indicator",
            !isPulling && !isPullRefreshing && "pull-to-refresh-indicator--hidden"
          )}
          style={{
            transform: `translateX(-50%) translateY(${Math.min(pullDistance, 80)}px)`,
          }}
        >
          <div className="bg-[#e8e8e8] dark:bg-[#2a2a2a] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded-full p-2 shadow-lg">
            <Loader2 className={cn("w-5 h-5 text-[#111] dark:text-white", isPullRefreshing && "animate-spin")} />
          </div>
        </div>
      )}

      {/* Refetching indicator */}
      {isRefetching && (
        <div className="fixed bottom-24 right-4 z-40 bg-blue-600 text-white text-xs px-3 py-2 rounded-full shadow-lg flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Updating...
        </div>
      )}

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-[1240px] space-y-4 sm:space-y-8" data-pull-to-refresh>
        {/* Header Section - Module Style */}
        <div className="relative bg-[#d4d4d4] dark:bg-[#222] border border-white/40 dark:border-[#3a3a3a] shadow-sm rounded-[6px] p-4 sm:p-6 overflow-hidden">
          {/* Subtle Gradient Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-transparent dark:from-white/5 pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div className="w-full md:w-auto">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-2 leading-none text-[#111] dark:text-white drop-shadow-sm break-words">
                markets
              </h1>
              <div className="flex flex-col gap-1.5">
                <p className="text-[#444] dark:text-[#d7d7d7] font-bold text-xs sm:text-sm tracking-wide">
                  the silliest outcome is always the most likely
                </p>
                <p className="text-[10px] sm:text-[11px] font-mono text-[#5f5f5f] dark:text-[#c7c7c7] uppercase tracking-wider font-semibold">
                  {markets.length} markets · {formatSol(markets.reduce((acc, m) => acc + (m.volumeLamports || 0), 0) / 1_000_000_000, 2)} SOL total volume
                </p>
              </div>
              {/* Section Bar - Wider & Stronger Green */}
              <div className="w-[80px] sm:w-[120px] h-[3px] sm:h-[4px] bg-[#15a349] mt-3 sm:mt-5 shadow-sm" />
            </div>

            {/* MOBILE: Touch target optimized - min 44px height */}
            <Button
              onClick={() => navigate("/create-market")}
              size="lg"
              className="w-full md:w-auto font-bold shadow-[2px_2px_0px_0px_#000] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000] active:translate-y-[2px] active:shadow-none transition-all bg-[#e8e8e8] dark:bg-[#2b2b2b] text-black dark:text-white border-2 border-[#8b8b8b] dark:border-[#3a3a3a] hover:bg-white dark:hover:bg-[#3a3a3a] win95-btn-press min-h-[44px] px-6 mb-0 md:mb-2 rounded-md sm:rounded"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Market
            </Button>
          </div>
        </div>

        {/* Trending Strip Panel - Darker & Card-like */}
        <div className="bg-[#d7d7d7] dark:bg-[#242424] rounded-[4px] border border-[#8b8b8b] dark:border-[#3a3a3a] p-2 shadow-inner overflow-x-auto">
          <TrendingStrip markets={markets.filter(m => m.state === 'open').sort((a, b) => b.volumeLamports - a.volumeLamports)} />
        </div>

        {/* Unified Search & Filters Bar - Solid Control Strip */}
        <div className="bg-[#e8e8e8] dark:bg-[#252525] p-2 sm:p-2 rounded-[2px] border border-[#8b8b8b] dark:border-[#3a3a3a] shadow-sm">
          <div className="flex flex-col md:flex-row gap-2 sm:gap-3 h-auto md:h-10">
            {/* Search Input */}
            <div className="relative w-full md:flex-[2] h-10 md:h-full group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5f5f5f] dark:text-[#c7c7c7] group-focus-within:text-black dark:group-focus-within:text-white transition-colors" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search markets..."
                className="pl-9 h-full bg-white dark:bg-[#1d1d1d] border-[#8b8b8b] dark:border-[#3a3a3a] focus-visible:ring-1 focus-visible:ring-[#15a349] font-bold text-[#111] dark:text-white rounded-[2px] placeholder:text-[#888] dark:placeholder:text-[#9a9a9a] text-sm"
              />
            </div>

            {/* Filters Group */}
            {/* MOBILE: Touch target optimized filters - min 44px height */}
            <div className="flex flex-row gap-2 w-full md:w-auto min-h-[44px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="flex-1 md:w-[160px] min-h-[44px] bg-white dark:bg-[#1f1f1f] border-[#8b8b8b] dark:border-[#3a3a3a] font-bold text-[#111] dark:text-white rounded-[2px] focus:ring-1 focus:ring-[#15a349] text-xs sm:text-sm px-2 sm:px-3"
                  aria-label="Filter markets by status"
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 overflow-hidden">
                    <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#5f5f5f] dark:text-[#c7c7c7] flex-shrink-0" />
                    <SelectValue placeholder="Status" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="closed">Closed / Resolved</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger
                  className="flex-1 md:w-[180px] min-h-[44px] bg-white dark:bg-[#1f1f1f] border-[#8b8b8b] dark:border-[#3a3a3a] font-bold text-[#111] dark:text-white rounded-[2px] focus:ring-1 focus:ring-[#15a349] text-xs sm:text-sm px-2 sm:px-3"
                  aria-label="Sort markets by"
                >
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="volume">Highest Volume</SelectItem>
                  <SelectItem value="ending-soon">Ending Soon</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Markets Grid - SKELETON LOADING: Show skeletons only on initial load, preserve data during refresh */}
        {isLoading ? (
          <MarketCardSkeletonGrid count={8} />
        ) : visibleMarkets.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {visibleMarkets.map((market) => (
                <MarketCard
                  key={market.pubkey}
                  market={market}
                  onOutcomeClick={(outcomeIndex) => handleOpenBet(market, outcomeIndex)}
                  onShare={(m) => setShareMarket(m)}
                />
              ))}
            </div>

            {visibleCount < filteredAndSortedMarkets.length && (
              <div className="mt-12 sm:mt-16 flex justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="min-w-[200px] w-full sm:w-auto font-bold border-2 hover:bg-primary/5 h-12 text-base dark:text-white dark:border-white/20 dark:hover:bg-white/10"
                >
                  Load More Markets
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-24 bg-muted/5 rounded-[4px] border border-dashed border-border/20">
            <h3 className="text-xl font-bold mb-2 opacity-80">No markets found</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              We couldn't find any markets matching your criteria. Try adjusting your filters or search terms.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
              }}
              className="font-bold"
            >
              Clear All Filters
            </Button>
          </div>
        )}
      </main>

      {/* Floating TOS button */}
      <button
        type="button"
        onClick={() => navigate("/terms-of-service")}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-[#e0e0e0] dark:bg-[#2a2a2a] border border-[#8a8a8a] dark:border-[#3a3a3a] shadow-[2px_2px_0px_0px_#000] px-3 py-2 text-xs font-bold text-[#111] dark:text-white hover:bg-white dark:hover:bg-[#3a3a3a] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000]"
        aria-label="View Terms of Service"
      >
        <Info className="w-4 h-4" />
        Terms
      </button>

      {/* Floating Twitter button */}
      <a
        href="https://x.com/sillymarketfun"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-16 right-4 z-50 flex items-center gap-2 rounded-full bg-[#e0e0e0] dark:bg-[#2a2a2a] border border-[#8a8a8a] dark:border-[#3a3a3a] shadow-[2px_2px_0px_0px_#000] px-3 py-2 text-xs font-bold text-[#111] dark:text-white hover:bg-white dark:hover:bg-[#3a3a3a] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000]"
        aria-label="Follow us on Twitter"
      >
        <Twitter className="w-4 h-4" />
        Twitter
      </a>

      {/* Modals */}
      {betState && (
        <BettingModal
          open={!!betState}
          onOpenChange={(open) => {
            if (!open) closeBetModal();
          }}
          market={betState.market}
          initialAnswerIndex={betState.answerIndex}
        />
      )}

      {shareMarket && (
        <ShareMarketModal
          open={!!shareMarket}
          onOpenChange={(open) => {
            if (!open) setShareMarket(null);
          }}
          market={shareMarket}
        />
      )}
    </div>
  );
};

export default Index;

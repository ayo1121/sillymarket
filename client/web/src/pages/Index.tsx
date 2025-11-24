import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAnchorProgram } from "@/solana/program";
import { fetchAllMarkets } from "@/solana/read";
import { useState, useEffect } from "react";
import { MarketCard } from "@/components/MarketCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarketSearch } from "@/components/MarketSearch";
import { Search, Filter, Plus, ExternalLink, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import type { UIMarket } from "@/solana/marketMapping";
import { BettingModal } from "@/components/BettingModal";
import { useWallet } from "@solana/wallet-adapter-react";
import { ShareMarketModal } from "@/components/ShareMarketModal";
import { TrendingStrip } from "@/components/TrendingStrip";
import { cn } from "@/lib/utils";

const Index = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const wallet = useWallet();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [markets, setMarkets] = useState<UIMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(15);

  // Bet modal state
  const [betState, setBetState] = useState<{ market: UIMarket; answerIndex: number } | null>(null);
  const [shareMarket, setShareMarket] = useState<UIMarket | null>(null);

  const openBetModal = (market: UIMarket, answerIndex: number) => {
    setBetState({ market, answerIndex });
  };

  const closeBetModal = () => {
    setBetState(null);
  };

  const handleOpenBet = (market: UIMarket, outcomeIndex: number) => {
    setBetState({ market, answerIndex: outcomeIndex });
  };

  // Fetch real markets from blockchain
  useEffect(() => {
    (async () => {
      if (!program) {
        setMarkets([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // fetchAllMarkets now returns UIMarket[] directly
        const uiMarkets = await fetchAllMarkets(program, wallet.publicKey ?? null);
        setMarkets(uiMarkets);
        setVisibleCount(15);
      } catch (e: any) {
        console.error("Error fetching markets:", e);
        setError(e?.message || String(e));
        setMarkets([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [program, wallet.publicKey]);

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
    <div className="min-h-screen bg-background font-sans text-foreground">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-[1240px]">
        {/* Header Section - Module Style */}
        <div className="relative bg-[#d4d4d4] border border-white/40 shadow-sm rounded-[4px] p-6 mb-8 overflow-hidden">
          {/* Subtle Gradient Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/5 to-transparent pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div>
              <h1 className="text-5xl font-black uppercase tracking-tighter mb-2 leading-none text-[#111] drop-shadow-sm">Markets</h1>
              <div className="flex flex-col gap-1.5">
                <p className="text-[#444] font-bold text-sm tracking-wide">
                  the silliest outcome is always the most likely
                </p>
                <p className="text-[11px] font-mono text-[#5f5f5f] uppercase tracking-wider font-semibold">
                  {markets.length} markets · {(markets.reduce((acc, m) => acc + (m.volumeLamports || 0), 0) / 1_000_000_000).toFixed(1)} SOL total volume
                </p>
              </div>
              {/* Section Bar - Wider & Stronger Green */}
              <div className="w-[120px] h-[4px] bg-[#15a349] mt-5 shadow-sm" />
            </div>

            <Button
              onClick={() => navigate("/create-market")}
              size="lg"
              className="font-bold shadow-[2px_2px_0px_0px_#000] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000] active:translate-y-[2px] active:shadow-none transition-all bg-[#e8e8e8] text-black border-2 border-[#8b8b8b] hover:bg-white win95-btn-press h-10 px-6 mb-2"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Market
            </Button>
          </div>
        </div>

        {/* Trending Strip Panel - Darker & Card-like */}
        <div className="mb-8 bg-[#d7d7d7] rounded-[4px] border border-[#8b8b8b] p-2 shadow-inner">
          <TrendingStrip markets={markets.filter(m => m.state === 'open').sort((a, b) => b.volumeLamports - a.volumeLamports)} />
        </div>

        {/* Unified Search & Filters Bar - Solid Control Strip */}
        <div className="bg-[#e8e8e8] p-2 mb-8 rounded-[2px] border border-[#8b8b8b] shadow-sm">
          <div className="flex flex-col md:flex-row gap-3 h-auto md:h-10">
            {/* Search Input */}
            <div className="relative flex-[2] h-10 md:h-full group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5f5f5f] group-focus-within:text-black transition-colors" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search markets..."
                className="pl-9 h-full bg-white border-[#8b8b8b] focus-visible:ring-1 focus-visible:ring-[#15a349] font-bold text-[#111] rounded-[2px] placeholder:text-[#888]"
              />
            </div>

            {/* Filters Group */}
            <div className="flex gap-3 w-full md:w-auto h-10 md:h-full">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[160px] h-full bg-white border-[#8b8b8b] font-bold text-[#111] rounded-[2px] focus:ring-1 focus:ring-[#15a349]">
                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-[#5f5f5f]" />
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
                <SelectTrigger className="w-full md:w-[180px] h-full bg-white border-[#8b8b8b] font-bold text-[#111] rounded-[2px] focus:ring-1 focus:ring-[#15a349]">
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

        {/* Markets Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-[340px] bg-muted/5 rounded-[4px] animate-pulse border border-border/10" />
            ))}
          </div>
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
              <div className="mt-16 flex justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="min-w-[200px] font-bold border-2 hover:bg-primary/5 h-12 text-base"
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
          isOpen={!!shareMarket}
          onClose={() => setShareMarket(null)}
          market={shareMarket}
        />
      )}
    </div>
  );
};

export default Index;

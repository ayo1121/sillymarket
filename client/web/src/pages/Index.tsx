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

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter mb-2">Markets</h1>
            <p className="text-muted-foreground font-medium">
              Predict outcomes, trade positions, and earn rewards.
            </p>
          </div>

          <Button
            onClick={() => navigate("/create-market")}
            size="lg"
            className="font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create Market
          </Button>
        </div>

        {/* Trending Strip */}
        <TrendingStrip markets={markets.filter(m => m.state === 'open').sort((a, b) => b.volumeLamports - a.volumeLamports)} />

        {/* Search & Filters */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-8 mt-8">
          {/* Search */}
          <div className="md:col-span-5 lg:col-span-6">
            <MarketSearch
              markets={markets}
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>

          {/* Filters */}
          <div className="md:col-span-7 lg:col-span-6 flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full win95-sunken bg-background font-bold">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    <SelectValue placeholder="Status" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="closed">Closed / Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full win95-sunken bg-background font-bold">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-[320px] bg-muted/10 rounded-md animate-pulse border border-border/30" />
            ))}
          </div>
        ) : visibleMarkets.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
              <div className="mt-12 flex justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="min-w-[200px] font-bold border-2 hover:bg-primary/5"
                >
                  Load More
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 bg-muted/10 rounded-lg border-2 border-dashed border-border/50">
            <h3 className="text-xl font-bold mb-2">No markets found</h3>
            <p className="text-muted-foreground mb-6">Try adjusting your search or filters</p>
            <Button onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}>
              Clear Filters
            </Button>
          </div>
        )}
      </main>

      {/* Modals */}
      {betState && (
        <BettingModal
          isOpen={!!betState}
          onClose={closeBetModal}
          market={betState.market}
          selectedOutcomeIndex={betState.answerIndex}
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

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

      <main className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Top Chrome Divider */}
        <div className="w-full h-px bg-border/20 mb-6" />

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
          <div>
            <h1 className="text-5xl font-black uppercase tracking-tighter mb-1 leading-none">Markets</h1>
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground font-medium text-sm tracking-wide">
                predict outcomes, trade positions, and earn rewards.
              </p>
              <p className="text-[11px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                {markets.length} markets · {(markets.reduce((acc, m) => acc + (m.volumeLamports || 0), 0) / 1_000_000_000).toFixed(1)} SOL total volume
              </p>
            </div>
          </div>

          <Button
            onClick={() => navigate("/create-market")}
            size="lg"
            className="font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all bg-primary text-primary-foreground border-2 border-primary win95-btn-press h-10 px-6"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Market
          </Button>
        </div>

        {/* Trending Strip Panel */}
        <div className="mb-8 bg-black/5 rounded-[4px] border border-black/5 p-1">
          <TrendingStrip markets={markets.filter(m => m.state === 'open').sort((a, b) => b.volumeLamports - a.volumeLamports)} />
        </div>

        {/* Unified Search & Filters Bar */}
        <div className="win95-sunken bg-background/50 p-1.5 mb-8 rounded-[4px] border border-border/40">
          <div className="flex flex-col md:flex-row gap-2">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search markets..."
                className="pl-9 h-10 bg-background border-border/20 focus-visible:ring-1 focus-visible:ring-primary/20 font-medium"
              />
            </div>

            {/* Filters Group */}
            <div className="flex gap-2 w-full md:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-10 bg-background border-border/20 font-bold">
                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 opacity-60" />
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
                <SelectTrigger className="w-[160px] h-10 bg-background border-border/20 font-bold">
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

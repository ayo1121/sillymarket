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
import { Filter, Plus, ExternalLink } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import type { UIMarket } from "@/solana/marketMapping";
import { BettingModal } from "@/components/BettingModal";
import { useWallet } from "@solana/wallet-adapter-react";
import { ShareMarketModal } from "@/components/ShareMarketModal";

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

  const marketsToRender = filteredAndSortedMarkets.slice(0, visibleCount);

  useNotifications(markets);

  return (
    <div className="min-h-screen bg-win95-teal">
      <div className="w-full px-2 sm:px-4 pt-4 sm:pt-8">
        <Header />
      </div>
      <div className="w-full px-2 sm:px-4 mb-4 sm:mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {/* Search and Filters - Left Column */}
          <div className="md:col-span-2">
            <div className="win95-window bg-background p-1 h-full">
              <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                <span className="font-black text-xs tracking-tight sm:text-base">search & filters</span>
              </div>
              <div className="win95-sunken bg-background p-3 sm:p-4 space-y-3 sm:space-y-4 h-[calc(100%-3rem)]">
                {/* Search Bar */}
                <MarketSearch
                  markets={markets}
                  value={searchQuery}
                  onChange={setSearchQuery}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-black mb-2 block">status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="win95-sunken bg-background font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border-2 border-foreground z-50">
                        <SelectItem value="all" className="font-bold">all markets</SelectItem>
                        <SelectItem value="active" className="font-bold">active</SelectItem>
                        <SelectItem value="closed" className="font-bold">closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-black mb-2 block">sort by</label>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="win95-sunken bg-background font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border-2 border-foreground z-50">
                        <SelectItem value="newest" className="font-bold">newest first</SelectItem>
                        <SelectItem value="ending-soon" className="font-bold">ending soon</SelectItem>
                        <SelectItem value="volume" className="font-bold">highest volume</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Create Market - Right Column */}
          <div className="md:col-span-1">
            <div className="win95-window bg-background p-1 h-full">
              <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1 flex items-center gap-2">
                <span className="text-lg sm:text-xl font-black">:)</span>
                <span className="font-black text-xs tracking-tight sm:text-base">create your own market</span>
              </div>
              <div className="win95-sunken bg-background p-4 sm:p-8 text-center space-y-3 sm:space-y-4 h-[calc(100%-3rem)] flex flex-col justify-center items-center">
                <p className="text-sm sm:text-base font-bold">turn your intrusive thoughts into markets.</p>
                <Button variant="default" size="lg" className="font-black text-sm sm:text-base px-6 sm:px-8 w-full" onClick={() => navigate("/create-market")}>
                  + new market
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="w-full px-2 sm:px-4 pb-8 sm:pb-16">


        {loading && (
          <div className="win95-window bg-background p-1">
            <div className="win95-sunken bg-background p-4 sm:p-8 text-center">
              <p className="text-base sm:text-lg font-bold">Loading markets from blockchain...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="win95-window bg-background p-1">
            <div className="win95-sunken bg-background p-4 sm:p-8 text-center">
              <p className="text-base sm:text-lg font-bold text-red-600">Error loading markets: {error}</p>
              <p className="text-sm text-muted-foreground mt-2">
                Make sure your wallet is connected to <strong>Solana Devnet</strong> and try again
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {marketsToRender.length > 0 ? (
            marketsToRender.map((market) => (
              <div key={market.pubkey} className="cursor-pointer h-full">
                <MarketCard
                  market={market}
                  onOutcomeClick={(outcomeIndex) => handleOpenBet(market, outcomeIndex)}
                  onShare={(mkt) => setShareMarket(mkt)}
                  className="h-full"
                />
              </div>
            ))
          ) : !loading && !error ? (
            <div className="col-span-full win95-window bg-background p-1">
              <div className="win95-sunken bg-background p-4 sm:p-8 text-center">
                <p className="text-base sm:text-lg font-bold text-muted-foreground">
                  {searchQuery || statusFilter !== "all"
                    ? "no markets found matching your filters"
                    : "no markets found. create one to get started!"}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {filteredAndSortedMarkets.length > visibleCount && (
          <div className="flex justify-center mt-6">
            <Button
              variant="outline"
              className="font-black px-6"
              onClick={() => setVisibleCount((prev) => prev + 15)}
            >
              load more
            </Button>
          </div>
        )}
      </div>
      <div className="max-w-5xl mx-auto px-2 sm:px-4 pb-8 sm:pb-16">

        <div className="win95-window bg-background p-1 mt-6 sm:mt-8">
          <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
            <span className="font-black text-xs tracking-tight sm:text-base">about</span>
          </div>
          <div className="win95-sunken bg-background p-4 sm:p-6">
            <div className="space-y-3 sm:space-y-4">
              <p className="text-base leading-relaxed font-bold sm:text-xl">
                <span className="text-2xl sm:text-3xl mr-2 sm:mr-3 font-black"></span>
                place your bets on any silly outcome. winners take all.
              </p>
              <div className="flex flex-wrap gap-3 sm:gap-6 text-xs sm:text-sm">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="win95-sunken px-2 sm:px-3 py-1 sm:py-2 bg-input font-black text-xs">✓</span>
                  <span className="font-bold">100% on-chain</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="win95-sunken px-2 sm:px-3 py-1 sm:py-2 bg-input font-black text-xs">✓</span>
                  <span className="font-bold">no house edge</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="win95-sunken px-2 sm:px-3 py-1 sm:py-2 bg-input font-black text-xs">✓</span>
                  <span className="font-bold">instant payouts on resolution</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-8 sm:mt-12 text-center">
          <div className="win95-sunken bg-background p-3 sm:p-4 inline-block">
            <p className="text-sm font-black tracking-tight">:) sillymarket </p>
            <p className="text-xs text-muted-foreground mt-1 sm:mt-2 font-bold">silly bets, silly outcomes</p>
          </div>
        </footer>

        {/* Single bet modal at page level */}
        <BettingModal
          open={betState !== null}
          onOpenChange={(open) => {
            if (!open) closeBetModal();
          }}
          market={betState?.market ?? null}
          initialAnswerIndex={betState?.answerIndex ?? 0}
          onBetPlaced={() => {
            // Index view doesn't maintain its own chart/activity for now.
          }}
        />
        {shareMarket && (
          <ShareMarketModal
            open={Boolean(shareMarket)}
            onOpenChange={(open) => {
              if (!open) setShareMarket(null);
            }}
            market={shareMarket}
          />
        )}
      </div>
    </div>
  );
};

export default Index;

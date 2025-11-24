import { useMemo, useState, useEffect } from "react";

import { useNavigate } from "react-router-dom";
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
import { useMarketsCtx, getBetStatus, computePnL, BetStatus, isPositionClaimable } from "@/hooks/marketsContext";
import { formatSol, shortenWallet } from "@/utils/format";
import { MarketCard } from "@/components/MarketCard";
import { resolveMarket } from "@/solana/actions";
import { fetchConfig } from "@/solana/read";

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
}

const MyBets = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const { publicKey } = useWallet();
  const { markets, loading: marketsLoading, positions, positionsLoading, refreshPositions } = useMarketsCtx();
  const [statusFilter, setStatusFilter] = useState<"active" | "won" | "lost">("active");
  const [claiming, setClaiming] = useState<Map<string, boolean>>(new Map());
  const [claimingAll, setClaimingAll] = useState(false);
  const [viewMode, setViewMode] = useState<"bets" | "markets">("bets");
  const [marketFilter, setMarketFilter] = useState<"active" | "resolved">("active");
  const [resolving, setResolving] = useState<Map<string, boolean>>(new Map());
  const [config, setConfig] = useState<any>(null);

  // Fetch config on mount
  useEffect(() => {
    if (program) {
      fetchConfig(program as any).then(setConfig).catch(console.error);
    }
  }, [program]);

  const marketMap = useMemo(() => {
    const map = new Map<string, any>();
    markets.forEach((m) => map.set(m.pubkey, m));
    return map;
  }, [markets]);

  const betsView: BetView[] = useMemo(() => {
    if (!publicKey) return [];
    return positions
      .map((pos: any) => {
        const marketPk = pos.account.market?.toBase58?.() || pos.account.market?.toString?.();
        const market = marketMap.get(marketPk);
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
        };
      })
      .filter((bet): bet is BetView => bet !== null);
  }, [positions, marketMap, publicKey]);

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
      toast.success(`Winnings claimed! Transaction: ${sig.slice(0, 8)}...`);
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

  // Filter markets created by connected wallet
  const myMarkets = useMemo(() => {
    if (!publicKey) return [];
    const creatorPubkey = publicKey.toBase58();

    return markets
      .filter(market => market.creatorPubkey === creatorPubkey)
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
  }, [markets, publicKey, marketFilter]);

  // Calculate market stats
  const marketStats = useMemo(() => {
    if (!publicKey) return { totalVolume: 0, feesCollected: 0 };

    const creatorPubkey = publicKey.toBase58();
    const creatorMarkets = markets.filter(m => m.creatorPubkey === creatorPubkey);

    const totalVolumeLamports = creatorMarkets.reduce((sum, market) => {
      const vol = Number(market.volumeLamports || market.rawAccount?.totalPool || 0);
      return sum + vol;
    }, 0);

    const feesCollectedLamports = creatorMarkets.reduce((sum, market) => {
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
  }, [markets, publicKey]);

  const handleResolveMarket = async (marketPubkey: string, winnerIndex: number) => {
    if (!program || !publicKey || resolving.get(marketPubkey)) return;

    const market = markets.find(m => m.pubkey === marketPubkey);
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
      toast.success(`Market resolved! Transaction: ${sig.slice(0, 8)}...`);
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

  return <div className="min-h-screen bg-win95-teal">
    <Header />

    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-6 mb-8 relative overflow-hidden">
        {/* Faint smiley watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] text-[120px] font-black text-gray-400 select-none">
          : )
        </div>

        <div className="relative z-10">
          {/* Header with toggle */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl md:text-4xl font-black">
              {viewMode === "bets" ? "my bets :)" : "my markets :)"}
            </h1>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setViewMode(viewMode === "bets" ? "markets" : "bets")}
              className="font-semibold border-[#8b8b8b] hover:bg-[#e8e8e8]"
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
                <div className="bg-white border border-[#e0e0e0] rounded-md p-5 shadow-sm">
                  <div className="text-xs uppercase text-[#666] font-semibold mb-2 tracking-wide">Total Bet</div>
                  <div className="text-2xl font-bold text-[#111]">{formatSol(totalBet, 2)} SOL</div>
                </div>
                <div className="bg-white border border-[#e0e0e0] rounded-md p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase text-[#666] font-semibold tracking-wide">Realized PnL</div>
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

              {/* Tabs */}
              <div className="flex flex-wrap gap-3 mb-6">
                {(["active", "won", "lost"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-4 py-2 rounded text-sm font-semibold transition-all ${statusFilter === status
                      ? "bg-[#111] text-white shadow-sm"
                      : "bg-[#e8e8e8] text-[#111] hover:bg-[#d8d8d8] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
                      }`}
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
                <div className="bg-white border border-[#e0e0e0] rounded-md p-5 shadow-sm">
                  <div className="text-xs uppercase text-[#666] font-semibold mb-2 tracking-wide">Total Volume</div>
                  <div className="text-2xl font-bold text-[#111]">{formatSol(marketStats.totalVolume, 2)} SOL</div>
                </div>
                <div className="bg-white border border-[#e0e0e0] rounded-md p-5 shadow-sm">
                  <div className="text-xs uppercase text-[#666] font-semibold mb-2 tracking-wide">Fees Collected</div>
                  <div className="text-2xl font-bold text-green-600">{formatSol(marketStats.feesCollected, 2)} SOL</div>
                </div>
              </div>

              {/* Market Tabs */}
              <div className="flex flex-wrap gap-3 mb-6">
                {(["active", "resolved"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setMarketFilter(filter)}
                    className={`px-4 py-2 rounded text-sm font-semibold transition-all ${marketFilter === filter
                      ? "bg-[#111] text-white shadow-sm"
                      : "bg-[#e8e8e8] text-[#111] hover:bg-[#d8d8d8] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
                      }`}
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
            {loading ? (
              <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-12 text-center">
                <div className="text-muted-foreground">Loading your bets...</div>
              </div>
            ) : !program || !publicKey ? (
              <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-12 text-center">
                <div className="text-6xl mb-4 opacity-20">:(</div>
                <div className="text-muted-foreground">
                  {!publicKey ? "Connect your wallet to see your bets" : "Program is loading..."}
                </div>
              </div>
            ) : filteredBets.length === 0 ? (
              <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-12 text-center">
                <div className="text-6xl mb-4 opacity-20">:(</div>
                <div className="text-muted-foreground mb-4">no bets yet. go make some predictions!</div>
                <Button onClick={() => window.location.href = "/"} className="font-semibold">
                  Browse Markets
                </Button>
              </div>
            ) : (
              filteredBets.map(bet => <Tooltip key={bet.id}>
                <TooltipTrigger asChild>
                  <div
                    className="bg-[#f5f5f5] border border-[#d3d3d3] rounded-md shadow-sm p-5 cursor-pointer hover:shadow-md transition-all relative group overflow-hidden"
                    onClick={() => navigate(`/market/${bet.marketPubkey}`)}
                  >
                    {/* Faint smiley watermark */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] text-[80px] font-black text-gray-400 select-none">
                      : )
                    </div>

                    <div className="relative z-10">
                      {/* Status Badge */}
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-bold text-[#111]">Bet Details</span>
                        <span className={`text-xs px-3 py-1 rounded font-semibold ${bet.status === "active" ? "bg-[#e8e8e8] text-[#111]" :
                          bet.status === "won" ? "bg-green-100 text-green-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                          {bet.status === "active" ? "Open" : bet.status === "won" ? "Won" : "Lost"}
                        </span>
                      </div>

                      {/* Market Info */}
                      <div className="flex flex-col sm:flex-row items-start gap-4 mb-4">
                        {bet.imageUrl && (
                          <div className="flex-shrink-0 border border-[#d3d3d3] rounded overflow-hidden w-full sm:w-20 h-32 sm:h-20">
                            <img src={bet.imageUrl} alt={bet.question} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-bold mb-2 leading-tight break-words">{bet.question}</h3>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-semibold">{bet.category}</span>
                            <span>•</span>
                            <span className="font-mono">{bet.marketAddress}</span>
                            <span>•</span>
                            <span>{bet.createdAt}</span>
                          </div>
                        </div>
                      </div>

                      {/* Bet Stats */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white border border-[#e0e0e0] rounded p-4">
                        <div>
                          <div className="text-xs uppercase text-[#666] font-semibold mb-1 tracking-wide">Prediction</div>
                          <div className={`font-bold ${bet.status === "won" ? "text-green-600" :
                            bet.status === "lost" ? "text-red-600" :
                              "text-[#111]"
                            }`}>
                            {bet.prediction} {bet.status === "won" ? ":)" : bet.status === "lost" ? ":(" : ":|"}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs uppercase text-[#666] font-semibold mb-1 tracking-wide">Bet Amount</div>
                          <div className="font-bold text-[#111]">{formatSol(bet.amount, 2)} SOL</div>
                        </div>

                        <div>
                          <div className="text-xs uppercase text-[#666] font-semibold mb-1 tracking-wide">Odds</div>
                          <div className="font-bold text-[#111]">{bet.odds}x</div>
                        </div>

                        <div>
                          <div className="text-xs uppercase text-[#666] font-semibold mb-1 tracking-wide">PNL</div>
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
          {loading ? (
            <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-12 text-center">
              <div className="text-muted-foreground">Loading your markets...</div>
            </div>
          ) : !program || !publicKey ? (
            <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-12 text-center">
              <div className="text-6xl mb-4 opacity-20">:(</div>
              <div className="text-muted-foreground">
                {!publicKey ? "Connect your wallet to see your markets" : "Program is loading..."}
              </div>
            </div>
          ) : myMarkets.length === 0 ? (
            <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-12 text-center">
              <div className="text-6xl mb-4 opacity-20">:(</div>
              <div className="text-muted-foreground mb-4">
                No {marketFilter} markets yet. {marketFilter === "active" ? "Create your first market!" : ""}
              </div>
              <Button onClick={() => navigate("/create")} className="font-semibold">
                Create Market
              </Button>
            </div>
          ) : (
            myMarkets.map(market => {
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
                    <div className="bg-[#f5f5f5] border border-[#d3d3d3] rounded shadow-sm p-4 relative overflow-hidden flex flex-col justify-center">
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] text-[60px] font-black text-gray-400 select-none">
                        : )
                      </div>

                      <div className="relative z-10">
                        <h3 className="text-xs uppercase font-bold tracking-wide text-[#666] mb-2">Resolve Market</h3>
                        <div className="text-[10px] text-muted-foreground mb-2">Select outcome:</div>
                        <div className="flex flex-col gap-2">
                          {market.outcomes.slice(0, 5).map((outcome, i) => (
                            <Button
                              key={i}
                              variant="outline"
                              size="sm"
                              onClick={() => handleResolveMarket(market.pubkey, i)}
                              disabled={isResolving}
                              className="font-semibold text-xs border-[#8b8b8b] hover:bg-[#e8e8e8] w-full justify-start h-8"
                            >
                              {isResolving ? "Resolving..." : outcome.label}
                            </Button>
                          ))}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResolveMarket(market.pubkey, -2)}
                            disabled={isResolving}
                            className="font-semibold text-xs border-[#8b8b8b] hover:bg-[#e8e8e8] w-full justify-start h-8"
                          >
                            {isResolving ? "Resolving..." : "Void"}
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

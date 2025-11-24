import { useMemo, useState } from "react";

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
          0;

        return {
          id: pos.publicKey.toBase58(),
          question: market.displayQuestion || market.question || "Unknown question",
          prediction: outcomeName,
          amount: stakeSol,
          odds: odds.toFixed(2),
          pnlLamports,
          payoutLamports,
          status,
          realized: pnlResult.realized,
          stakeLamports,
          createdAt: createdTs
            ? formatDistanceToNow(new Date(createdTs * 1000), { addSuffix: true })
            : "",
          imageUrl: market.imageUrl || undefined,
          category: "market",
          marketAddress: shortenWallet(market.pubkey, 6, 4),
          creatorAddress: market.creatorPubkey ? shortenWallet(market.creatorPubkey, 6, 4) : "unknown",
          marketPubkey: market.pubkey,
          position: pos.account,
          canClaim,
        } as BetView;
      })
      .filter((b): b is BetView => b !== null);
  }, [positions, marketMap, publicKey]);

  const filteredBets = useMemo(() => {
    return betsView.filter((bet) => {
      switch (statusFilter) {
        case "active":
          return bet.status === "active";
        case "won":
          return bet.status === "won";
        case "lost":
          return bet.status === "lost";
      }
    });
  }, [betsView, statusFilter]);

  const totalBetLamports = betsView.reduce((sum, bet) => sum + bet.stakeLamports, 0n);
  const realizedPnlLamports = betsView
    .filter((bet) => bet.realized)
    .reduce((sum, bet) => sum + bet.pnlLamports, 0n);
  const totalBet = Number(totalBetLamports) / LAMPORTS_PER_SOL;
  const realizedPnl = Number(realizedPnlLamports) / LAMPORTS_PER_SOL;

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

  const loading = marketsLoading || positionsLoading;

  return <div className="min-h-screen bg-win95-teal">
    <Header />

    <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
      <div className="bg-background win95-raised p-1 sm:p-2 mb-4 sm:mb-8 max-w-4xl mx-auto">
        <div className="bg-primary px-2 py-1 flex items-center justify-between">
          <span className="text-xs text-slate-50 font-bold sm:text-base">mybets.exe</span>
          <div className="flex gap-1">
            <div className="w-3 h-3 sm:w-4 sm:h-4 bg-background win95-raised"></div>
            <div className="w-3 h-3 sm:w-4 sm:h-4 bg-background win95-raised"></div>
            <div className="w-3 h-3 sm:w-4 sm:h-4 bg-background win95-raised"></div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <h1 className="text-2xl sm:text-4xl font-bold mb-4 sm:mb-6">my bets :)</h1>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="bg-background win95-sunken p-3 sm:p-4">
              <div className="text-xs sm:text-sm text-muted-foreground mb-1">total bet</div>
              <div className="text-xl sm:text-2xl font-bold">{formatSol(totalBet, 2)} sol</div>
            </div>
            <div className="bg-background win95-sunken p-3 sm:p-4">
              <div className="text-xs sm:text-sm text-muted-foreground mb-1">realized pnl</div>
              <div className={`text-xl sm:text-2xl font-bold ${realizedPnl > 0 ? "text-brand-yes" : realizedPnl < 0 ? "text-brand-no" : ""}`}>
                {formatSol(realizedPnl, 2)} sol
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4 sm:mb-6">
            {(["active", "won", "lost"] as const).map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "primary" : "outline"}
                size="sm"
                className="font-bold text-xs sm:text-sm"
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </Button>
            ))}
          </div>

          {/* Bets List */}
          <TooltipProvider>
            <div className="space-y-3 sm:space-y-4">
              {loading ? (
                <div className="bg-background win95-sunken p-8 text-center">
                  <div className="text-muted-foreground">Loading your bets...</div>
                </div>
              ) : !program || !publicKey ? (
                <div className="bg-background win95-sunken p-8 text-center">
                  <div className="text-6xl mb-4">:(</div>
                  <div className="text-muted-foreground">
                    {!publicKey ? "Connect your wallet to see your bets" : "Program is loading..."}
                  </div>
                </div>
              ) : filteredBets.length === 0 ? (
                <div className="bg-background win95-sunken p-8 text-center">
                  <div className="text-6xl mb-4">:(</div>
                  <div className="text-muted-foreground">no bets yet. go make some predictions!</div>
                  <Button className="mt-4" onClick={() => window.location.href = "/"}>
                    browse markets
                  </Button>
                </div>
              ) : (
                filteredBets.map(bet => <Tooltip key={bet.id}>
                  <TooltipTrigger asChild>
                    <div
                      className="bg-background win95-raised p-1 sm:p-2 cursor-pointer hover:opacity-80 transition-opacity relative group"
                      onClick={() => navigate(`/market/${bet.marketPubkey}`)}
                    >
                      <div className="bg-primary/10 px-2 py-1 mb-2 flex items-center justify-between">
                        <span className="font-bold text-xs sm:text-sm">Bet Details</span>
                        <span className={`text-xs px-2 py-1 win95-sunken ${bet.status === "active" ? "bg-background" :
                            bet.status === "won" ? "bg-brand-yes/20" :
                              "bg-brand-no/20"
                          }`}>
                          {bet.status === "active" ? "Open" : bet.status === "won" ? "Won" : "Lost"}
                        </span>
                      </div>

                      <div className="p-3 sm:p-4">
                        <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
                          {bet.imageUrl && <div className="win95-sunken p-2 bg-input flex-shrink-0 w-full sm:w-auto" style={{
                            borderColor: 'hsl(var(--primary))'
                          }}>
                            <img src={bet.imageUrl} alt={bet.question} className="w-full h-32 sm:w-20 sm:h-20 object-cover" />
                          </div>}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base sm:text-lg font-black mb-2 leading-tight break-words">{bet.question}</h3>
                            <div className="space-y-1 text-xs sm:text-sm">
                              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                                <span className="font-bold">{bet.category}</span>
                                <span className="hidden sm:inline">•</span>
                                <span className="font-mono text-xs truncate">{bet.marketAddress}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                                <span className="font-mono truncate">{bet.creatorAddress}</span>
                                <span className="hidden sm:inline">•</span>
                                <span className="font-bold">{bet.createdAt}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 text-xs sm:text-sm win95-sunken bg-input p-2 sm:p-3">
                          <div>
                            <div className="text-muted-foreground mb-1 text-xs font-bold">prediction</div>
                            <div className={`font-black ${bet.prediction === "yes" ? "text-brand-yes" : "text-brand-no"}`}>
                              {bet.prediction} {bet.status === "won" ? ":)" : bet.status === "lost" ? ":(" : ":|"}
                            </div>
                          </div>

                          <div>
                            <div className="text-muted-foreground mb-1 text-xs font-bold">bet amount</div>
                            <div className="font-black">{formatSol(bet.amount, 2)} sol</div>
                          </div>

                          <div>
                            <div className="text-muted-foreground mb-1 text-xs font-bold">odds</div>
                            <div className="font-black">{bet.odds}x</div>
                          </div>

                          <div>
                            <div className="text-muted-foreground mb-1 text-xs font-bold">PNL</div>
                            <div
                              className={`font-black ${bet.realized
                                  ? Number(bet.pnlLamports) / LAMPORTS_PER_SOL > 0
                                    ? "text-brand-yes"
                                    : Number(bet.pnlLamports) / LAMPORTS_PER_SOL < 0
                                      ? "text-brand-no"
                                      : ""
                                  : "text-muted-foreground"
                                }`}
                            >
                              {bet.realized
                                ? `${formatSol(Number(bet.pnlLamports) / LAMPORTS_PER_SOL, 2)} sol`
                                : "unrealized"}
                            </div>
                          </div>
                        </div>

                        {/* Claim button for resolved markets with claimable positions */}
                        {bet.canClaim && (
                          <div className="mt-3">
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClaim(bet);
                              }}
                              disabled={claiming.get(bet.id)}
                              className="w-full text-xs"
                            >
                              {claiming.get(bet.id) ? "Claiming..." : "Claim Winnings"}
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="w-5 h-5 text-primary" />
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
        </div>
      </div>
    </main>
  </div>;
};
export default MyBets;

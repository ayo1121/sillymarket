import { useState, useEffect } from "react";

import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowRight } from "lucide-react";
import { useAnchorProgram } from "@/solana/program";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchUserPositions, canClaimPosition } from "@/solana/read";
import { fetchMarket } from "@/solana/read";
import { claimWinnings } from "@/solana/actions";
import { PublicKey } from "@solana/web3.js";
import { formatDistanceToNow } from "date-fns";
import BN from "bn.js";
import { toast } from "sonner";

const solFromLamports = (lamports: number | BN): number => {
  const num = typeof lamports === 'object' ? lamports.toNumber() : lamports;
  return num / 1e9;
};

interface Bet {
  id: string;
  question: string;
  prediction: string;
  amount: number;
  odds: number;
  potentialReturn: number;
  status: "pending" | "won" | "lost" | "claimed";
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
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<Map<string, boolean>>(new Map());
  
  useEffect(() => {
    const loadBets = async () => {
      if (!program || !publicKey) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      try {
        // Fetch all positions for this user
        const positions = await fetchUserPositions(program as any, publicKey);
        
        // Fetch market data for each position
        const betsData = await Promise.all(
          positions.map(async (pos: any) => {
            try {
              const marketData = await fetchMarket(program as any, pos.account.market);
              const market = marketData;
              
              // Get the outcome index from the position account.
              // Prefer `outcomeIndex` if present, then `outcome_index`. If both are
              // null/undefined, fall back to null.
              const outcomeIndex: number | null =
                pos.account.outcomeIndex ?? pos.account.outcome_index ?? null;

              // Derive a human-readable outcome name.
              // If the index is known, try to read the label from the market's outcomes.
              // If there is no label, fall back to "Outcome {index}".
              // If the index itself is unknown, show "Unknown".
              const outcomeName =
                outcomeIndex != null
                  ? (market.outcomes?.[outcomeIndex]?.label ??
                     `Outcome ${outcomeIndex}`)
                  : "Unknown";
              
              // Calculate potential return (simplified - would need actual odds calculation)
              const betAmount = solFromLamports(pos.account.amount?.toNumber() || pos.account.amount || 0);
              const rawMarket = market.rawAccount || market;
              const totalPool = market.volumeLamports || 0;
              
              // Get pool for this outcome (only if outcomeIndex is valid)
              const outcomePool = (outcomeIndex != null && market.outcomes?.[outcomeIndex])
                ? market.outcomes[outcomeIndex].poolLamports 
                : BigInt(0);
              const outcomePoolNum = solFromLamports(Number(outcomePool));
              
              // Simple odds calculation
              const odds = totalPool > 0 && outcomePoolNum > 0 ? totalPool / outcomePoolNum : 1;
              const potentialReturn = betAmount * odds;
              
              // Determine status: pending / won / lost / claimed
              let status: "pending" | "won" | "lost" | "claimed" = "pending";
              const isClaimed = pos.account.claimed ?? false;
              const marketState = rawMarket.state ?? 0;
              const winningIndex = rawMarket.winningIndex ?? rawMarket.winning_index;
              
              // If position is claimed, status is "claimed"
              if (isClaimed) {
                status = "claimed";
              } else if (marketState === 2 && winningIndex !== null && winningIndex !== undefined) {
                // Market is resolved (state === 2 is STATE_RESOLVED)
                const winningIdx = typeof winningIndex === 'object' 
                  ? winningIndex.toNumber() 
                  : winningIndex;
                if (outcomeIndex != null && winningIdx === outcomeIndex) {
                  status = "won";
                } else {
                  status = "lost";
                }
              } else {
                // Market is still active
                status = "pending";
              }

              // Check if position can be claimed
              const canClaim = canClaimPosition({
                market: rawMarket,
                position: pos.account,
                wallet: publicKey,
              });
              
              return {
                id: pos.publicKey.toBase58(),
                question: market.displayQuestion || market.question || "Unknown question",
                prediction: outcomeName,
                amount: betAmount,
                odds: odds.toFixed(2),
                potentialReturn: potentialReturn.toFixed(2),
                status,
                createdAt: formatDistanceToNow(new Date((rawMarket.createdTs?.toNumber() || rawMarket.created_ts?.toNumber() || Date.now() / 1000) * 1000), { addSuffix: true }),
                imageUrl: market.imageUrl || undefined,
                category: "market",
                marketAddress: pos.account.market.toBase58().slice(0, 6) + "..." + pos.account.market.toBase58().slice(-4),
                creatorAddress: market.creatorPubkey?.slice(0, 8) || "unknown",
                marketPubkey: pos.account.market.toBase58(),
                position: pos.account,
                canClaim,
              };
            } catch (err) {
              console.error("Error fetching market for position:", err);
              return null;
            }
          })
        );
        
        const validBets = betsData.filter((b): b is Bet => b !== null);
        setBets(validBets);
        
        console.debug("[MyBets] Loaded positions", {
          count: positions.length,
          sample: positions.slice(0, 3),
        });
      } catch (err) {
        console.error("Error loading bets:", err);
      } finally {
        setLoading(false);
      }
    };
    
    loadBets();
  }, [program, publicKey, claiming]);
  
  const totalBet = bets.reduce((sum, bet) => sum + bet.amount, 0);
  const potentialWinnings = bets.reduce((sum, bet) => sum + parseFloat(bet.potentialReturn), 0);
  
  const handleClaim = async (bet: Bet) => {
    if (!program || !publicKey || claiming.get(bet.id)) return;
    
    setClaiming(new Map(claiming.set(bet.id, true)));
    try {
      const marketPk = new PublicKey(bet.marketPubkey);
      const sig = await claimWinnings(program, {
        market: marketPk,
        user: publicKey,
      });
      toast.success(`Winnings claimed! Transaction: ${sig.slice(0, 8)}...`);
      
      // Reload bets after successful claim
      const positions = await fetchUserPositions(program as any, publicKey);
      const betsData = await Promise.all(
        positions.map(async (pos: any) => {
          try {
            const marketData = await fetchMarket(program as any, pos.account.market);
            const market = marketData;
            
            // Get the outcome index from the position account.
            // Prefer `outcomeIndex` if present, then `outcome_index`. If both are
            // null/undefined, fall back to null.
            const outcomeIndex: number | null =
              pos.account.outcomeIndex ?? pos.account.outcome_index ?? null;

            // Derive a human-readable outcome name.
            // If the index is known, try to read the label from the market's outcomes.
            // If there is no label, fall back to "Outcome {index}".
            // If the index itself is unknown, show "Unknown".
            const outcomeName =
              outcomeIndex != null
                ? (market.outcomes?.[outcomeIndex]?.label ??
                   `Outcome ${outcomeIndex}`)
                : "Unknown";
            
            const betAmount = solFromLamports(pos.account.amount?.toNumber() || pos.account.amount || 0);
            const rawMarket = market.rawAccount || market;
            const totalPool = market.volumeLamports || 0;
            
            // Get pool for this outcome (only if outcomeIndex is valid)
            const outcomePool = (outcomeIndex != null && market.outcomes?.[outcomeIndex])
              ? market.outcomes[outcomeIndex].poolLamports 
              : BigInt(0);
            const outcomePoolNum = solFromLamports(Number(outcomePool));
            
            const odds = totalPool > 0 && outcomePoolNum > 0 ? totalPool / outcomePoolNum : 1;
            const potentialReturn = betAmount * odds;
            
            // Determine status: pending / won / lost / claimed
            let status: "pending" | "won" | "lost" | "claimed" = "pending";
            const isClaimed = pos.account.claimed ?? false;
            const marketState = rawMarket.state ?? 0;
            const winningIndex = rawMarket.winningIndex ?? rawMarket.winning_index;
            
            // If position is claimed, status is "claimed"
            if (isClaimed) {
              status = "claimed";
            } else if (marketState === 2 && winningIndex !== null && winningIndex !== undefined) {
              // Market is resolved (state === 2 is STATE_RESOLVED)
              const winningIdx = typeof winningIndex === 'object' 
                ? winningIndex.toNumber() 
                : winningIndex;
              if (outcomeIndex != null && winningIdx === outcomeIndex) {
                status = "won";
              } else {
                status = "lost";
              }
            } else {
              // Market is still active
              status = "pending";
            }

            const canClaim = canClaimPosition({
              market: rawMarket,
              position: pos.account,
              wallet: publicKey,
            });
            
            return {
              id: pos.publicKey.toBase58(),
              question: market.displayQuestion || market.question || "Unknown question",
              prediction: outcomeName,
              amount: betAmount,
              odds: odds.toFixed(2),
              potentialReturn: potentialReturn.toFixed(2),
              status,
              createdAt: formatDistanceToNow(new Date((rawMarket.createdTs?.toNumber() || rawMarket.created_ts?.toNumber() || Date.now() / 1000) * 1000), { addSuffix: true }),
              imageUrl: market.imageUrl || undefined,
              category: "market",
              marketAddress: pos.account.market.toBase58().slice(0, 6) + "..." + pos.account.market.toBase58().slice(-4),
              creatorAddress: market.creatorPubkey?.slice(0, 8) || "unknown",
              marketPubkey: pos.account.market.toBase58(),
              position: pos.account,
              canClaim,
            };
          } catch (err) {
            console.error("Error fetching market for position:", err);
            return null;
          }
        })
      );
      
      setBets(betsData.filter((b): b is Bet => b !== null));
    } catch (error: any) {
      console.error("Claim error:", error);
      const errorMsg = error?.message || "Failed to claim winnings";
      if (errorMsg.includes("Unauthorized") || errorMsg.includes("InvalidState") || errorMsg.includes("AlreadyClaimed")) {
        toast.error("Cannot claim: " + errorMsg);
      } else {
        toast.error(errorMsg);
      }
    } finally {
      setClaiming(new Map(claiming.set(bet.id, false)));
    }
  };
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-8">
              <div className="bg-background win95-sunken p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-muted-foreground mb-1">total bet</div>
                <div className="text-xl sm:text-2xl font-bold">{totalBet} sol</div>
              </div>
              <div className="bg-background win95-sunken p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-muted-foreground mb-1">potential winnings</div>
                <div className="text-xl sm:text-2xl font-bold text-brand-yes">{potentialWinnings.toFixed(2)} sol</div>
              </div>
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
                ) : bets.length === 0 ? (
                  <div className="bg-background win95-sunken p-8 text-center">
                    <div className="text-6xl mb-4">:(</div>
                    <div className="text-muted-foreground">no bets yet. go make some predictions!</div>
                    <Button className="mt-4" onClick={() => window.location.href = "/"}>
                      browse markets
                    </Button>
                  </div>
                ) : (
                  bets.map(bet => <Tooltip key={bet.id}>
                    <TooltipTrigger asChild>
                      <div 
                        className="bg-background win95-raised p-1 sm:p-2 cursor-pointer hover:opacity-80 transition-opacity relative group"
                        onClick={() => navigate(`/market/${bet.marketPubkey}`)}
                      >
                    <div className="bg-primary/10 px-2 py-1 mb-2 flex items-center justify-between">
                      <span className="font-bold text-xs sm:text-sm">Bet Details</span>
                      <span className={`text-xs px-2 py-1 win95-sunken ${
                        bet.status === "pending" ? "bg-background" : 
                        bet.status === "won" ? "bg-brand-yes/20" : 
                        bet.status === "claimed" ? "bg-brand-yes/10" :
                        "bg-brand-no/20"
                      }`}>
                        {bet.status === "pending" ? "Open" : 
                         bet.status === "won" ? "Won" : 
                         bet.status === "claimed" ? "Claimed" :
                         "Lost"}
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
                            {bet.prediction} {bet.prediction === "yes" ? ":)" : ":("}
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs font-bold">bet amount</div>
                          <div className="font-black">{bet.amount} sol</div>
                        </div>
                        
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs font-bold">odds</div>
                          <div className="font-black">{bet.odds}x</div>
                        </div>
                        
                        <div>
                          <div className="text-muted-foreground mb-1 text-xs font-bold">potential return</div>
                          <div className="font-black text-brand-yes">{bet.potentialReturn} sol</div>
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
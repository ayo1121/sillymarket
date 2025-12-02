import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { placeBet } from "@/solana/actions";
import type { UIMarket } from "@/solana/marketMapping";
import { fetchAllMarkets } from "@/solana/read";
import { formatSol } from "@/utils/format";
import { logBetModalOpen } from "@/lib/analytics";
import { useAnchorProgram } from "@/solana/program";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { getOutcomeTheme } from "@/solana/outcomeTheme";
import { showErrorToast } from "@/lib/errorHandling";
import { getTxExplorerUrl } from "@/utils/solanaExplorer";

export type BetPlacedPayload = {
  marketPubkey: string;
  outcomeIndex: number;
  amountLamports: bigint;
  newProbs: number[];
  txSig?: string;
  username?: string | null;
};

interface BettingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  market: UIMarket | null;
  initialAnswerIndex: number;
  onBetPlaced?: (payload: BetPlacedPayload) => void;
}

const toLamports = (s: string) => Math.round(parseFloat(String(s ?? "0").trim()) * 1e9);

function computePostBetProbs(
  pools: bigint[],
  amountLamports: bigint,
  outcomeIndex: number,
): number[] {
  if (pools.length === 0) return [];

  const updated = pools.map((p, i) =>
    i === outcomeIndex ? p + amountLamports : p
  );
  const total = updated.reduce((acc, p) => acc + p, 0n);

  if (total === 0n) {
    const equal = 1 / pools.length;
    return pools.map(() => equal);
  }

  return updated.map(p => Number(p) / Number(total));
}

function calculateBetImpact(
  market: UIMarket | null,
  outcomeIndex: number,
  stakeLamports: number
) {
  if (!market || !market.outcomes[outcomeIndex]) {
    return { price: 0, impliedOdds: 1, expectedPayout: stakeLamports };
  }

  const pools = market.outcomes.map(o => Number(o.poolLamports ?? 0));
  const totalBefore = pools.reduce((a, b) => a + b, 0);

  const newPools = pools.slice();
  newPools[outcomeIndex] += stakeLamports;

  const totalAfter = totalBefore + stakeLamports;
  const targetAfter = newPools[outcomeIndex];

  // price = probability of this outcome
  const price = totalAfter > 0 ? targetAfter / totalAfter : 0;

  // implied odds
  const impliedOdds =
    targetAfter === 0 || totalAfter === 0
      ? 1
      : totalAfter / targetAfter;

  // expected payout formula
  const expectedPayout =
    targetAfter === 0
      ? stakeLamports
      : (stakeLamports * totalAfter) / targetAfter;

  return {
    price,
    impliedOdds,
    expectedPayout,
  };
}

export const BettingModal = ({ open, onOpenChange, market, initialAnswerIndex, onBetPlaced }: BettingModalProps) => {
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wallet = useWallet();
  const program = useAnchorProgram();
  const identity = useWalletIdentity();

  // Compute the outcome index the user already holds, if any.
  // Get it from market.userOutcomeIndex (set by fetchMarket when wallet is connected)
  // or from market.userPosition if present.
  // Explicitly type as number | null so that 0 is treated as a valid outcome index.
  const existingOutcomeIndex: number | null =
    typeof market?.userOutcomeIndex === "number"
      ? market.userOutcomeIndex
      : typeof (market as any)?.userPosition?.outcomeIndex === "number"
        ? (market as any).userPosition.outcomeIndex
        : typeof (market as any)?.userPosition?.outcome_index === "number"
          ? (market as any).userPosition.outcome_index
          : null;

  // hasExistingOutcome is true only when existingOutcomeIndex is not null (0 is valid)
  const hasExistingOutcome = existingOutcomeIndex != null;

  // Initialize answerIndex from initialAnswerIndex prop
  const [answerIndex, setAnswerIndex] = useState<number>(initialAnswerIndex ?? 0);

  // Update answerIndex when initialAnswerIndex or market changes
  useEffect(() => {
    setAnswerIndex(initialAnswerIndex ?? 0);
  }, [initialAnswerIndex, market?.pubkey]);

  // Reset amount when modal opens/closes
  useEffect(() => {
    if (!open) {
      setAmount("");
      setIsSubmitting(false);
    }
  }, [open]);

  // Track modal open for analytics
  // Track modal open for analytics
  const marketPubkey = market?.pubkey;
  useEffect(() => {
    if (open && marketPubkey) {
      logBetModalOpen(marketPubkey, answerIndex);
    }
  }, [open, marketPubkey, answerIndex]);

  const handleSelectOutcome = (index: number) => {
    // Allow the user to pick any outcome; the program will enforce
    // the "one outcome per user" rule and return an Anchor error if invalid.
    if (hasExistingOutcome && index !== existingOutcomeIndex) {
      const existingOutcomeLabel =
        existingOutcomeIndex != null && market?.outcomes?.[existingOutcomeIndex]
          ? market.outcomes[existingOutcomeIndex].label ??
          `Outcome ${existingOutcomeIndex}`
          : null;

      toast.info(
        existingOutcomeLabel
          ? `You already have a position on "${existingOutcomeLabel}". If you place a bet on another outcome, the transaction may fail.`
          : `You already have a position on this market. The program only allows adding to your existing outcome; bets on another outcome may fail.`
      );
    }

    setAnswerIndex(index);
  };

  const handleSubmit = async () => {
    // Validate wallet connection
    if (!wallet.connected || !wallet.publicKey) {
      toast.error("Please connect your wallet");
      return;
    }

    // Validate market
    if (!market) {
      toast.error("Market not available");
      return;
    }

    // Validate answer index
    if (answerIndex < 0 || answerIndex >= market.outcomes.length) {
      toast.error("Invalid outcome selected");
      return;
    }

    // Validate bet input using zod
    const betSchema = z.object({
      amount: z.number()
        .positive("Amount must be positive")
        .max(1000000, "Exceeds maximum bet limit")
        .finite("Amount must be a valid number"),
    });

    const parsedAmount = parseFloat(amount);

    const validationResult = betSchema.safeParse({
      amount: parsedAmount,
    });

    if (!validationResult.success) {
      toast.error(validationResult.error.errors[0].message);
      return;
    }

    const stakeLamports = toLamports(validationResult.data.amount.toString());

    // Capture outcome index before transaction
    const outcomeIndex = answerIndex;
    const amountLamportsBigInt = BigInt(stakeLamports);

    setIsSubmitting(true);
    try {
      const { txSig } = await placeBet(wallet, {
        marketPubkey: market.pubkey,
        outcomeIndex: outcomeIndex,
        outcomeLabel: market.outcomes[outcomeIndex]?.label,
        stakeLamports,
      });

      console.log("[BettingModal] Bet placed successfully", { txSig, marketPubkey: market.pubkey, outcomeIndex });
      console.log("[BettingModal] Bet placed on-chain; waiting for indexer (Helius -> Supabase)");

      // Use the same helper for consistency
      const pools = market.outcomes.map(o => BigInt(o.poolLamports ?? 0));
      const newProbs = computePostBetProbs(pools, amountLamportsBigInt, outcomeIndex);

      // Ensure newProbs length matches market outcomes
      if (newProbs.length !== market.outcomes.length) {
        console.error("[BettingModal] newProbs length mismatch", newProbs.length, "expected", market.outcomes.length);
      }

      // Call the callback if provided
      if (onBetPlaced && market) {
        onBetPlaced({
          marketPubkey: market.pubkey,
          outcomeIndex,
          amountLamports: amountLamportsBigInt,
          newProbs,
          txSig,
          username: identity?.username ?? null,
        });
      }

      toast.success(
        <div className="flex flex-col gap-1 text-sm">
          <span>Bet placed! Transaction: {txSig.slice(0, 8)}...</span>
          <a
            href={getTxExplorerUrl(txSig)}
            target="_blank"
            rel="noreferrer"
            className="underline font-semibold text-xs"
          >
            View on Explorer
          </a>
        </div>
      );

      // MICRO-INTERACTION: Haptic feedback on successful bet (mobile only)
      if (navigator.vibrate) {
        navigator.vibrate([50, 100, 50]); // Short-long-short pattern
      }

      // Refresh markets if program is available
      if (program) {
        try {
          await fetchAllMarkets(program as any, wallet.publicKey ?? null);
        } catch (e) {
          console.error("[BettingModal] Failed to refresh markets", e);
        }
      }

      onOpenChange(false);
      setAmount("");
    } catch (error: any) {
      console.error("[BettingModal] Bet placement failed", error);
      showErrorToast(error, "Failed to place bet", "placeBet");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get selected outcome
  const selectedOutcome = market?.outcomes[answerIndex];
  const selectedLabel = selectedOutcome?.label ?? `Outcome ${answerIndex + 1}`;

  // Type alias for outcome
  type Outcome = UIMarket["outcomes"][number];

  // Calculate odds (payout multiplier)
  const calculateOdds = (outcome?: Outcome) => {
    if (!market || !outcome) return "1.00x";

    const pools = market.outcomes.map(o => Number(o.poolLamports ?? 0));
    const total = pools.reduce((a, b) => a + b, 0);

    const pool = Number(outcome.poolLamports ?? 0);

    if (total === 0) return "1.00x";
    if (pool === 0) return "∞";

    const odds = total / pool;
    return odds.toFixed(2) + "x";
  };

  const odds = selectedOutcome ? calculateOdds(selectedOutcome) : "N/A";

  // Simulate bet for preview
  const stakeLamports = amount && !isNaN(parseFloat(amount)) ? toLamports(amount) : 0;
  const simulatedProbs = market && stakeLamports > 0
    ? computePostBetProbs(
      market.outcomes.map(o => BigInt(o.poolLamports ?? 0)),
      BigInt(stakeLamports),
      answerIndex
    )
    : null;
  const simulation = market ? calculateBetImpact(market, answerIndex, stakeLamports) : null;
  const expectedPayoutSol = simulation ? (simulation.expectedPayout / 1e9).toFixed(4) : "0.0000";

  if (!market) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#f5f5f5] dark:bg-[#1b1b1b] p-0 max-w-[560px] w-[95vw] border border-[#d3d3d3] dark:border-[#333] rounded shadow-[0_2px_8px_rgba(0,0,0,0.08)] overflow-hidden">
        {/* Faint smiley watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08] text-[80px] sm:text-[120px] font-black text-gray-400 select-none">
          : )
        </div>

        {/* Header Bar - Windows95 style */}
        <div className="relative bg-[#ececec] dark:bg-[#242424] px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between border-b border-[#d3d3d3] dark:border-[#333] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(0,0,0,0.1)]">
          <span className="font-bold text-[#111] dark:text-white text-xs sm:text-sm uppercase tracking-wide">Place Bet</span>
          <button
            onClick={() => onOpenChange(false)}
            className="w-5 h-5 sm:w-6 sm:h-6 border border-[#111] dark:border-white bg-white dark:bg-[#2a2a2a] flex items-center justify-center text-[#111] dark:text-white text-sm sm:text-base font-bold hover:bg-[#111] hover:text-white dark:hover:bg-white dark:hover:text-[#111] transition-colors rounded-sm"
          >
            ✖
          </button>
        </div>

        {/* Modal Content */}
        <div className="relative p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-6 max-h-[85vh] overflow-y-auto">
          {/* Market Info Box */}
          <div className="bg-[#fafafa] dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded p-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="text-[10px] sm:text-[11px] uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 tracking-wide">Market</div>
            <div className="text-sm sm:text-base font-bold text-[#111] dark:text-white break-words leading-tight">{market.displayQuestion}</div>
          </div>

          {/* Outcome selection (if multiple outcomes) */}
          {market.outcomes.length > 2 && (
            <div className="space-y-2 sm:space-y-3">
              <label className="text-[11px] sm:text-[13px] uppercase text-[#666] dark:text-[#c7c7c7] font-semibold tracking-wide">Select Outcome</label>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {market.outcomes.map((outcome) => {
                  const isSelected = answerIndex === outcome.index;
                  const theme = getOutcomeTheme(outcome.index);
                  return (
                    <button
                      key={outcome.index}
                      type="button"
                      onClick={() => handleSelectOutcome(outcome.index)}
                      className={`w-full bg-white dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded p-2 sm:p-3 text-left cursor-pointer transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-[#111] dark:ring-white shadow-md' : ''
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className={`font-bold text-xs sm:text-sm truncate ${theme.text}`}>
                            {outcome.label}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Betting On & Payout Boxes */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="bg-[#fafafa] dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded p-2 sm:p-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
              <div className="text-[10px] sm:text-[11px] uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 sm:mb-2 tracking-wide">Betting On</div>
              <div
                className={`text-sm sm:text-base font-bold px-2 sm:px-3 py-1 sm:py-1.5 rounded inline-block shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] ${(() => {
                  const theme = getOutcomeTheme(answerIndex);
                  // Map theme text colors to background/text combinations
                  if (theme.text.includes('green')) return 'bg-green-500/15 text-green-900 dark:text-green-400';
                  if (theme.text.includes('red')) return 'bg-red-500/15 text-red-900 dark:text-red-400';
                  if (theme.text.includes('blue')) return 'bg-blue-500/15 text-blue-900 dark:text-blue-400';
                  if (theme.text.includes('yellow')) return 'bg-yellow-500/15 text-yellow-900 dark:text-yellow-400';
                  if (theme.text.includes('purple')) return 'bg-purple-500/15 text-purple-900 dark:text-purple-400';
                  return 'bg-gray-500/15 text-gray-900 dark:text-gray-400';
                })()}`}
              >
                {selectedLabel}
              </div>
            </div>
            <div className="bg-[#fafafa] dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded p-2 sm:p-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
              <div className="text-[10px] sm:text-[11px] uppercase text-[#666] dark:text-[#c7c7c7] font-semibold mb-1 sm:mb-2 tracking-wide">Payout</div>
              <div className="text-sm sm:text-base font-bold text-[#111] dark:text-white">{odds}</div>
            </div>
          </div>

          {/* Input Field */}
          <div className="space-y-2 sm:space-y-3">
            <label className="text-[11px] sm:text-[13px] uppercase text-[#666] dark:text-[#c7c7c7] font-semibold tracking-wide">Bet Amount (SOL)</label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-10 sm:h-12 text-base font-semibold bg-white dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] placeholder:text-[#999] dark:placeholder:text-[#8c8c8c] focus:ring-2 focus:ring-[#111] focus:border-[#111] dark:text-white"
              step="0.01"
              min="0"
              disabled={isSubmitting}
            />
            {(() => {
              const existingOutcomeLabel =
                existingOutcomeIndex != null && market?.outcomes?.[existingOutcomeIndex]
                  ? market.outcomes[existingOutcomeIndex].label ??
                  `Outcome ${existingOutcomeIndex}`
                  : null;

              return existingOutcomeLabel ? (
                <p className="text-[10px] sm:text-xs text-[#666] dark:text-[#c7c7c7] mt-2 leading-relaxed">
                  You already have a position on: <strong className="text-[#111] dark:text-white">{existingOutcomeLabel}</strong>.
                  The program only allows adding to that outcome; betting on another side
                  may fail with an error.
                </p>
              ) : null;
            })()}
          </div>

          {/* Potential Return Box */}
          {simulation && (
            <div className="bg-white dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded p-3 sm:p-4 shadow-sm relative overflow-hidden">
              {/* Green gradient highlight at top */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-green-400 to-green-600"></div>

              <div className="space-y-1 sm:space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-[#111] dark:text-white">Potential Return</span>
                  <span className="font-mono font-bold text-[#111] dark:text-white">{expectedPayoutSol} SOL</span>
                </div>
                <div className="flex justify-between items-center text-xs text-[#666] dark:text-[#c7c7c7]">
                  <span>Implied Odds</span>
                  <span className="font-mono">{(simulation.impliedOdds * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 h-10 sm:h-11 bg-[#f0f0f0] dark:bg-[#1f1f1f] border border-[#111] dark:border-[#444] text-[#111] dark:text-white font-normal rounded hover:bg-[#e0e0e0] dark:hover:bg-[#2a2a2a] shadow-none"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!amount || parseFloat(amount) <= 0 || isSubmitting || !wallet.connected}
              className="flex-1 h-10 sm:h-11 bg-[#111] text-white dark:bg-white dark:text-[#111] border border-white/20 dark:border-transparent font-semibold rounded hover:bg-white hover:text-[#111] hover:border-[#111] dark:hover:bg-[#ccc] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#111] disabled:hover:text-white dark:disabled:hover:bg-white dark:disabled:hover:text-[#111]"
            >
              {isSubmitting ? "Placing..." : "Confirm Bet"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

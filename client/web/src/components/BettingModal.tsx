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
import { useAnchorProgram } from "@/solana/program";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { getOutcomeTheme } from "@/solana/outcomeTheme";
import { showErrorToast } from "@/lib/errorHandling";

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

      toast.success(`Bet placed! Transaction: ${txSig.slice(0, 8)}...`);

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
      <DialogContent className="win95-window bg-background p-0 max-w-md border-0">
        <div className="bg-primary text-primary-foreground px-3 py-2 flex items-center justify-between">
          <span className="font-black text-sm tracking-tight">place bet</span>
          <button
            onClick={() => onOpenChange(false)}
            className="w-4 h-4 win95-raised bg-background flex items-center justify-center text-foreground text-xs font-black hover:bg-accent"
          >
            ×
          </button>
        </div>

        <div className="win95-sunken bg-background p-6 m-1">
          <div className="space-y-4">
            <div className="win95-sunken bg-input p-3">
              <div className="text-xs text-muted-foreground font-bold mb-1">market</div>
              <div className="text-sm font-black">{market.displayQuestion}</div>
            </div>

            {/* Outcome selection (if multiple outcomes) */}
            {market.outcomes.length > 2 && (
              <div className="space-y-2">
                <label className="text-sm font-bold">select outcome</label>
                <div className="grid grid-cols-2 gap-2">
                  {market.outcomes.map((outcome) => {
                    const isSelected = answerIndex === outcome.index;
                    const theme = getOutcomeTheme(outcome.index);
                    return (
                      <button
                        key={outcome.index}
                        type="button"
                        onClick={() => handleSelectOutcome(outcome.index)}
                        className={`w-full win95-sunken bg-input p-3 text-left cursor-pointer transition-colors border-2 rounded ${theme.border} ${isSelected ? theme.bgSelected : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`font-bold text-sm truncate ${theme.text}`}>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="win95-sunken bg-input p-3">
                <div className="text-xs text-muted-foreground font-bold mb-1">betting on</div>
                <div
                  className={`text-lg font-black px-2 py-1 rounded border-2 inline-block ${getOutcomeTheme(answerIndex ?? -1).border} ${getOutcomeTheme(answerIndex ?? -1).text}`}
                >
                  {selectedLabel}
                </div>
              </div>
              <div className="win95-sunken bg-input p-3">
                <div className="text-xs text-muted-foreground font-bold mb-1">payout</div>
                <div className="text-lg font-black">{odds}</div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold">bet amount (sol)</label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="win95-sunken bg-input border-0 h-12 text-lg font-black"
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
                  <p className="text-xs text-muted-foreground mt-1">
                    You already have a position on: <strong>{existingOutcomeLabel}</strong>.
                    The program only allows adding to that outcome; betting on another side
                    may fail with an error.
                  </p>
                ) : null;
              })()}
            </div>

            {simulation && (
              <div className="win95-sunken bg-input p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-bold">potential return</span>
                  <span className="font-black">{expectedPayoutSol} sol</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>implied odds</span>
                  <span>{(simulation.impliedOdds * 100).toFixed(1)}%</span>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1"
                disabled={isSubmitting}
              >
                cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={!amount || parseFloat(amount) <= 0 || isSubmitting || !wallet.connected}
                className="flex-1"
              >
                {isSubmitting ? "placing..." : "confirm bet"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

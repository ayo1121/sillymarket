import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useAnchorProgram } from "../solana/program";
import { fetchMarket, fetchConfig, fetchUserPositions, canResolveMarket, canClaimPosition } from "../solana/read";
import { useWallet } from "@solana/wallet-adapter-react";
import { placeBet, claimWinnings, resolveMarket } from "../solana/actions";
import { toast } from "sonner";
import BN from "bn.js";
import { showErrorToast } from "@/lib/errorHandling";
import { getTxExplorerUrl } from "@/utils/solanaExplorer";

// Constants from Rust program
const STATE_ACTIVE = 1;
const STATE_RESOLVED = 2;
const WIN_UNSET = -1;
const WIN_VOID = -2;
const MIN_BET_LAMPORTS = 10_000_000; // 0.01 SOL
const CREATION_FEE_LAMPORTS = 20_000_000; // 0.02 SOL

export default function MarketPage() {
  const { pk } = useParams();
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const { publicKey } = useWallet();
  const [acct, setAcct] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("0.01");
  const [betting, setBetting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [userPosition, setUserPosition] = useState<any | null>(null);
  const [config, setConfig] = useState<any | null>(null);

  const marketPk = useMemo(() => {
    try {
      return pk ? new PublicKey(pk) : null;
    } catch {
      return null;
    }
  }, [pk]);

  useEffect(() => {
    (async () => {
      if (!program || !marketPk) return;
      try {
        const a = await fetchMarket(program, marketPk, publicKey);
        setAcct(a);

        // Fetch user position if wallet is connected
        if (publicKey) {
          try {
            const positions = await fetchUserPositions(program, publicKey);
            const positionForMarket = positions.find((p: any) => {
              const posMarket = p.account.market;
              const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
              return marketPubkey === marketPk.toBase58();
            });
            setUserPosition(positionForMarket || null);
          } catch (posErr) {
            console.error("Error fetching user position:", posErr);
            setUserPosition(null);
          }
        }

        // Fetch config for resolve checks
        try {
          const configData = await fetchConfig(program);
          setConfig(configData);
        } catch (configErr) {
          console.error("Error fetching config:", configErr);
          setConfig(null);
        }
      } catch (e: any) {
        setErr(e?.message || String(e));
      }
    })();
  }, [program, marketPk, publicKey]);

  const refreshMarket = async () => {
    if (!program || !marketPk) return;
    try {
      const a = await fetchMarket(program, marketPk, publicKey);
      setAcct(a);

      // Refresh user position
      if (publicKey) {
        try {
          const positions = await fetchUserPositions(program, publicKey);
          const positionForMarket = positions.find((p: any) => {
            const posMarket = p.account.market;
            const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
            return marketPubkey === marketPk.toBase58();
          });
          setUserPosition(positionForMarket || null);
        } catch (posErr) {
          console.error("Error refreshing user position:", posErr);
          setUserPosition(null);
        }
      }
    } catch (e: any) {
      console.error("Error refreshing market:", e);
    }
  };

  const solToLamports = (sol: string): number => {
    const num = parseFloat(sol);
    if (isNaN(num) || num <= 0) return 0;
    return Math.floor(num * 1_000_000_000);
  };

  const lamportsToSol = (lamports: number | BN): string => {
    const num = typeof lamports === "number" ? lamports : lamports.toNumber();
    return (num / 1_000_000_000).toFixed(2);
  };

  async function onPlaceBet(outcomeIndex: number) {
    if (!program || !publicKey || !marketPk || !acct) return;

    const lamports = solToLamports(amount);
    if (lamports < MIN_BET_LAMPORTS) {
      toast.error(`Minimum bet is ${lamportsToSol(MIN_BET_LAMPORTS)} SOL`);
      return;
    }

    if (lamports > (acct.maxBetSnapshot || 100_000 * 1_000_000_000)) {
      toast.error("Bet amount too large");
      return;
    }

    if (acct.state !== STATE_ACTIVE) {
      toast.error("Market is not active");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const cutoffTs = acct.cutoffTs || acct.cutoff_ts || 0;
    if (now >= cutoffTs) {
      toast.error("Betting is closed");
      return;
    }

    if (outcomeIndex >= acct.outcomesCount) {
      toast.error("Invalid outcome index");
      return;
    }

    setBetting(true);
    try {
      const sig = await placeBet(program, {
        market: marketPk,
        user: publicKey,
        outcomeIndex,
        amountLamports: lamports,
      });
      toast.success(
        <div className="flex flex-col gap-1 text-sm">
          <span>Bet placed! Transaction: {sig}</span>
          <a
            href={getTxExplorerUrl(sig)}
            target="_blank"
            rel="noreferrer"
            className="underline font-semibold text-xs"
          >
            View on Explorer
          </a>
        </div>
      );
      await refreshMarket();
    } catch (error: any) {
      console.error("Anchor tx failed in Market (placeBet):", error);
      console.error("Error details:", {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        code: error?.code,
        logs: error?.logs,
        market: marketPk?.toBase58(),
        outcomeIndex,
        amountLamports: lamports,
      });
      showErrorToast(error, "Failed to place bet", "placeBet");
    } finally {
      setBetting(false);
    }
  }

  async function onClaimWinnings() {
    if (!program || !publicKey || !marketPk || !acct) return;

    // Check if user can claim using helper
    const canClaim = canClaimPosition({
      market: acct.rawAccount || acct,
      position: userPosition?.account || userPosition,
      wallet: publicKey,
    });

    if (!canClaim) {
      toast.error("No claimable position found. You may not have a winning position or it may already be claimed.");
      return;
    }

    setClaiming(true);
    try {
      const sig = await claimWinnings(program, {
        market: marketPk,
        user: publicKey,
      });
      toast.success(
        <div className="flex flex-col gap-1 text-sm">
          <span>Winnings claimed! Transaction: {sig}</span>
          <a
            href={getTxExplorerUrl(sig)}
            target="_blank"
            rel="noreferrer"
            className="underline font-semibold text-xs"
          >
            View on Explorer
          </a>
        </div>
      );
      await refreshMarket();
    } catch (error: any) {
      console.error("Error claiming winnings:", error);
      const errorMsg = error?.message || "Failed to claim winnings";
      if (errorMsg.includes("Unauthorized") || errorMsg.includes("InvalidState")) {
        toast.error("Cannot claim: " + errorMsg);
      } else {
        toast.error(errorMsg);
      }
    } finally {
      setClaiming(false);
    }
  }

  async function onResolveMarket(winnerIndex: number) {
    if (!program || !publicKey || !marketPk || !acct || !config) return;

    // Check if user can resolve using helper
    const configAuthority = config.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
    const canResolve = canResolveMarket({
      market: acct.rawAccount || acct,
      wallet: publicKey,
      configAuthority,
      configAdminPreCutoff: config.adminPreCutoff ?? config.admin_pre_cutoff ?? false,
    });

    if (!canResolve) {
      toast.error("You are not authorized to resolve this market. Only the creator (after cutoff) or config authority can resolve.");
      return;
    }

    setResolving(true);
    try {
      // Get platform fee wallet and creator wallet from market account
      const platformFeeWallet = acct.rawAccount?.platformFeeWallet || acct.rawAccount?.platform_fee_wallet || acct.platformFeeWallet;
      const creatorWallet = acct.rawAccount?.creator || acct.creatorPubkey || acct.creator;

      if (!platformFeeWallet || !creatorWallet) {
        toast.error("Missing market data: platform fee wallet or creator wallet not found");
        setResolving(false);
        return;
      }

      const platformFeePk = typeof platformFeeWallet === "string" ? new PublicKey(platformFeeWallet) : platformFeeWallet;
      const creatorPk = typeof creatorWallet === "string" ? new PublicKey(creatorWallet) : creatorWallet;

      const sig = await resolveMarket(program, {
        market: marketPk,
        signer: publicKey,
        winnerIndex,
        platformFeeWallet: platformFeePk,
        creatorWallet: creatorPk,
      });
      toast.success(
        <div className="flex flex-col gap-1 text-sm">
          <span>Market resolved! Transaction: {sig}</span>
          <a
            href={getTxExplorerUrl(sig)}
            target="_blank"
            rel="noreferrer"
            className="underline font-semibold text-xs"
          >
            View on Explorer
          </a>
        </div>
      );
      await refreshMarket();
    } catch (error: any) {
      console.error("Error resolving market:", error);
      const errorMsg = error?.message || "Failed to resolve market";
      if (errorMsg.includes("Unauthorized") || errorMsg.includes("InvalidState") || errorMsg.includes("AlreadyResolved")) {
        toast.error("Cannot resolve: " + errorMsg);
      } else {
        toast.error(errorMsg);
      }
    } finally {
      setResolving(false);
    }
  }

  if (!marketPk) return <div className="p-4 text-sm">Invalid market address.</div>;
  if (!program) return <div className="p-4 text-sm">Connect wallet.</div>;
  if (err) return <div className="p-4 text-red-600 text-sm">Error: {err}</div>;
  if (!acct) return <div className="p-4 text-sm">Loading market…</div>;

  const now = Math.floor(Date.now() / 1000);
  const cutoffTs = acct.cutoffTs || acct.cutoff_ts || 0;
  const isActive = acct.state === STATE_ACTIVE;
  const isResolved = acct.state === STATE_RESOLVED;
  const bettingOpen = isActive && now < cutoffTs;
  const cutoffDate = new Date(cutoffTs * 1000);
  const createdDate = new Date((acct.createdTs || acct.created_ts || 0) * 1000);

  // Compute resolve/claim permissions
  const configAuthority = config?.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
  const canResolve = publicKey && config && canResolveMarket({
    market: acct.rawAccount || acct,
    wallet: publicKey,
    configAuthority,
    configAdminPreCutoff: config.adminPreCutoff ?? config.admin_pre_cutoff ?? false,
  });

  const canClaim = publicKey && userPosition && canClaimPosition({
    market: acct.rawAccount || acct,
    position: userPosition.account || userPosition,
    wallet: publicKey,
  });

  // Get pool totals
  const pools = acct.pools || [];
  const totalPool = acct.totalPool || acct.total_pool || 0;
  const outcomesCount = acct.outcomesCount || acct.outcomes_count || 0;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <button onClick={() => navigate("/")} className="text-sm underline">
        ← Back to markets
      </button>

      <div className="border rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Market Details</h1>
          <div className="text-xs text-gray-500 break-all mb-2">{marketPk.toBase58()}</div>
          <div className="text-sm space-y-1">
            <div>State: {isActive ? "Active" : isResolved ? "Resolved" : "Unknown"}</div>
            <div>Created: {createdDate.toLocaleString()}</div>
            <div>Cutoff: {cutoffDate.toLocaleString()}</div>
            {isResolved && (
              <div>
                Winner: {(acct.winningIndex || acct.winning_index) === WIN_VOID ? "VOID" : (acct.winningIndex || acct.winning_index) === WIN_UNSET ? "UNSET" : `Outcome ${acct.winningIndex || acct.winning_index}`}
              </div>
            )}
          </div>
        </div>

        {acct.imageUrl && (
          <div>
            <img src={acct.imageUrl} alt="Market" className="max-w-full h-48 object-cover rounded" />
          </div>
        )}

        <div className="space-y-2">
          <h2 className="font-semibold">Question Hash:</h2>
          <div className="text-xs font-mono break-all bg-gray-100 p-2 rounded">
            {Buffer.from(acct.questionHash || []).toString("hex")}
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold">Pools:</h2>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: outcomesCount }).map((_, i) => (
              <div key={i} className="border rounded p-2">
                <div className="text-xs text-gray-600">Outcome {i}</div>
                <div className="font-semibold">{lamportsToSol(pools[i] || 0)} SOL</div>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <strong>Total Pool: {lamportsToSol(totalPool)} SOL</strong>
          </div>
        </div>

        {bettingOpen && publicKey && (
          <div className="border rounded p-4 space-y-3">
            <h3 className="font-semibold">Place Bet</h3>
            <div className="flex gap-2">
        <input
                type="number"
                step="0.01"
                min="0.01"
          value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Amount (SOL)"
                className="border rounded px-2 py-1 text-sm flex-1"
        />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: outcomesCount }).map((_, i) => (
                <button
                  key={i}
                  className="border rounded px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
                  onClick={() => onPlaceBet(i)}
                  disabled={betting || !amount || solToLamports(amount) < MIN_BET_LAMPORTS}
                >
                  {betting ? "Placing..." : `Bet Outcome ${i}`}
        </button>
              ))}
            </div>
            <div className="text-xs text-gray-500">
              Min bet: {lamportsToSol(MIN_BET_LAMPORTS)} SOL
            </div>
          </div>
        )}

        {publicKey && canResolve && (
          <div className="border rounded p-4 space-y-2">
            <h3 className="font-semibold text-sm mb-2">Resolve Market</h3>
            {acct.isLocked && (
              <div className="text-xs text-gray-600 mb-2">Status: Locked (cutoff passed)</div>
            )}
            <div className="flex gap-2">
              {Array.from({ length: acct.outcomesCount || acct.outcomes_count || 2 }).map((_, i) => (
                <button
                  key={i}
                  className="border rounded px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
                  onClick={() => onResolveMarket(i)}
                  disabled={resolving}
                >
                  {resolving ? "Resolving..." : `Resolve: Outcome ${i}`}
                </button>
              ))}
              <button
                className="border rounded px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
                onClick={() => onResolveMarket(-2)}
                disabled={resolving}
              >
                {resolving ? "Resolving..." : "VOID"}
              </button>
            </div>
            <div className="text-xs text-gray-500">
              {configAuthority && publicKey.equals(configAuthority) 
                ? "Admin can resolve (may be pre-cutoff if enabled)"
                : "Creator can resolve after cutoff"}
            </div>
          </div>
        )}

        {acct.isResolved && publicKey && canClaim && (
          <div className="border rounded p-4">
            <button
              className="border rounded px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
              onClick={onClaimWinnings}
              disabled={claiming}
            >
              {claiming ? "Claiming..." : "Claim Winnings"}
            </button>
          </div>
        )}

        {acct.isResolved && publicKey && !canClaim && (
          <div className="border rounded p-4 text-sm text-gray-600">
            No claimable position. You may not have a winning position or it may already be claimed.
          </div>
        )}

        {!publicKey && (
          <div className="text-sm text-gray-600">Connect wallet to place bets</div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">Raw Data</summary>
          <pre className="text-[11px] overflow-x-auto bg-gray-50 p-2 rounded mt-2">
            {JSON.stringify(acct, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}

import { usePlaceBet } from "@/hooks/useYesNo";
import { useAnchorProgram } from "@/solana/program";
import { useWallet } from "@solana/wallet-adapter-react";
import { canResolveMarket, canClaimPosition, fetchConfig } from "@/solana/read";
import { useMemo } from "react";
import type { UIMarket } from "@/solana/marketMapping";
import { PublicKey } from "@solana/web3.js";

/**
 * Helper selectors that compute resolve/claim permissions for a market.
 * These use the shared helpers from read.ts and match on-chain rules.
 */
export function useMarketPermissions(market: UIMarket | null, userPosition: any | null) {
  const program = useAnchorProgram();
  const { publicKey } = useWallet();
  
  const permissions = useMemo(() => {
    if (!market || !publicKey) {
      return {
        canResolve: false,
        canClaim: false,
        claimablePosition: null,
      };
    }

    // For canResolve, we need config data (authority and admin_pre_cutoff)
    // We'll compute this lazily when needed, but for now return false if config not available
    // In practice, UI should fetch config separately if showing resolve button
    const canResolve = false; // Will be computed by canResolveMarket helper when config is available

    // For canClaim, we can compute directly if we have position
    const canClaim = canClaimPosition({
      market: market.rawAccount,
      position: userPosition?.account || userPosition,
      wallet: publicKey,
    });

    return {
      canResolve,
      canClaim,
      claimablePosition: canClaim ? (userPosition?.account || userPosition) : null,
    };
  }, [market, userPosition, publicKey]);

  return permissions;
}

/**
 * Original adapter for placing bets (backwards compatible)
 */
export function useOnchainBetAdapter(marketPk?: string) {
  const place = usePlaceBet(marketPk);
  return {
    onConfirm: async (side: "yes" | "no", lamports: number) => {
      const idx = side === "yes" ? 0 : 1;
      return place(idx, lamports);
    },
  };
}

/**
 * Helper function to compute canResolve for a market with config data.
 * This should be called with fetched config authority and admin_pre_cutoff.
 */
export async function computeCanResolve(
  market: UIMarket | null,
  wallet: PublicKey | null,
  configAuthority: PublicKey | null,
  configAdminPreCutoff: boolean | null
): Promise<boolean> {
  if (!market || !wallet) {
    return false;
  }

  return canResolveMarket({
    market: market.rawAccount,
    wallet,
    configAuthority,
    configAdminPreCutoff,
  });
}

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/http";

type Ctx = {
  pubkey: string | null;
  username: string | null;
  setUsername: (u: string) => void;
  ready: boolean;            // true iff gating disabled or wallet connected
  isAuthenticated: boolean;  // wallet connected + SIWS verified
  walletAddress: string | null; // alias for pubkey for consistency
};
const WalletIdentityCtx = createContext<Ctx>({
  pubkey: null, username: null, setUsername: () => { }, ready: true,
  isAuthenticated: false, walletAddress: null
});

export function WalletIdentityProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, connected } = useWallet();
  const pk = publicKey?.toBase58() || null;
  const [username, setU] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Fetch username and check authentication from server when wallet changes or after SIWS
  useEffect(() => {
    if (!pk || !connected) {
      setU(null);
      setIsAuthenticated(false);
      return;
    }

    // Upsert user in Supabase when wallet connects (just to ensure existence)
    const upsertUserProfile = async () => {
      try {
        const { upsertUser } = await import("@/integrations/supabase/writes");
        // Don't pass username here to avoid overwriting it with null before we fetch it
        await upsertUser(pk);
        console.log("[walletIdentity] User profile upserted in Supabase");
      } catch (err) {
        console.error("[walletIdentity] Failed to upsert user in Supabase:", err);
        // Don't block wallet connection on Supabase failure
      }
    };

    upsertUserProfile();

    // Fetch username and check auth from server (retry if session might not be ready yet)
    const fetchUserInfo = async () => {
      try {
        const r = await api("/me");
        // Accept both { ok: true, user: ... } and older formats if any
        const user = r?.user ?? null;
        if (user) {
          setIsAuthenticated(true);
          setU(user.username || null);
        } else {
          setIsAuthenticated(false);
          setU(null);
        }
      } catch (e) {
        // Network error or other issue - treat as guest
        console.warn("[yesno] /me request failed in walletIdentity, treating as guest", e);
        setIsAuthenticated(false);
        setU(null);
      }
    };

    fetchUserInfo();

    // Also refetch after a short delay in case SIWS is still completing
    const timeout = setTimeout(fetchUserInfo, 1000);

    // Listen for refresh events (triggered after SIWS completes)
    const handleRefresh = () => {
      fetchUserInfo();
    };
    window.addEventListener("username-refresh", handleRefresh);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("username-refresh", handleRefresh);
    };
  }, [pk, connected]);

  const setUsername = React.useCallback((u: string) => {
    if (!pk) return;
    setU(u);
    // Server already updated, just sync local state
  }, [pk]);

  const requireWallet = import.meta.env.VITE_REQUIRE_WALLET === "1";
  const ready = !requireWallet || !!pk;       // ONLY require wallet, not username

  const v = useMemo<Ctx>(() => ({
    pubkey: pk,
    username,
    setUsername,
    ready,
    isAuthenticated,
    walletAddress: pk
  }), [pk, username, setUsername, ready, isAuthenticated]);

  return <WalletIdentityCtx.Provider value={v}>{children}</WalletIdentityCtx.Provider>;
}

export function useWalletIdentity() { return useContext(WalletIdentityCtx); }

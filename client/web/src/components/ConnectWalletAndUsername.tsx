import React, { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWalletIdentity } from "@/auth/walletIdentity";
import UsernameModal from "@/components/UsernameModal";
import { api } from "@/lib/http";
import bs58 from "bs58";
import { Button } from "@/components/ui/button";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { useNavigate } from "react-router-dom";

function shorten(pk: string) { return pk ? pk.slice(0, 4) + "…" + pk.slice(-4) : ""; }
function forgetRemembered() {
  try {
    localStorage.removeItem("yesno_wallet");
    localStorage.removeItem("walletAdapter");
    localStorage.removeItem("walletName");
  } catch {
    // Ignore localStorage errors (e.g., in private browsing mode)
  }
}

export default function ConnectWalletAndUsername({ className, claimableCount = 0 }: { className?: string; claimableCount?: number }) {
  const { connected, connecting, connect, disconnect, publicKey, wallet, wallets, select, signMessage } = useWallet() as any;
  const { setVisible } = useWalletModal();
  const { username, setUsername } = useWalletIdentity();
  const navigate = useNavigate();

  const [askUsername, setAskUsername] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    if (menuOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  async function signInIfNeeded() {
    if (!publicKey) {
      console.log("[ConnectWallet] signInIfNeeded: no publicKey");
      return null;
    }

    const pk58 = publicKey.toBase58();
    console.log("[ConnectWallet] signInIfNeeded: checking profile...", { publicKey: pk58 });

    try {
      // First, check if we already have a session
      const me = await api("/me");
      const user = me?.user ?? null;

      // If we have a valid user session, we're already signed in
      if (me?.ok && user) {
        console.log("[ConnectWallet] signInIfNeeded: already signed in", {
          hasUsername: !!user.username,
          username: user.username
        });

        // If we have a session but no username, trigger refresh
        if (!user.username) {
          window.dispatchEvent(new Event("username-refresh"));
        }
        return me;
      }

      // No valid session - need to sign in
      console.log("[ConnectWallet] signInIfNeeded: no session found, starting SIWS...");
    } catch (e) {
      // /me failed - likely no session, proceed to SIWS
      console.log("[ConnectWallet] signInIfNeeded: /me check failed, starting SIWS...", e);
    }

    // SIWS (Sign-In With Solana) flow
    try {
      console.log("[ConnectWallet] signInIfNeeded: requesting SIWS challenge...");
      const start = await api("/auth/siws/start", {
        method: "POST",
        body: JSON.stringify({ pubkey: pk58 })
      });

      if (!start?.message) {
        console.error("[ConnectWallet] signInIfNeeded: invalid SIWS start response", start);
        return null;
      }

      const msg = new TextEncoder().encode(start.message);
      const signFn = signMessage || wallet?.adapter?.signMessage;

      if (typeof signFn !== "function") {
        console.error("[ConnectWallet] signInIfNeeded: wallet does not support message signing");
        alert("This wallet does not support message signing. Try another wallet.");
        return null;
      }

      console.log("[ConnectWallet] signInIfNeeded: prompting user to sign message...");
      const sig = await signFn(msg);
      const signatureBase58 = bs58.encode(sig);

      console.log("[ConnectWallet] signInIfNeeded: submitting signature...");
      const result = await api("/auth/siws/finish", {
        method: "POST",
        body: JSON.stringify({
          pubkey: pk58,
          nonce: start.nonce,
          signatureBase58
        })
      });

      console.log("[ConnectWallet] signInIfNeeded: ✅ SIWS complete", {
        ok: result?.ok,
        hasUser: !!result?.user
      });

      // After SIWS, trigger username fetch
      window.dispatchEvent(new Event("username-refresh"));
      return result;
    } catch (e: any) {
      console.error("[ConnectWallet] signInIfNeeded: SIWS error", e);
      // If user cancelled, don't show error
      if (e?.message?.includes("User rejected") || e?.message?.includes("User cancelled")) {
        console.log("[ConnectWallet] signInIfNeeded: user cancelled sign-in");
        return null;
      }
      throw e;
    }
  }

  // Track if we've already prompted for username to avoid repeated prompts
  const [hasPrompted, setHasPrompted] = useState(false);

  // Auto-trigger sign-in and username prompt after connection
  useEffect(() => {
    if (!connected || !publicKey || hasPrompted) {
      return;
    }

    console.log("[ConnectWallet] Wallet connected, checking profile...", {
      publicKey: publicKey.toBase58(),
      hasUsername: !!username
    });

    // If wallet doesn't support signing yet, wait.
    // We check both the hook's signMessage and the adapter's directly.
    const canSign = !!signMessage || !!wallet?.adapter?.signMessage;
    if (!canSign) {
      console.log("[ConnectWallet] signMessage not ready yet, waiting...");
      return;
    }

    // Wait a moment for wallet to fully initialize
    const timer = setTimeout(async () => {
      try {
        // First, ensure SIWS is complete (this will prompt for sign-in if needed)
        console.log("[ConnectWallet] Triggering sign-in check...");
        const me = await signInIfNeeded();

        // Wait a bit for walletIdentity to fetch the updated profile
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if username exists now
        const checkMe = await api("/me").catch(() => ({ ok: false, user: null }));
        const user = checkMe?.user ?? null;
        const isAuthenticated = checkMe?.ok && !!user;
        const hasUsername = user && user.username;

        console.log("[ConnectWallet] Profile check complete", {
          isAuthenticated,
          hasUsername,
          username: user?.username || null
        });

        // CRITICAL: Only prompt for username if the user is actually authenticated!
        // If they cancelled sign-in or it failed, isAuthenticated will be false.
        if (isAuthenticated && !hasUsername) {
          console.log("[ConnectWallet] Authenticated but no username, prompting...");
          setAskUsername(true);
        } else if (!isAuthenticated) {
          console.log("[ConnectWallet] Not authenticated, skipping username prompt");
        } else {
          console.log("[ConnectWallet] ✅ User has username, no prompt needed");
        }

        setHasPrompted(true);
      } catch (e: any) {
        console.error("[ConnectWallet] Error in sign-in flow:", e);
        // If user cancelled sign-in, don't prompt for username yet
        if (e?.message?.includes("User rejected") || e?.message?.includes("User cancelled")) {
          console.log("[ConnectWallet] User cancelled sign-in, not prompting for username");
        } else {
          // For other errors, also don't prompt as they likely aren't authenticated
          console.warn("[ConnectWallet] Sign-in failed, suppressing username prompt");
        }
        setHasPrompted(true);
      }
    }, 500); // Reduced delay - trigger faster after connection

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey, hasPrompted, signMessage, setVisible]); // Added signMessage to dependencies

  // Effect to handle case where signMessage becomes available later
  useEffect(() => {
    if (connected && publicKey && !hasPrompted && (signMessage || wallet?.adapter?.signMessage)) {
      // This will trigger the main effect above because signMessage changed or we just re-rendered
    }
  }, [signMessage, wallet, connected, publicKey, hasPrompted]);

  const onPrimaryClick = async () => {
    if (!connected) {
      console.log("[ConnectWallet] Opening wallet modal...", {
        connecting,
        wallets: wallets?.length,
        availableWallets: available.length,
        setVisible: typeof setVisible,
        hasPhantom: typeof window !== "undefined" && !!(window as any).solana?.isPhantom,
        currentWallet: wallet?.adapter?.name
      });

      // If a wallet is already selected and not connecting, try direct connect first
      if (wallet && wallet.adapter && !connecting) {
        console.log("[ConnectWallet] Wallet already selected:", wallet.adapter.name, "- attempting direct connect");
        try {
          await connect();
          console.log("[ConnectWallet] ✅ Direct connect successful!");
          return;
        } catch (e: any) {
          // Check if it's a WalletNotSelectedError - if so, just open modal
          if (e?.name === "WalletNotSelectedError" || e?.message?.includes("WalletNotSelectedError")) {
            console.warn("[ConnectWallet] Wallet not selected, showing modal instead");
            setVisible(true);
            return;
          }
          console.error("[ConnectWallet] Direct connect failed:", e);
          console.error("[ConnectWallet] Error details:", {
            message: e?.message,
            name: e?.name,
            code: e?.code
          });
          // Fall through to open modal
        }
      }

      // If no wallet selected or connecting, just open modal
      if (!wallet || !wallet.adapter || connecting) {
        setVisible(true);
        return;
      }

      // If Phantom is detected and no wallet is selected, try selecting it first
      if (typeof window !== "undefined" && (window as any).solana?.isPhantom && !wallet) {
        const phantomWallet = wallets.find((w: any) => w.adapter.name === "Phantom");
        if (phantomWallet) {
          console.log("[ConnectWallet] Phantom detected, selecting Phantom wallet...");
          try {
            select(phantomWallet.adapter.name);
            console.log("[ConnectWallet] Phantom wallet selected, attempting connect...");
            // Wait a tick for selection to register
            await new Promise(resolve => setTimeout(resolve, 50));
            try {
              await connect();
              console.log("[ConnectWallet] ✅ Direct Phantom connect successful!");
              return;
            } catch (e: any) {
              console.error("[ConnectWallet] Direct Phantom connect failed:", e);
              console.error("[ConnectWallet] Error details:", {
                message: e?.message,
                name: e?.name,
                code: e?.code
              });
              // Fall through to open modal
            }
          } catch (err) {
            console.error("[ConnectWallet] Failed to select Phantom:", err);
          }
        }
      }

      // Open the wallet selection modal
      try {
        setVisible(true);
        console.log("[ConnectWallet] Wallet modal opened successfully");
      } catch (err) {
        console.error("[ConnectWallet] ❌ Failed to open wallet modal:", err);
      }
      return;
    }
    // connected: ensure session is established
    try {
      console.log("[ConnectWallet] Button clicked while connected, ensuring sign-in...");
      const me = await signInIfNeeded();

      // Wait a moment for profile to update
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check current username state
      const checkMe = await api("/me").catch(() => ({ ok: false, user: null }));
      const user = checkMe?.user ?? null;
      const hasUsername = user && user.username;

      // If no username, prompt immediately
      if (!hasUsername) {
        console.log("[ConnectWallet] No username found, prompting...");
        setAskUsername(true);
        setHasPrompted(true);
        return;
      }
    } catch (e: any) {
      console.error("[ConnectWallet] Error in signInIfNeeded:", e);
      // If user cancelled, just open menu
      if (!e?.message?.includes("User rejected") && !e?.message?.includes("User cancelled")) {
        // For other errors, DO NOT prompt
        console.warn("[ConnectWallet] Manual sign-in failed, suppressing username prompt");
        setHasPrompted(true);
        return;
      }
    }
    // Open menu (allows disconnect even without username)
    setMenuOpen(v => !v);
  };

  // Reset hasPrompted when wallet disconnects
  useEffect(() => {
    if (!connected) {
      setHasPrompted(false);
      setMenuOpen(false);
    }
  }, [connected]);

  const label = !connected
    ? "connect wallet"
    : (username ? `@${username}` : (publicKey ? shorten(publicKey.toBase58()) : (wallet?.adapter?.name || "wallet")));

  const available = wallets
    .filter((w: any) =>
      w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable
    )
    .filter((w: any) => w.adapter.name === "Phantom");

  // Debug: log wallet states (expanded to show full object)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const states = {
        connected,
        connecting,
        publicKey: publicKey?.toBase58(),
        wallet: wallet?.adapter?.name,
        walletsCount: wallets?.length,
        availableCount: available.length,
        wallets: wallets?.map((w: any) => ({
          name: w.adapter?.name,
          readyState: w.readyState,
          installed: w.readyState === WalletReadyState.Installed
        }))
      };
      console.log("[ConnectWallet] Wallet states:", JSON.stringify(states, null, 2));

      // Log when connection state changes
      if (connected) {
        console.log("[ConnectWallet] ✅ Wallet connected!", publicKey?.toBase58());
      } else if (connecting) {
        console.log("[ConnectWallet] ⏳ Connecting...");
      }
    }
  }, [connected, connecting, publicKey, wallet, wallets, available]);

  // Listen for wallet connection events
  useEffect(() => {
    if (!wallet?.adapter) return;

    const handleConnect = () => {
      console.log("[ConnectWallet] 🔌 Wallet adapter connect event fired");
    };

    const handleDisconnect = () => {
      console.log("[ConnectWallet] 🔌 Wallet adapter disconnect event fired");
    };

    const handleError = (error: any) => {
      console.error("[ConnectWallet] ❌ Wallet adapter error:", error);
    };

    wallet.adapter.on?.("connect", handleConnect);
    wallet.adapter.on?.("disconnect", handleDisconnect);
    wallet.adapter.on?.("error", handleError);

    return () => {
      wallet.adapter.off?.("connect", handleConnect);
      wallet.adapter.off?.("disconnect", handleDisconnect);
      wallet.adapter.off?.("error", handleError);
    };
  }, [wallet]);

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="default"
        onClick={onPrimaryClick}
        className={`font-black flex items-center gap-2 text-sm sm:text-base relative text-white ${className || ""}`}
        disabled={connecting}
        aria-busy={connecting}
      >
        <img src={lightbulbIcon} alt="" className="w-6 h-6 sm:w-7 sm:h-7" />
        {label}
        {connected && claimableCount > 0 && (
          <span className="absolute -top-2 -right-2 inline-flex items-center justify-center rounded-full bg-brand-yes text-black text-[10px] font-black px-2 py-[2px] leading-none">
            {claimableCount}
          </span>
        )}
      </Button>

      {connected && menuOpen && (
        <div className="absolute right-0 top-[110%] z-60 min-w-[200px] sm:min-w-[240px] bg-white dark:bg-[#1f1f1f] border border-[#ddd] dark:border-[#3a3a3a] rounded-lg shadow-[0_6px_24px_rgba(0,0,0,0.15)] overflow-hidden">
          {username && (
            <div className="px-3 py-2.5 border-b border-[#eee] dark:border-[#2a2a2a] text-sm font-semibold text-foreground break-all">
              @{username}
            </div>
          )}

          <button
            onClick={() => {
              setMenuOpen(false);
              if (publicKey) {
                navigate(`/profile/${publicKey.toBase58()}`);
              }
            }}
            className="w-full text-left px-3 py-2.5 border-b border-[#eee] dark:border-[#2a2a2a] font-semibold hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-sm sm:text-base"
          >
            my profile
          </button>

          {!username && (
            <>
              <button
                onClick={() => { setMenuOpen(false); setAskUsername(true); setHasPrompted(true); }}
                className="w-full text-left px-3 py-2.5 border-b border-[#eee] dark:border-[#2a2a2a] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-sm sm:text-base"
              >
                set username
              </button>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  try {
                    await signInIfNeeded();
                    window.dispatchEvent(new Event("username-refresh"));
                  } catch (e) {
                    console.error("Manual sign-in failed", e);
                  }
                }}
                className="w-full text-left px-3 py-2.5 border-b border-[#eee] dark:border-[#2a2a2a] text-blue-600 dark:text-blue-300 hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-sm sm:text-base"
              >
                sign in (fix stuck)
              </button>
            </>
          )}

          {available.length > 1 && (
            <div className="px-3 py-1.5 text-[10px] sm:text-[12px] opacity-70 border-b border-[#eee] dark:border-[#2a2a2a]">
              switch wallet
            </div>
          )}
          {available.map((w: any) => (
            <button
              key={w.adapter.name}
              onClick={async () => {
                setMenuOpen(false);
                try { await disconnect(); } catch (e) { console.error("Error disconnecting:", e); }
                forgetRemembered();
                try { select(w.adapter.name); } catch { /* Ignore selection errors */ }
                try { setVisible(true); } catch { /* Ignore modal errors */ }
              }}
              className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-sm sm:text-base"
            >
              {w.adapter.name}
            </button>
          ))}

          <div className="border-t border-[#eee] dark:border-[#2a2a2a]" />
          <button
            onClick={async () => {
              setMenuOpen(false);
              try {
                await disconnect();
                console.log("Wallet disconnected");
              } catch (e) {
                console.error("Error disconnecting wallet:", e);
                // Try force disconnect
                try {
                  if (wallet?.adapter?.disconnect) {
                    await wallet.adapter.disconnect();
                  }
                } catch (e2) {
                  console.error("Force disconnect also failed:", e2);
                }
              }
              forgetRemembered();
              await api("/auth/logout", { method: "POST" }).catch(() => { });
              setHasPrompted(false); // Reset prompt flag
            }}
            className="w-full text-left px-3 py-2.5 text-[#b00020] dark:text-red-300 hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-sm sm:text-base"
          >
            disconnect
          </button>
        </div>
      )}

      <UsernameModal
        open={askUsername}
        onOpenChange={(open) => {
          setAskUsername(open);
          // If closing and still no username, user might want to set it later
          if (!open && !username) {
            // Don't auto-open again immediately
          }
        }}
        onSubmitted={(u) => {
          setUsername(u);
          setHasPrompted(true); // Mark as prompted so we don't prompt again
          // Trigger refresh to ensure it's synced
          window.dispatchEvent(new Event("username-refresh"));
        }}
      />
    </div>
  );
}

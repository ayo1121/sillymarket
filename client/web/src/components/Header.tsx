import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import ConnectWalletAndUsername from "@/components/ConnectWalletAndUsername";
import logo from "@/assets/sillymarket-logo.jpeg";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { useNavigate, useLocation } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "@/solana/program";
import { fetchConfig } from "@/solana/read";
import { useMarketsCtx } from "@/hooks/marketsContext";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { Moon, SunMedium } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";

export const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const wallet = useWallet();
  const program = useAnchorProgram();
  const { hasClaimablePositions, claimableCount } = useMarketsCtx();
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!program || !wallet.publicKey) {
        if (isMounted) setIsAdmin(false);
        return;
      }
      try {
        const config = await fetchConfig(program);
        const authority = config?.authority || (config as any)?.authority;
        const authorityPk = authority?.toBase58 ? authority.toBase58() : authority?.toString?.();
        const userPk = wallet.publicKey.toBase58();
        if (isMounted) {
          setIsAdmin(Boolean(authorityPk && authorityPk === userPk));
        }
      } catch (err) {
        console.warn("[Header] failed to check admin", err);
        if (isMounted) setIsAdmin(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [program, wallet.publicKey]);

  return (
    <header className="bg-[#b8b8b8] dark:bg-[#1d1d1d] border-b-2 border-white/50 dark:border-[#2d2d2d] shadow-sm mb-6 sm:mb-8 sticky top-0 z-50 transition-colors">
      <div className="max-w-[1240px] mx-auto px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-y-2">

        {/* Left: Brand Block */}
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => navigate("/")}
            className="hover:opacity-90 transition-opacity flex-shrink-0 active:scale-95 duration-100"
            aria-label="Go to home page"
          >
            <div className="win95-sunken p-[2px] bg-white border border-[#8a8a8a] shadow-sm">
              <img src={logo} alt="sillymarket logo" className="w-8 h-8 sm:w-10 sm:h-10 object-cover" />
            </div>
          </button>

          {/* Vertical Separator */}
          <div className="w-[2px] h-6 sm:h-8 bg-[#8a8a8a]/30 rounded-full hidden sm:block" />

          <div className="flex flex-col justify-center">
            <h1 className="text-lg sm:text-xl font-black tracking-tighter leading-none text-[#111] dark:text-white mb-0.5">
              sillymarket
            </h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-[#5f5f5f] dark:text-[#cfcfcf] tracking-wide uppercase">
              silly bets, silly outcomes
            </p>
          </div>
        </div>

        {/* Right: Actions & Controls */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          {/* Navigation Buttons */}
          <div className="flex items-center gap-2">
            {/* MOBILE: Touch target optimized - min 44px height */}
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className={cn(
                "min-h-[44px] px-3 sm:px-4 font-bold text-xs sm:text-sm border-2 transition-all win95-btn-press",
                location.pathname === "/"
                  ? "bg-[#d4d4d4] dark:bg-[#2a2a2a] text-black dark:text-white border-[#8a8a8a] shadow-inner"
                  : "bg-[#e0e0e0] dark:bg-[#2a2a2a] text-[#111] dark:text-white border-white/60 hover:bg-white dark:hover:bg-[#3a3a3a] hover:border-white"
              )}
              aria-label="View all markets"
              aria-current={location.pathname === "/" ? "page" : undefined}
            >
              Markets
            </Button>

            {isAdmin && (
              <Button
                variant="ghost"
                onClick={() => navigate("/admin")}
                className="min-h-[44px] px-3 sm:px-4 font-bold text-xs sm:text-sm bg-[#e0e0e0] dark:bg-[#2a2a2a] text-[#111] dark:text-white border-2 border-white/60 hover:bg-white dark:hover:bg-[#3a3a3a] hover:border-white win95-btn-press"
                aria-label="Admin panel"
              >
                Admin
              </Button>
            )}

            type="button"
            onClick={toggleTheme}
            className="min-w-[44px] min-h-[44px] bg-[#d4d4d4] dark:bg-[#2a2a2a] border border-[#8a8a8a] dark:border-[#3a3a3a] hover:bg-white dark:hover:bg-[#3a3a3a] flex items-center justify-center text-[#111] dark:text-white shadow-sm active:translate-y-[1px] rounded-sm"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <SunMedium className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Window Controls (Visual Only) - Hidden on mobile */}
          <div className="hidden sm:flex gap-1 pl-3 border-l-2 border-[#8a8a8a]/20">
            <button className="w-5 h-5 bg-[#d4d4d4] dark:bg-[#2a2a2a] border border-[#8a8a8a] dark:border-[#3a3a3a] hover:bg-white dark:hover:bg-[#3a3a3a] flex items-center justify-center text-[8px] font-black text-[#111] dark:text-white shadow-sm active:translate-y-[1px]">
              _
            </button>
            <button className="w-5 h-5 bg-[#d4d4d4] dark:bg-[#2a2a2a] border border-[#8a8a8a] dark:border-[#3a3a3a] hover:bg-white dark:hover:bg-[#3a3a3a] flex items-center justify-center font-black text-[#111] dark:text-white text-[9px] shadow-sm active:translate-y-[1px]">
              □
            </button>
            <button className="w-5 h-5 bg-[#e64545] border border-[#8a8a8a] dark:border-[#3a3a3a] hover:bg-[#ff6b6b] flex items-center justify-center font-black text-white text-[10px] shadow-sm active:translate-y-[1px]">
              ×
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Divider Line */}
      <div className="h-[1px] bg-[#8a8a8a] w-full opacity-30" />
    </header>
  );
};

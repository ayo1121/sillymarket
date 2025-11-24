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

export const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const wallet = useWallet();
  const program = useAnchorProgram();
  const { hasClaimablePositions, claimableCount } = useMarketsCtx();
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
    <header className="bg-[#b8b8b8] border-b-2 border-white/50 shadow-sm mb-8 sticky top-0 z-50">
      <div className="max-w-[1240px] mx-auto px-4 py-3 flex items-center justify-between">

        {/* Left: Brand Block */}
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/")} className="hover:opacity-90 transition-opacity flex-shrink-0 active:scale-95 duration-100">
            <div className="win95-sunken p-[2px] bg-white border border-[#8a8a8a] shadow-sm">
              <img src={logo} alt="sillymarket" className="w-10 h-10 object-cover" />
            </div>
          </button>

          {/* Vertical Separator */}
          <div className="w-[2px] h-8 bg-[#8a8a8a]/30 rounded-full" />

          <div className="flex flex-col justify-center">
            <h1 className="text-xl font-black tracking-tighter leading-none text-[#111] mb-0.5">
              sillymarket
            </h1>
            <p className="text-[10px] font-bold text-[#5f5f5f] tracking-wide uppercase">
              the silliest outcome
            </p>
          </div>
        </div>

        {/* Right: Actions & Controls */}
        <div className="flex items-center gap-3">
          {/* Navigation Buttons */}
          <div className="flex items-center gap-2 mr-2">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className={cn(
                "h-9 px-4 font-bold text-sm border-2 transition-all win95-btn-press",
                location.pathname === "/"
                  ? "bg-[#d4d4d4] text-black border-[#8a8a8a] shadow-inner"
                  : "bg-[#e0e0e0] text-[#111] border-white/60 hover:bg-white hover:border-white"
              )}
            >
              Markets
            </Button>

            {isAdmin && (
              <Button
                variant="ghost"
                onClick={() => navigate("/admin")}
                className="h-9 px-4 font-bold text-sm bg-[#e0e0e0] text-[#111] border-2 border-white/60 hover:bg-white hover:border-white win95-btn-press"
              >
                Admin
              </Button>
            )}

            {/* Connect Wallet - Primary Action */}
            <div className="win95-btn-press">
              <ConnectWalletAndUsername claimableCount={claimableCount} />
            </div>
          </div>

          {/* Window Controls (Visual Only) */}
          <div className="flex gap-1 pl-3 border-l-2 border-[#8a8a8a]/20">
            <button className="w-5 h-5 bg-[#d4d4d4] border border-[#8a8a8a] hover:bg-white flex items-center justify-center text-[8px] font-black text-[#111] shadow-sm active:translate-y-[1px]">
              _
            </button>
            <button className="w-5 h-5 bg-[#d4d4d4] border border-[#8a8a8a] hover:bg-white flex items-center justify-center font-black text-[#111] text-[9px] shadow-sm active:translate-y-[1px]">
              □
            </button>
            <button className="w-5 h-5 bg-[#e64545] border border-[#8a8a8a] hover:bg-[#ff6b6b] flex items-center justify-center font-black text-white text-[10px] shadow-sm active:translate-y-[1px]">
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

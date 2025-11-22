import { Button } from "@/components/ui/button";
import ConnectWalletAndUsername from "@/components/ConnectWalletAndUsername";
import logo from "@/assets/sillymarket-logo.jpeg";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { useNavigate, useLocation } from "react-router-dom";

export const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return <header className="win95-window bg-background p-1 mb-8">
    <div className="bg-primary text-primary-foreground px-3 py-2 flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        <span className="text-base font-black">sillymarket.fun</span>
      </div>
      <div className="flex gap-1">
        <button className="w-4 h-4 win95-raised bg-background hover:win95-sunken flex items-center justify-center text-[8px] font-black text-neutral-950">
          _
        </button>
        <button className="w-4 h-4 win95-raised bg-background hover:win95-sunken flex items-center justify-center font-black text-neutral-950 text-xs">
          □
        </button>
        <button className="w-4 h-4 win95-raised bg-background hover:win95-sunken flex items-center justify-center font-black text-neutral-950 text-xs">
          ×
        </button>
      </div>
    </div>

    <div className="win95-sunken bg-background p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3 sm:gap-6 w-full sm:w-auto">
          <button onClick={() => navigate("/")} className="hover:opacity-80 transition-all cursor-pointer flex-shrink-0">
            <div className="win95-sunken p-1 bg-input flex-shrink-0" style={{ borderColor: 'hsl(var(--primary))' }}>
              <img src={logo} alt="sillymarket" className="w-14 h-14 sm:w-20 sm:h-20 object-cover" />
            </div>
          </button>
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-5xl font-black mb-1 sm:mb-2 tracking-tight">sillymarket</h1>
            <p className="text-xs sm:text-sm text-muted-foreground font-bold tracking-wide">bet on the silliest outcomes.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-center w-full sm:w-auto">
          <Button variant={location.pathname === "/" ? "primary" : "default"} onClick={() => navigate("/")} className="font-black flex items-center gap-2 text-sm sm:text-base">
            <img src={lightbulbIcon} alt="" className="w-6 h-6 sm:w-7 sm:h-7" />
            markets
          </Button>
          <Button variant={location.pathname === "/my-bets" ? "primary" : "default"} onClick={() => navigate("/my-bets")} className="font-black flex items-center gap-2 text-sm sm:text-base">
            <img src={lightbulbIcon} alt="" className="w-6 h-6 sm:w-7 sm:h-7" />
            my bets
          </Button>
          <ConnectWalletAndUsername />
        </div>
      </div>
    </div>
  </header>;
};

import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { useWalletIdentity } from "@/auth/walletIdentity";

interface Market {
  id: string;
  question: string;
  endDate: string;
}

// Simplified notifications - only checks market closing times
// Note: Bet tracking would require backend API endpoint to fetch user's bets
export const useNotifications = (markets: Market[]) => {
  const { isAuthenticated } = useWalletIdentity();

  useEffect(() => {
    if (!isAuthenticated) return;

      const checkMarketClosing = () => {
        const now = new Date();
        
        markets.forEach((market) => {
          const endDate = new Date(market.endDate);
          const timeUntilClose = endDate.getTime() - now.getTime();
          const hoursUntilClose = timeUntilClose / (1000 * 60 * 60);
          
          // Notify if market closes within 1 hour and hasn't closed yet
          if (hoursUntilClose > 0 && hoursUntilClose < 1) {
            const minutesLeft = Math.floor((timeUntilClose / (1000 * 60)) % 60);
            toast({
            title: "Market Closing Soon! ⏰",
              description: `"${market.question}" closes in ${minutesLeft} minutes`,
            });
          }
        });
      };

      // Check immediately and then every 5 minutes
      checkMarketClosing();
      const interval = setInterval(checkMarketClosing, 5 * 60 * 1000);

      return () => clearInterval(interval);
  }, [markets, isAuthenticated]);
};

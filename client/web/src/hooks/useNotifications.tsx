import { useEffect, useRef } from "react";
import { useNotificationsContext } from "@/contexts/NotificationsContext";

interface Market {
  id: string;
  pubkey: string;
  question: string;
  cutoffTs: number;
}

/**
 * Hook to detect markets closing soon and create notifications
 * 
 * TODO: Backend integration needed for "followed markets" feature
 * - API endpoint: GET /api/users/:wallet/followed-markets
 * - Returns: { markets: string[] } // Array of market pubkeys
 * - For now, checks ALL markets (can be noisy)
 * 
 * TODO: Backend API endpoints needed:
 * - POST /api/users/:wallet/followed-markets
 *   Body: { marketPubkey: string }
 * - DELETE /api/users/:wallet/followed-markets/:marketPubkey
 * 
 * Once available, update this hook to only check followed markets.
 */
export const useNotifications = (markets: Market[]) => {
  const { addNotification } = useNotificationsContext();
  const notifiedMarkets = useRef(new Set<string>());

  useEffect(() => {
    const checkMarketClosing = () => {
      const now = Date.now();

      markets.forEach((market) => {
        const cutoffMs = market.cutoffTs * 1000;
        const timeUntilClose = cutoffMs - now;
        const hoursUntilClose = timeUntilClose / (1000 * 60 * 60);

        // Notify if market closes within 1 hour and hasn't been notified
        if (
          hoursUntilClose > 0 &&
          hoursUntilClose < 1 &&
          !notifiedMarkets.current.has(market.pubkey)
        ) {
          const minutesLeft = Math.floor((timeUntilClose / (1000 * 60)) % 60);

          // TODO: Only notify for followed markets once backend API is available
          // For now, this will notify for ALL markets closing soon
          addNotification({
            type: "market_closing",
            title: "Market Closing Soon! ⏰",
            message: `"${market.question}" closes in ${minutesLeft} minutes`,
            marketId: market.pubkey,
            actionUrl: `/market/${market.id}`,
          });

          notifiedMarkets.current.add(market.pubkey);
        }
      });
    };

    // Check immediately and then every 5 minutes
    checkMarketClosing();
    const interval = setInterval(checkMarketClosing, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [markets, addNotification]);
};

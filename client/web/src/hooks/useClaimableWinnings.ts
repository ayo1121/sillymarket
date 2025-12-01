import { useEffect, useRef } from "react";
import { useMarketsCtx } from "./marketsContext";
import { useNotificationsContext } from "@/contexts/NotificationsContext";

/**
 * Hook to detect claimable winnings and create notifications
 * 
 * Checks user's positions for claimable winnings and notifies when found.
 * Prevents duplicate notifications by tracking previously notified positions.
 * 
 * TODO: Backend integration for real-time notifications
 * - WebSocket or Server-Sent Events for instant notifications
 * - Push notifications via service worker
 * - Endpoint: GET /api/users/:wallet/claimable-positions
 */
export const useClaimableWinnings = () => {
    const { positions, hasClaimablePositions, claimableCount } = useMarketsCtx();
    const { addNotification } = useNotificationsContext() as any;
    const notifiedPositions = useRef(new Set<string>());

    useEffect(() => {
        if (!hasClaimablePositions || claimableCount === 0) {
            return;
        }

        // Find claimable positions that haven't been notified yet
        const claimablePositions = positions.filter(
            (pos: any) => pos.canClaim && !notifiedPositions.current.has(pos.marketPubkey)
        );

        if (claimablePositions.length === 0) {
            return;
        }

        // Create notification for claimable winnings
        addNotification({
            type: "claimable_winnings",
            title: "Winnings Available! 🎉",
            message:
                claimablePositions.length === 1
                    ? "You have winnings to claim from a resolved market"
                    : `You have winnings to claim from ${claimablePositions.length} markets`,
            actionUrl: "/my-bets",
        });

        // Mark positions as notified
        claimablePositions.forEach((pos: any) => {
            notifiedPositions.current.add(pos.marketPubkey);
        });
    }, [positions, hasClaimablePositions, claimableCount, addNotification]);
};

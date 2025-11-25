import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabaseClient } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Real-Time Market Updates Hook
 * 
 * Subscribes to Supabase realtime for bet updates and refreshes market data.
 * Falls back to periodic polling if real-time connection fails.
 * 
 * Features:
 * - Supabase realtime subscription to 'bets' table
 * - Automatic cache invalidation on new bets
 * - Graceful fallback to 60s polling
 * - Visibility-aware polling (pauses when page hidden)
 * - Connection status tracking
 * 
 * TODO: WebSocket integration for direct market updates
 * When backend WebSocket is available, replace Supabase subscription with:
 * 
 * WebSocket URL: wss://api.example.com/markets/live
 * 
 * Message format:
 * {
 *   type: 'bet_placed' | 'market_resolved' | 'probability_changed',
 *   marketId: string,
 *   data: {...}
 * }
 * 
 * Events to handle:
 * - bet_placed: Update specific market probabilities
 * - market_resolved: Invalidate and refetch market
 * - probability_changed: Update probabilities in real-time
 * 
 * Example WebSocket implementation:
 * ```typescript
 * const ws = new WebSocket('wss://api.example.com/markets/live');
 * 
 * ws.onmessage = (event) => {
 *   const data = JSON.parse(event.data);
 *   
 *   switch (data.type) {
 *     case 'bet_placed':
 *       queryClient.setQueryData(
 *         queryKeys.markets.detail(data.marketId),
 *         (old) => ({ ...old, ...data.updates })
 *       );
 *       break;
 *       
 *     case 'market_resolved':
 *       queryClient.invalidateQueries({
 *         queryKey: queryKeys.markets.detail(data.marketId)
 *       });
 *       break;
 *       
 *     case 'probability_changed':
 *       queryClient.setQueryData(
 *         queryKeys.markets.detail(data.marketId),
 *         (old) => ({ ...old, outcomes: data.outcomes })
 *       );
 *       break;
 *   }
 * };
 * 
 * ws.onerror = () => {
 *   setIsConnected(false);
 *   startFallbackPolling();
 * };
 * ```
 */
export const useLiveMarketUpdates = (enabled: boolean = true) => {
    const queryClient = useQueryClient();
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Start fallback polling if real-time fails
    const startFallbackPolling = () => {
        if (fallbackIntervalRef.current) return; // Already polling

        console.log('[LiveUpdates] Starting fallback polling (60s interval)');

        const poll = () => {
            // Only poll if page is visible
            if (document.visibilityState === 'visible') {
                console.log('[LiveUpdates] Fallback poll - invalidating markets');
                queryClient.invalidateQueries({ queryKey: queryKeys.markets.all });
            }
        };

        // Poll every 60 seconds (less aggressive than real-time)
        fallbackIntervalRef.current = setInterval(poll, 60 * 1000);
    };

    // Stop fallback polling
    const stopFallbackPolling = () => {
        if (fallbackIntervalRef.current) {
            console.log('[LiveUpdates] Stopping fallback polling');
            clearInterval(fallbackIntervalRef.current);
            fallbackIntervalRef.current = null;
        }
    };

    useEffect(() => {
        if (!enabled) return;

        console.log('[LiveUpdates] Initializing Supabase realtime subscription');

        // Supabase realtime subscription for bet updates
        const channel = supabaseClient
            .channel('bets-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'bets',
                },
                async (payload) => {
                    console.log('[LiveUpdates] New bet detected:', payload.new);

                    // Invalidate markets query to trigger refetch
                    queryClient.invalidateQueries({ queryKey: queryKeys.markets.all });

                    // Optionally: Update specific market in cache
                    const marketPubkey = (payload.new as any).market_pubkey;
                    if (marketPubkey) {
                        queryClient.invalidateQueries({
                            queryKey: queryKeys.markets.detail(marketPubkey)
                        });
                    }
                }
            )
            .subscribe((status) => {
                console.log('[LiveUpdates] Subscription status:', status);

                if (status === 'SUBSCRIBED') {
                    setIsConnected(true);
                    setError(null);
                    // Clear fallback polling when connected
                    stopFallbackPolling();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    setIsConnected(false);
                    setError('Real-time connection failed');
                    // Start fallback polling
                    startFallbackPolling();
                }
            });

        // Cleanup
        return () => {
            console.log('[LiveUpdates] Cleaning up subscription');
            channel.unsubscribe();
            stopFallbackPolling();
        };
    }, [enabled, queryClient]);

    // Handle page visibility changes
    useEffect(() => {
        if (!enabled) return;

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && fallbackIntervalRef.current) {
                console.log('[LiveUpdates] Page hidden - pausing fallback polling');
                stopFallbackPolling();
            } else if (document.visibilityState === 'visible' && !isConnected) {
                console.log('[LiveUpdates] Page visible - resuming fallback polling');
                startFallbackPolling();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isConnected, enabled]);

    return { isConnected, error };
};

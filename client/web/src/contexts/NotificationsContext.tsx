import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "@/solana/program";
import { fetchUserPositions, fetchMarketsBatch } from "@/solana/read";
import { supabase } from "@/integrations/supabase/client";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type NotificationType = 'claimable_winnings' | 'market_closing' | 'market_resolved';

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    marketId?: string;
    timestamp: number;
    read: boolean;
    actionUrl?: string;
}

interface NotificationsContextValue {
    notifications: Notification[];
    unreadCount: number;
    fetchNotifications: () => Promise<void>;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    removeNotification: (id: string) => void;
    clearAll: () => void;
    isLoading: boolean;
    error: string | null;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

/**
 * Notifications Provider
 * 
 * Fetches notifications from backend and manages local state.
 * Falls back to empty state if backend is unavailable.
 */
export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
    const { publicKey } = useWallet();
    const program = useAnchorProgram();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Generate and store notifications in Supabase
    const fetchNotifications = useCallback(async () => {
        if (!publicKey || !program) {
            setNotifications([]);
            setUnreadCount(0);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const walletAddress = publicKey.toBase58();

            // Fetch user positions
            const positions = await fetchUserPositions(program as any, publicKey);

            if (positions.length === 0) {
                // Still fetch existing notifications from Supabase
                const { data: existingNotifs } = await supabase
                    .from('notifications')
                    .select('*')
                    .eq('user_pubkey', walletAddress)
                    .order('created_at', { ascending: false });

                const mapped = (existingNotifs || []).map((n: any) => ({
                    id: n.id,
                    type: n.type,
                    title: n.title,
                    message: n.body || '',
                    marketId: n.metadata?.market_id,
                    timestamp: new Date(n.created_at).getTime(),
                    read: n.is_read,
                    actionUrl: `/market/${n.metadata?.market_id}`,
                }));

                setNotifications(mapped);
                setUnreadCount(mapped.filter(n => !n.read).length);
                setIsLoading(false);
                return;
            }

            // Fetch all notifications for this user
            const { data: allNotifs } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_pubkey', walletAddress)
                .order('created_at', { ascending: false })
                .limit(50);

            const mapped = (allNotifs || []).map((n: any) => ({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.body || '',
                marketId: n.metadata?.market_id,
                timestamp: new Date(n.created_at).getTime(),
                read: n.is_read,
                actionUrl: `/market/${n.metadata?.market_id}`,
            }));

            // Sort by priority
            const priorityOrder: Record<string, number> = { 'claimable_winnings': 0, 'market_closing': 1, 'market_resolved': 2 };
            mapped.sort((a, b) => (priorityOrder[a.type] || 999) - (priorityOrder[b.type] || 999));

            setNotifications(mapped);
            setUnreadCount(mapped.filter(n => !n.read).length);
        } catch (err) {
            console.error('[Notifications] Failed to generate:', err);
            setError('Failed to load notifications');
        } finally {
            setIsLoading(false);
        }
    }, [publicKey, program]);

    // Fetch on mount and when wallet/program changes
    useEffect(() => {
        fetchNotifications();

        // Refresh every 2 minutes
        const interval = setInterval(fetchNotifications, 2 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchNotifications, program]);

    // Realtime subscription for new notifications
    useEffect(() => {
        if (!publicKey) return;

        const setupRealtimeSubscription = async () => {
            try {
                const { useRealtimeNotifications } = await import("@/hooks/useRealtimeSubscription");

                // This will be called when a new notification arrives
                const handleNewNotification = (newNotif: any) => {
                    console.log("[Notifications] Realtime notification received:", newNotif);

                    const mapped = {
                        id: newNotif.id,
                        type: newNotif.type,
                        title: newNotif.title,
                        message: newNotif.body || '',
                        marketId: newNotif.metadata?.market_id,
                        timestamp: new Date(newNotif.created_at).getTime(),
                        read: newNotif.is_read,
                        actionUrl: `/market/${newNotif.metadata?.market_id}`,
                    };

                    // Add to notifications list
                    setNotifications((prev) => [mapped, ...prev]);
                    setUnreadCount((prev) => prev + 1);

                    // Show toast notification (optional)
                    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                        new Notification(newNotif.title, {
                            body: newNotif.body || '',
                            icon: '/favicon.ico',
                        });
                    }
                };

                // Note: useRealtimeNotifications is a hook, so we can't call it here
                // Instead, we'll set up the subscription manually
                const userPubkey = publicKey.toBase58();
                const channel = supabase
                    .channel(`notifications:${userPubkey}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'INSERT',
                            schema: 'public',
                            table: 'notifications',
                            filter: `user_pubkey=eq.${userPubkey}`,
                        },
                        (payload) => {
                            handleNewNotification(payload.new);
                        }
                    )
                    .subscribe();

                return () => {
                    supabase.removeChannel(channel);
                };
            } catch (err) {
                console.error("[Notifications] Failed to set up realtime subscription:", err);
            }
        };

        const cleanup = setupRealtimeSubscription();
        return () => {
            cleanup.then((fn) => fn?.());
        };
    }, [publicKey]);

    // Mark notification as read
    const markAsRead = useCallback(async (id: string) => {
        try {
            // Update in Supabase
            await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('id', id);

            // Update local state optimistically
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, read: true } : n))
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
            console.error('[Notifications] Failed to mark as read:', err);
            // Still update local state for better UX
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, read: true } : n))
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        }
    }, []);

    // Mark all as read
    const markAllAsRead = useCallback(async () => {
        if (!publicKey) return;

        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);

        // Update local state immediately
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);

        // Update in Supabase
        if (unreadIds.length > 0) {
            try {
                await supabase
                    .from('notifications')
                    .update({ is_read: true })
                    .eq('user_pubkey', publicKey.toBase58())
                    .in('id', unreadIds);
            } catch (err) {
                console.error('[Notifications] Failed to mark all as read:', err);
            }
        }
    }, [notifications, publicKey]);

    // Remove notification (local only)
    const removeNotification = useCallback((id: string) => {
        setNotifications((prev) => {
            const notification = prev.find((n) => n.id === id);
            const newNotifications = prev.filter((n) => n.id !== id);

            if (notification && !notification.read) {
                setUnreadCount((count) => Math.max(0, count - 1));
            }

            return newNotifications;
        });
    }, []);

    // Clear all (local only)
    const clearAll = useCallback(() => {
        setNotifications([]);
        setUnreadCount(0);
    }, []);

    const value: NotificationsContextValue = {
        notifications,
        unreadCount,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        removeNotification,
        clearAll,
        isLoading,
        error,
    };

    return (
        <NotificationsContext.Provider value={value}>
            {children}
        </NotificationsContext.Provider>
    );
};

/**
 * Hook to access notifications context
 */
export const useNotificationsContext = () => {
    const context = useContext(NotificationsContext);
    if (!context) {
        throw new Error("useNotificationsContext must be used within NotificationsProvider");
    }
    return context;
};

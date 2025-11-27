import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

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
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch notifications from backend
    const fetchNotifications = useCallback(async () => {
        if (!publicKey) {
            setNotifications([]);
            setUnreadCount(0);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_URL}/notifications`, {
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error('Failed to fetch notifications');
            }

            const data = await response.json();
            const backendNotifications = data.notifications.map((n: any) => ({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.body || '',
                marketId: n.metadata?.market_id,
                timestamp: new Date(n.created_at).getTime(),
                read: n.is_read,
                actionUrl: n.metadata?.action_url,
            }));

            setNotifications(backendNotifications);
            setUnreadCount(backendNotifications.filter((n: Notification) => !n.read).length);
        } catch (err) {
            console.error('[Notifications] Failed to fetch:', err);
            setError('Failed to load notifications');
            // Graceful degradation - keep existing notifications
        } finally {
            setIsLoading(false);
        }
    }, [publicKey]);

    // Fetch on mount and when wallet changes
    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    // Mark notification as read
    const markAsRead = useCallback(async (id: string) => {
        try {
            const response = await fetch(`${API_URL}/notifications/mark-read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ id }),
            });

            if (!response.ok) {
                throw new Error('Failed to mark as read');
            }

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
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);

        // Update local state immediately
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);

        // Send requests to backend
        for (const id of unreadIds) {
            try {
                await fetch(`${API_URL}/notifications/mark-read`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify({ id }),
                });
            } catch (err) {
                console.error('[Notifications] Failed to mark as read:', id, err);
            }
        }
    }, [notifications]);

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

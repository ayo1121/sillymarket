import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
    addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
    markAsRead: (id: string) => void;
    markAllAsRead: () => void;
    removeNotification: (id: string) => void;
    clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

/**
 * Notifications Provider
 * 
 * Manages notification state using React Context (no external dependencies).
 * Stores up to 50 most recent notifications.
 */
export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
        const newNotification: Notification = {
            ...notification,
            id: `${Date.now()}-${Math.random()}`,
            timestamp: Date.now(),
            read: false,
        };

        setNotifications((prev) => [newNotification, ...prev].slice(0, 50)); // Keep last 50
        setUnreadCount((prev) => prev + 1);
    }, []);

    const markAsRead = useCallback((id: string) => {
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
    }, []);

    const markAllAsRead = useCallback(() => {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
    }, []);

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

    const clearAll = useCallback(() => {
        setNotifications([]);
        setUnreadCount(0);
    }, []);

    const value: NotificationsContextValue = {
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        removeNotification,
        clearAll,
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

import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Offline Indicator Component
 * 
 * Shows banner when network is unavailable.
 * Automatically hides when connection restored.
 * 
 * Features:
 * - Detects online/offline status
 * - Shows "You're offline" banner
 * - Shows "Back online" confirmation (3 seconds)
 * - Win95 styling
 */
export const OfflineIndicator = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [wasOffline, setWasOffline] = useState(false);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            // Show "Back online" message briefly
            setTimeout(() => setWasOffline(false), 3000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setWasOffline(true);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    if (isOnline && !wasOffline) return null;

    return (
        <div
            className={cn(
                'fixed top-0 left-0 right-0 z-50 px-4 py-3 text-center font-bold text-sm transition-all shadow-lg',
                isOnline
                    ? 'bg-green-600 text-white'
                    : 'bg-orange-600 text-white'
            )}
        >
            <div className="flex items-center justify-center gap-2">
                {isOnline ? (
                    <>
                        <Wifi className="w-4 h-4" />
                        <span>Back online</span>
                    </>
                ) : (
                    <>
                        <WifiOff className="w-4 h-4" />
                        <span>You're offline - Some features may be limited</span>
                    </>
                )}
            </div>
        </div>
    );
};

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Custom hook for pull-to-refresh functionality on mobile devices.
 * 
 * MOBILE FEATURE: Pull-to-refresh implementation
 * - Tracks touch events and scroll position
 * - Calculates pull distance and triggers refresh callback
 * - Returns state for visual feedback
 * 
 * @param onRefresh - Async callback to execute when refresh is triggered
 * @param threshold - Distance in pixels to trigger refresh (default: 80)
 * @returns Object with isPulling, pullDistance, and isRefreshing states
 */
export const usePullToRefresh = (
    onRefresh: () => Promise<void>,
    threshold: number = 80
) => {
    const [isPulling, setIsPulling] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const touchStartY = useRef<number>(0);
    const containerRef = useRef<HTMLElement | null>(null);

    const handleTouchStart = useCallback((e: TouchEvent) => {
        // Only start tracking if we're at the top of the scroll container
        const target = e.target as HTMLElement;
        const scrollContainer = target.closest('[data-pull-to-refresh]') as HTMLElement;

        if (!scrollContainer) return;

        containerRef.current = scrollContainer;

        // Check if we're at the top
        if (scrollContainer.scrollTop === 0) {
            touchStartY.current = e.touches[0].clientY;
            setIsPulling(true);
        }
    }, []);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!isPulling || !containerRef.current) return;

        const currentY = e.touches[0].clientY;
        const distance = currentY - touchStartY.current;

        // If we scrolled down (distance < 0) or container is not at top anymore, cancel
        if (containerRef.current.scrollTop > 0 || distance < 0) {
            setIsPulling(false);
            setPullDistance(0);
            return;
        }

        // Only treat as pull if distance > 40
        if (distance > 40) {
            const resistanceFactor = 0.5;
            const adjustedDistance = (distance - 40) * resistanceFactor;
            setPullDistance(Math.min(adjustedDistance, threshold * 1.5));

            // Prevent default scrolling only when we are sure it's a pull
            if (e.cancelable) {
                e.preventDefault();
            }
        }
    }, [isPulling, threshold]);

    const handleTouchEnd = useCallback(async () => {
        if (!isPulling) return;

        setIsPulling(false);

        // Trigger refresh if pulled past threshold
        if (pullDistance >= threshold && !isRefreshing) {
            setIsRefreshing(true);
            try {
                await onRefresh();
            } catch (error) {
                console.error('Pull-to-refresh error:', error);
            } finally {
                setIsRefreshing(false);
                setPullDistance(0);
            }
        } else {
            setPullDistance(0);
        }
    }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh]);

    useEffect(() => {
        // Only add listeners on touch devices
        if (!('ontouchstart' in window)) return;

        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

    return {
        isPulling,
        pullDistance,
        isRefreshing,
    };
};

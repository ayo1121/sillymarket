import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for detecting horizontal swipe gestures on mobile devices.
 * 
 * MOBILE FEATURE: Swipe gesture implementation
 * - Detects left/right swipe on touch devices
 * - Prevents conflicts with vertical scrolling
 * - Configurable threshold and velocity detection
 * 
 * @param onSwipeLeft - Callback when user swipes left
 * @param onSwipeRight - Callback when user swipes right
 * @param threshold - Minimum distance in pixels to trigger swipe (default: 50)
 * @param velocityThreshold - Minimum velocity to trigger swipe (default: 0.3)
 */
export const useSwipeGesture = (
    onSwipeLeft?: () => void,
    onSwipeRight?: () => void,
    threshold: number = 50,
    velocityThreshold: number = 0.3
) => {
    const touchStartX = useRef<number>(0);
    const touchStartY = useRef<number>(0);
    const touchStartTime = useRef<number>(0);
    const isSwiping = useRef<boolean>(false);

    const handleTouchStart = useCallback((e: TouchEvent) => {
        const target = e.target as HTMLElement;

        // Don't interfere with swipeable elements or scrollable containers
        if (target.closest('[data-no-swipe]')) return;

        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchStartTime.current = Date.now();
        isSwiping.current = false;
    }, []);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!touchStartX.current) return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        const deltaX = currentX - touchStartX.current;
        const deltaY = currentY - touchStartY.current;

        // Determine if this is a horizontal or vertical gesture
        const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

        if (isHorizontal && Math.abs(deltaX) > 10) {
            isSwiping.current = true;
            // Prevent vertical scrolling during horizontal swipe
            e.preventDefault();
        }
    }, []);

    const handleTouchEnd = useCallback((e: TouchEvent) => {
        if (!isSwiping.current) return;

        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const touchEndTime = Date.now();

        const deltaX = touchEndX - touchStartX.current;
        const deltaY = touchEndY - touchStartY.current;
        const deltaTime = touchEndTime - touchStartTime.current;

        // Calculate velocity (pixels per millisecond)
        const velocity = Math.abs(deltaX) / deltaTime;

        // Check if gesture is primarily horizontal
        const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

        if (isHorizontal && (Math.abs(deltaX) >= threshold || velocity >= velocityThreshold)) {
            if (deltaX > 0 && onSwipeRight) {
                // Swipe right
                onSwipeRight();
            } else if (deltaX < 0 && onSwipeLeft) {
                // Swipe left
                onSwipeLeft();
            }
        }

        // Reset
        touchStartX.current = 0;
        touchStartY.current = 0;
        touchStartTime.current = 0;
        isSwiping.current = false;
    }, [onSwipeLeft, onSwipeRight, threshold, velocityThreshold]);

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

    return null;
};

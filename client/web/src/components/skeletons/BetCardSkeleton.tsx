import { cn } from "@/lib/utils";

/**
 * Skeleton component for Bet Cards in MyBets page
 * Matches the layout of the actual bet card with shimmer animation
 */
export const BetCardSkeleton = ({ className }: { className?: string }) => {
    return (
        <div
            className={cn(
                "bg-[#f5f5f5] dark:bg-[#181818] border border-[#d3d3d3] dark:border-[#333] rounded-md shadow-sm p-4 sm:p-5",
                className
            )}
        >
            {/* Status Badge */}
            <div className="flex items-center justify-between mb-4">
                <div className="skeleton skeleton-text w-20 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                <div className="skeleton skeleton-text w-16 h-6 rounded bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
            </div>

            {/* Market Info */}
            <div className="flex flex-col sm:flex-row items-start gap-4 mb-4">
                {/* Image skeleton */}
                <div className="w-full sm:w-20 h-32 sm:h-20 rounded border border-[#d3d3d3] dark:border-[#333] skeleton bg-[#d0d0d0] dark:bg-[#2a2a2a] flex-shrink-0" />

                <div className="flex-1 min-w-0 space-y-2 w-full">
                    {/* Question */}
                    <div className="space-y-2">
                        <div className="skeleton skeleton-text w-full h-5 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-3/4 h-5 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>

                    {/* Meta info */}
                    <div className="flex flex-wrap gap-2">
                        <div className="skeleton skeleton-text w-20 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-24 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-28 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>
                </div>
            </div>

            {/* Bet Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded p-3 sm:p-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="space-y-1">
                        <div className="skeleton skeleton-text w-16 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-20 h-5 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * List of BetCard skeletons
 */
export const BetCardSkeletonList = ({ count = 5 }: { count?: number }) => {
    return (
        <div className="space-y-4">
            {Array.from({ length: count }).map((_, i) => (
                <BetCardSkeleton key={i} />
            ))}
        </div>
    );
};

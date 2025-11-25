import { cn } from "@/lib/utils";

/**
 * Skeleton component for MarketCard
 * Matches the layout of the actual MarketCard component with shimmer animation
 */
export const MarketCardSkeleton = ({ className }: { className?: string }) => {
    return (
        <div
            className={cn(
                "bg-[#e5e5e5] dark:bg-[#1f1f1f] p-3 sm:p-4 flex flex-col h-full",
                "border border-[#8a8a8a] dark:border-[#3a3a3a] rounded-[4px] shadow-[0_2px_4px_rgba(0,0,0,0.15)]",
                className
            )}
        >
            {/* Header: Image + Title */}
            <div className="flex gap-3 sm:gap-4 mb-4 sm:mb-5">
                {/* Image skeleton */}
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-[3px] overflow-hidden border border-[#8a8a8a] bg-[#d0d0d0] dark:bg-[#2a2a2a] skeleton flex-shrink-0" />

                {/* Title & Meta skeleton */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    <div className="space-y-2">
                        {/* Title lines */}
                        <div className="skeleton skeleton-text w-full bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-3/4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>

                    {/* Meta info */}
                    <div className="flex items-center gap-2 mt-2">
                        <div className="skeleton skeleton-text w-20 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-16 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-12 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>
                </div>
            </div>

            {/* Outcomes Grid skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-3 sm:mb-4 flex-1">
                {[1, 2].map((i) => (
                    <div
                        key={i}
                        className="border rounded-[4px] p-3 bg-[#f0f0f0] dark:bg-[#252525] border-[#c0c0c0] dark:border-[#3a3a3a]"
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className="skeleton skeleton-text w-16 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                            <div className="skeleton skeleton-text w-12 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        </div>
                        <div className="skeleton skeleton-text w-20 h-8 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>
                ))}
            </div>

            {/* Footer Stats skeleton */}
            <div className="border-t border-[#d4d4d4] dark:border-[#3a3a3a] pt-2 sm:pt-3 mt-auto">
                <div className="flex items-center justify-between text-xs">
                    <div className="skeleton skeleton-text w-24 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    <div className="skeleton skeleton-text w-20 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                </div>
            </div>
        </div>
    );
};

/**
 * Grid of MarketCard skeletons
 */
export const MarketCardSkeletonGrid = ({ count = 8 }: { count?: number }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: count }).map((_, i) => (
                <MarketCardSkeleton key={i} />
            ))}
        </div>
    );
};

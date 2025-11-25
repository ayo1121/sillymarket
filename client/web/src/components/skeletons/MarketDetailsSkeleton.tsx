import { cn } from "@/lib/utils";

/**
 * Skeleton component for MarketDetails page
 * Matches the layout of the actual market details view with shimmer animation
 */
export const MarketDetailsSkeleton = () => {
    return (
        <div className="min-h-screen bg-background text-foreground transition-colors">
            <main className="container mx-auto px-3 sm:px-4 py-6 max-w-6xl space-y-6">
                {/* Top Navigation Bar skeleton */}
                <div className="bg-[#d4d0c8] dark:bg-[#242424] border border-[#8b8b8b] dark:border-[#3a3a3a] rounded-sm shadow-[inset_1px_1px_0_rgba(255,255,255,0.8),inset_-1px_-1px_0_rgba(0,0,0,0.2)] px-3 py-2">
                    <div className="skeleton skeleton-text w-32 h-8 bg-[#c0c0c0] dark:bg-[#2a2a2a]" />
                </div>

                {/* Market Header Card skeleton */}
                <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-6">
                    {/* Status + Share Button */}
                    <div className="flex justify-between items-center mb-4 sm:mb-5">
                        <div className="skeleton skeleton-text w-24 h-7 rounded bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        <div className="skeleton skeleton-text w-20 h-8 rounded bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                    </div>

                    {/* Main Content Row */}
                    <div className="flex flex-col md:flex-row items-start gap-4 sm:gap-6">
                        {/* Image skeleton */}
                        <div className="hidden sm:block w-24 h-24 md:w-36 md:h-36 rounded border-2 border-[#8b8b8b] dark:border-[#3a3a3a] skeleton bg-[#d0d0d0] dark:bg-[#2a2a2a] flex-shrink-0" />

                        {/* Market Info */}
                        <div className="flex-1 min-w-0 w-full space-y-3">
                            {/* Title */}
                            <div className="space-y-2">
                                <div className="skeleton skeleton-text w-full h-8 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                <div className="skeleton skeleton-text w-3/4 h-8 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                            </div>

                            {/* Meta info */}
                            <div className="flex flex-wrap gap-2">
                                <div className="skeleton skeleton-text w-32 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                <div className="skeleton skeleton-text w-24 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                <div className="skeleton skeleton-text w-28 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                            </div>

                            {/* Description */}
                            <div className="mt-4 pt-4 border-t border-[#e0e0e0] dark:border-[#333] space-y-2">
                                <div className="skeleton skeleton-text w-full h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                <div className="skeleton skeleton-text w-full h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                <div className="skeleton skeleton-text w-2/3 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Two-Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column - Betting Panel skeleton */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5">
                            <div className="skeleton skeleton-text w-32 h-4 mb-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />

                            {/* Outcome cards */}
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <div
                                        key={i}
                                        className="border rounded-[4px] p-3 bg-[#f0f0f0] dark:bg-[#252525] border-[#c0c0c0] dark:border-[#3a3a3a]"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="skeleton skeleton-text w-20 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                            <div className="skeleton skeleton-text w-12 h-3 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                        </div>
                                        <div className="skeleton skeleton-text w-24 h-8 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right Column - Chart & Activity skeleton */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Chart skeleton */}
                        <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5">
                            <div className="skeleton skeleton-text w-40 h-4 mb-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                            <div className="skeleton w-full h-64 rounded bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                        </div>

                        {/* Activity skeleton */}
                        <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5">
                            <div className="skeleton skeleton-text w-32 h-4 mb-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                            <div className="space-y-2">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="flex items-center gap-3 p-2">
                                        <div className="skeleton skeleton-text w-16 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                        <div className="skeleton skeleton-text flex-1 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                        <div className="skeleton skeleton-text w-20 h-4 bg-[#d0d0d0] dark:bg-[#2a2a2a]" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

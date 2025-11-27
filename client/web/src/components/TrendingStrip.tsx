import React from 'react';
import { cn } from '@/lib/utils';
import { UIMarket } from '@/solana/marketMapping';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp, Flame } from 'lucide-react';
import { formatSol } from '@/utils/format';
import { logClick } from '@/lib/analytics';

interface TrendingStripProps {
    markets?: UIMarket[];
    className?: string;
}

export const TrendingStrip: React.FC<TrendingStripProps> = ({ markets = [], className }) => {
    const navigate = useNavigate();

    // Use top 5 markets by volume (sorted by parent)
    // No fallback mock data - show empty state if no markets
    const displayMarkets = markets.slice(0, 5);

    return (
        <div className={cn("w-full", className)}>
            <div className="flex items-center gap-2 mb-3 px-1">
                <div className="bg-primary/5 dark:bg-[#2a2a2a] p-1.5 rounded-full">
                    <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground/80 dark:text-[#c7c7c7]">Trending Now</h3>
            </div>

            <div className="w-full overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                <div className="flex gap-3 min-w-max">
                    {displayMarkets.map((market: any, i) => (
                        <div
                            key={market.pubkey}
                            onClick={() => {
                                if (market.pubkey.length > 5) {
                                    logClick('trending_market', { market_pubkey: market.pubkey, position: i + 1 });
                                    navigate(`/market/${market.pubkey}`);
                                }
                            }}
                            className={cn(
                                "w-72 sm:w-80 bg-[#e5e5e5] dark:bg-[#1f1f1f] p-3 cursor-pointer transition-all duration-200 relative group flex-shrink-0",
                                "border border-[#8b8b8b] dark:border-[#3a3a3a] rounded-[4px] shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-white dark:hover:bg-[#262626]",
                                "flex flex-col justify-between h-[120px]",
                                "border-l-[4px]",
                                i === 0 ? "border-l-[#ff8a2a]" : "border-l-[#15a349]"
                            )}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-1.5">
                                    <div className={cn(
                                        "text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border",
                                        i === 0 ? "bg-orange-100 text-[#d35400] border-orange-200 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-800" : "bg-gray-100 text-[#5f5f5f] border-gray-200 dark:bg-[#2a2a2a] dark:text-[#c7c7c7] dark:border-[#3a3a3a]"
                                    )}>
                                        {i === 0 && <Flame className="w-3 h-3 fill-[#ff8a2a] text-[#d35400]" />}
                                        #{i + 1}
                                    </div>
                                    {/* TODO: Add real bet count from Supabase bets table aggregation */}
                                </div>
                                {market.yesProb && (
                                    <div className="text-[10px] font-mono font-bold bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#3a3a3a] px-1.5 py-0.5 rounded-full text-[#111] dark:text-white">
                                        {Math.round(market.yesProb * 100)}% Yes
                                    </div>
                                )}
                            </div>

                            <h4 className="font-bold text-sm leading-tight line-clamp-2 pr-2 text-[#111] dark:text-white group-hover:text-black dark:group-hover:text-white transition-colors">
                                {market.displayQuestion}
                            </h4>

                            <div className="flex items-center justify-between text-[10px] text-[#5f5f5f] dark:text-[#c7c7c7] mt-auto pt-2">
                                <span className="font-mono font-medium">
                                    {formatSol(market.volumeLamports / 1_000_000_000, 1)} SOL Vol
                                </span>
                                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 duration-200 text-[#111] dark:text-white" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

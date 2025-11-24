import React from 'react';
import { cn } from '@/lib/utils';
import { UIMarket } from '@/solana/marketMapping';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp, Flame } from 'lucide-react';

interface TrendingStripProps {
    markets?: UIMarket[];
    className?: string;
}

export const TrendingStrip: React.FC<TrendingStripProps> = ({ markets = [], className }) => {
    const navigate = useNavigate();

    // Placeholder data if no markets provided
    const displayMarkets = markets.length > 0 ? markets.slice(0, 5) : [
        { pubkey: '1', displayQuestion: 'Will BTC hit 100k in 2024?', volumeLamports: 15000000000, yesProb: 0.65 },
        { pubkey: '2', displayQuestion: 'Solana to flip ETH market cap?', volumeLamports: 8500000000, yesProb: 0.12 },
        { pubkey: '3', displayQuestion: 'GTA VI release date announced?', volumeLamports: 5200000000, yesProb: 0.88 },
        { pubkey: '4', displayQuestion: 'SpaceX Starship successful landing?', volumeLamports: 4100000000, yesProb: 0.45 },
        { pubkey: '5', displayQuestion: 'Fed rate cut in March?', volumeLamports: 3800000000, yesProb: 0.30 },
    ];

    return (
        <div className={cn("w-full", className)}>
            <div className="flex items-center gap-2 mb-3 px-1">
                <div className="bg-primary/5 p-1.5 rounded-full">
                    <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground/80">Trending Now</h3>
            </div>

            <div className="w-full overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                <div className="flex gap-3 min-w-max">
                    {displayMarkets.map((market: any, i) => (
                        <div
                            key={market.pubkey}
                            onClick={() => market.pubkey.length > 5 && navigate(`/market/${market.pubkey}`)}
                            className={cn(
                                "w-72 bg-[#e5e5e5] p-3 cursor-pointer transition-all duration-200 relative group",
                                "border border-[#8b8b8b] rounded-[4px] shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-white",
                                "flex flex-col justify-between h-[100px]",
                                "border-l-[4px]",
                                i === 0 ? "border-l-[#ff8a2a]" : "border-l-[#15a349]"
                            )}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-1.5">
                                    <div className={cn(
                                        "text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border",
                                        i === 0 ? "bg-orange-100 text-[#d35400] border-orange-200" : "bg-gray-100 text-[#5f5f5f] border-gray-200"
                                    )}>
                                        {i === 0 && <Flame className="w-3 h-3 fill-[#ff8a2a] text-[#d35400]" />}
                                        #{i + 1}
                                    </div>
                                    {i === 0 && <span className="text-[10px] font-bold text-[#15a349]">+124 bets today</span>}
                                </div>
                                {market.yesProb && (
                                    <div className="text-[10px] font-mono font-bold bg-white border border-gray-200 px-1.5 py-0.5 rounded-full text-[#111]">
                                        {Math.round(market.yesProb * 100)}% Yes
                                    </div>
                                )}
                            </div>

                            <h4 className="font-bold text-sm leading-tight line-clamp-2 pr-2 text-[#111] group-hover:text-black transition-colors">
                                {market.displayQuestion}
                            </h4>

                            <div className="flex items-center justify-between text-[10px] text-[#5f5f5f] mt-auto pt-2">
                                <span className="font-mono font-medium">
                                    {(market.volumeLamports / 1_000_000_000).toFixed(1)} SOL Vol
                                </span>
                                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 duration-200 text-[#111]" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

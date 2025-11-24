import React from 'react';
import { cn } from '@/lib/utils';
import { UIMarket } from '@/solana/marketMapping';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';

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
        <div className={cn("w-full mb-6", className)}>
            <div className="flex items-center gap-2 mb-3 px-1">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Trending Markets</h3>
            </div>

            <div className="w-full overflow-x-auto pb-4 scrollbar-hide">
                <div className="flex gap-4 min-w-max px-1">
                    {displayMarkets.map((market: any, i) => (
                        <div
                            key={market.pubkey}
                            onClick={() => market.pubkey.length > 5 && navigate(`/market/${market.pubkey}`)}
                            className={cn(
                                "w-64 win95-raised bg-background p-3 cursor-pointer hover:translate-y-[-2px] transition-transform duration-200",
                                "border border-border/50 shadow-sm rounded-sm"
                            )}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div className="text-xs font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                    #{i + 1} Trending
                                </div>
                                {market.yesProb && (
                                    <div className="text-xs font-mono">
                                        {Math.round(market.yesProb * 100)}% Yes
                                    </div>
                                )}
                            </div>

                            <h4 className="font-bold text-sm leading-tight mb-3 line-clamp-2 h-10">
                                {market.displayQuestion}
                            </h4>

                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span className="font-mono">
                                    {(market.volumeLamports / 1_000_000_000).toFixed(1)} SOL Vol
                                </span>
                                <ArrowRight className="w-3 h-3" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

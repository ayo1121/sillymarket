import React, { useState, useEffect } from 'react';
import { getFeeBracketInfo, getBracketFeePercent, getBracketTimeLabel, formatSeconds } from '@/utils/feeDecay';
import { Clock, TrendingDown } from 'lucide-react';

type FeeDecayInfoProps = {
    cutoffTs: Date;
    isResolved: boolean;
    isCreator: boolean;
};

type FeeRowProps = {
    bracket: number;
    current: number;
};

const FeeRow: React.FC<FeeRowProps> = ({ bracket, current }) => {
    const feePercent = getBracketFeePercent(bracket);
    const timeLabel = getBracketTimeLabel(bracket);
    const isCurrent = bracket === current;

    return (
        <div className={`flex justify-between items-center py-1 px-2 rounded ${isCurrent ? 'bg-primary/10 font-bold' : ''}`}>
            <span className="text-muted-foreground">{timeLabel}:</span>
            <span className={isCurrent ? 'text-primary' : ''}>
                Creator {feePercent}% • Platform {2 - feePercent}%
            </span>
        </div>
    );
};

export const FeeDecayInfo: React.FC<FeeDecayInfoProps> = ({
    cutoffTs,
    isResolved,
    isCreator
}) => {
    const [now, setNow] = useState(Date.now());

    // Update every second for real-time countdown
    useEffect(() => {
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const cutoffMs = cutoffTs.getTime();
    const isPastCutoff = now >= cutoffMs;

    if (!isPastCutoff || isResolved || !isCreator) {
        return null; // Only show for creators of active markets past cutoff
    }

    const feeInfo = getFeeBracketInfo(Math.floor(cutoffMs / 1000), Math.floor(now / 1000));

    const getNextBracketFee = (currentBracket: number): number => {
        if (currentBracket >= 3) return 0;
        return getBracketFeePercent(currentBracket + 1);
    };

    return (
        <div className="win95-window bg-background p-1 mb-4 sm:mb-6">
            <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1">
                <span className="font-black text-xs sm:text-sm tracking-tight">
                    ⏱️ fee information
                </span>
            </div>

            <div className="win95-sunken bg-background p-3 sm:p-4">
                {/* Current Fee Structure */}
                <div className="mb-4">
                    <div className="text-sm font-bold mb-2">Current Fees:</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="win95-sunken bg-input p-2">
                            <div className="text-xs text-muted-foreground mb-1">Creator</div>
                            <div className="text-lg font-black text-primary">{feeInfo.creatorFeePercent}%</div>
                        </div>
                        <div className="win95-sunken bg-input p-2">
                            <div className="text-xs text-muted-foreground mb-1">Platform</div>
                            <div className="text-lg font-black">{feeInfo.platformFeePercent}%</div>
                        </div>
                    </div>
                </div>

                {/* Time Warning */}
                {feeInfo.timeUntilNextBracket !== null && (
                    <div className="win95-sunken bg-orange-50 border-2 border-orange-400 p-3 mb-3">
                        <div className="flex items-center gap-2 text-orange-700 text-xs sm:text-sm">
                            <Clock className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold">
                                Creator fee drops to {getNextBracketFee(feeInfo.currentBracket)}% in{' '}
                                <span className="text-orange-900">{formatSeconds(feeInfo.timeUntilNextBracket)}</span>
                            </span>
                        </div>
                    </div>
                )}

                {feeInfo.currentBracket === 3 && (
                    <div className="win95-sunken bg-red-50 border-2 border-red-400 p-3 mb-3">
                        <div className="flex items-center gap-2 text-red-700 text-xs sm:text-sm">
                            <TrendingDown className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold">
                                Creator fee is now 0% - Platform receives all fees
                            </span>
                        </div>
                    </div>
                )}

                {/* Fee Decay Schedule */}
                <div>
                    <div className="text-sm font-bold mb-2 flex items-center gap-2">
                        <TrendingDown className="w-4 h-4" />
                        Fee Decay Schedule:
                    </div>
                    <div className="space-y-1 text-xs">
                        <FeeRow bracket={0} current={feeInfo.currentBracket} />
                        <FeeRow bracket={1} current={feeInfo.currentBracket} />
                        <FeeRow bracket={2} current={feeInfo.currentBracket} />
                        <FeeRow bracket={3} current={feeInfo.currentBracket} />
                    </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                    <strong>Note:</strong> Resolve quickly to maximize your creator fee! All markets charge a 2% total fee.
                </div>
            </div>
        </div>
    );
};

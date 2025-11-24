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
        <div className={`flex justify-between items-center py-1.5 px-3 rounded ${isCurrent ? 'bg-green-50 border border-green-200 font-bold' : 'bg-[#fafafa]'}`}>
            <span className="text-[#666] text-xs">{timeLabel}:</span>
            <span className={`text-xs ${isCurrent ? 'text-green-700 font-bold' : 'text-[#111]'}`}>
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
        <div className="bg-white border-2 border-[#8b8b8b] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-5 mb-6 relative overflow-hidden">
            {/* Faint smiley watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
                : )
            </div>

            <div className="relative z-10">
                {/* Header */}
                <h2 className="text-xs uppercase font-black tracking-wider text-[#555] mb-4 pb-2 border-b-2 border-[#d3d3d3] flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Fee Information
                </h2>

                {/* Current Fee Structure */}
                <div className="mb-4">
                    <div className="text-sm font-bold mb-3 text-[#111]">Current Fees:</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-[#fafafa] border border-[#e0e0e0] rounded p-3 shadow-sm">
                            <div className="text-xs text-[#666] mb-1 uppercase font-semibold">Creator</div>
                            <div className="text-2xl font-black text-green-600">{feeInfo.creatorFeePercent}%</div>
                        </div>
                        <div className="bg-[#fafafa] border border-[#e0e0e0] rounded p-3 shadow-sm">
                            <div className="text-xs text-[#666] mb-1 uppercase font-semibold">Platform</div>
                            <div className="text-2xl font-black text-[#111]">{feeInfo.platformFeePercent}%</div>
                        </div>
                    </div>
                </div>

                {/* Time Warning */}
                {feeInfo.timeUntilNextBracket !== null && (
                    <div className="bg-[#fff9e6] border-2 border-[#ffc107] rounded p-3 mb-3 shadow-sm">
                        <div className="flex items-center gap-2 text-[#856404] text-xs sm:text-sm">
                            <Clock className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold">
                                Creator fee drops to {getNextBracketFee(feeInfo.currentBracket)}% in{' '}
                                <span className="text-[#111] font-black">{formatSeconds(feeInfo.timeUntilNextBracket)}</span>
                            </span>
                        </div>
                    </div>
                )}

                {feeInfo.currentBracket === 3 && (
                    <div className="bg-[#ffe6e6] border-2 border-[#dc3545] rounded p-3 mb-3 shadow-sm">
                        <div className="flex items-center gap-2 text-[#721c24] text-xs sm:text-sm">
                            <TrendingDown className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold">
                                Creator fee is now 0% - Platform receives all fees
                            </span>
                        </div>
                    </div>
                )}

                {/* Fee Decay Schedule */}
                <div>
                    <div className="text-sm font-bold mb-3 flex items-center gap-2 text-[#111]">
                        <TrendingDown className="w-4 h-4" />
                        Fee Decay Schedule:
                    </div>
                    <div className="space-y-2">
                        <FeeRow bracket={0} current={feeInfo.currentBracket} />
                        <FeeRow bracket={1} current={feeInfo.currentBracket} />
                        <FeeRow bracket={2} current={feeInfo.currentBracket} />
                        <FeeRow bracket={3} current={feeInfo.currentBracket} />
                    </div>
                </div>

                <div className="mt-4 pt-3 border-t-2 border-[#d3d3d3] text-xs text-[#666]">
                    <strong className="text-[#111]">Note:</strong> Resolve quickly to maximize your creator fee! All markets charge a 2% total fee.
                </div>
            </div>
        </div>
    );
};

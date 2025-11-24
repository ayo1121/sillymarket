// Fee decay constants (matching Rust program)
export const FEE_DECAY_BRACKET_1_SECS = 5 * 60;   // 5 minutes
export const FEE_DECAY_BRACKET_2_SECS = 10 * 60;  // 10 minutes
export const FEE_DECAY_BRACKET_3_SECS = 15 * 60;  // 15 minutes

export const TOTAL_FEE_BPS = 200; // 2.00%

export const CREATOR_FEE_BPS_BRACKET_0 = 100; // 1.0%
export const CREATOR_FEE_BPS_BRACKET_1 = 50;  // 0.5%
export const CREATOR_FEE_BPS_BRACKET_2 = 25;  // 0.25%
export const CREATOR_FEE_BPS_BRACKET_3 = 0;   // 0%

/**
 * Calculate creator fee percentage based on resolution delay after cutoff
 */
export function calculateCreatorFeeBps(cutoffTs: number, resolveTs: number): number {
    const delay = resolveTs - cutoffTs;

    if (delay <= FEE_DECAY_BRACKET_1_SECS) return CREATOR_FEE_BPS_BRACKET_0;
    if (delay <= FEE_DECAY_BRACKET_2_SECS) return CREATOR_FEE_BPS_BRACKET_1;
    if (delay <= FEE_DECAY_BRACKET_3_SECS) return CREATOR_FEE_BPS_BRACKET_2;
    return CREATOR_FEE_BPS_BRACKET_3;
}

/**
 * Get current fee bracket information
 */
export function getFeeBracketInfo(cutoffTs: number, now: number) {
    const delay = now - cutoffTs;
    const creatorFeeBps = calculateCreatorFeeBps(cutoffTs, now);
    const platformFeeBps = TOTAL_FEE_BPS - creatorFeeBps;

    return {
        creatorFeePercent: creatorFeeBps / 100,
        platformFeePercent: platformFeeBps / 100,
        totalFeePercent: TOTAL_FEE_BPS / 100,
        currentBracket: getBracketNumber(delay),
        timeUntilNextBracket: getTimeUntilNextBracket(delay),
        delaySeconds: delay,
    };
}

function getBracketNumber(delay: number): number {
    if (delay <= FEE_DECAY_BRACKET_1_SECS) return 0;
    if (delay <= FEE_DECAY_BRACKET_2_SECS) return 1;
    if (delay <= FEE_DECAY_BRACKET_3_SECS) return 2;
    return 3;
}

function getTimeUntilNextBracket(delay: number): number | null {
    if (delay < FEE_DECAY_BRACKET_1_SECS) {
        return FEE_DECAY_BRACKET_1_SECS - delay;
    }
    if (delay < FEE_DECAY_BRACKET_2_SECS) {
        return FEE_DECAY_BRACKET_2_SECS - delay;
    }
    if (delay < FEE_DECAY_BRACKET_3_SECS) {
        return FEE_DECAY_BRACKET_3_SECS - delay;
    }
    return null; // No next bracket
}

/**
 * Get fee percentage for a specific bracket
 */
export function getBracketFeePercent(bracket: number): number {
    switch (bracket) {
        case 0: return CREATOR_FEE_BPS_BRACKET_0 / 100;
        case 1: return CREATOR_FEE_BPS_BRACKET_1 / 100;
        case 2: return CREATOR_FEE_BPS_BRACKET_2 / 100;
        case 3: return CREATOR_FEE_BPS_BRACKET_3 / 100;
        default: return 0;
    }
}

/**
 * Get time range label for a bracket
 */
export function getBracketTimeLabel(bracket: number): string {
    switch (bracket) {
        case 0: return '0-5 min';
        case 1: return '5-10 min';
        case 2: return '10-15 min';
        case 3: return '>15 min';
        default: return '';
    }
}

/**
 * Format seconds into human-readable time
 */
export function formatSeconds(seconds: number): string {
    if (seconds < 60) {
        return `${Math.floor(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
}

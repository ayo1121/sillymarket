/**
 * RPC Retry Helper
 * 
 * Provides resilience for Solana RPC read operations by retrying on transient network failures.
 * 
 * IMPORTANT: Only use for READ operations. Never wrap write/transaction operations
 * as this could cause duplicate submits.
 */

/**
 * Determines if an error is a transient network/RPC error that should be retried
 */
function isTransientRpcError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || error.toString().toLowerCase();

    // Common transient RPC errors
    const transientPatterns = [
        'network request failed',
        'fetch failed',
        'timeout',
        'econnrefused',
        'enotfound',
        'socket hang up',
        'rate limit',
        '429',
        '502',
        '503',
        '504',
        'gateway',
        'temporarily unavailable',
        'connection reset',
        'aborted',
    ];

    return transientPatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Retry helper for RPC read operations
 * 
 * @param fn - Async function to retry (must be a READ operation)
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelayMs - Base delay in milliseconds for exponential backoff (default: 200)
 * @returns Promise resolving to the function result
 * 
 * @example
 * const markets = await withRpcRetry(() => program.account.market.all());
 */
export async function withRpcRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 200
): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // If this is the last attempt or not a transient error, throw immediately
            if (attempt === maxRetries || !isTransientRpcError(error)) {
                throw error;
            }

            // Calculate exponential backoff delay: 200ms, 400ms, 800ms
            const delayMs = baseDelayMs * Math.pow(2, attempt);

            // Log retry attempt (debug only)
            if (import.meta.env.DEV) {
                console.debug(
                    `[RPC Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delayMs}ms...`,
                    error.message || error
                );
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
}

/**
 * Retry configuration for different operation types
 */
export const RetryConfig = {
    /** Critical reads that drive main pages (3 retries, 200ms base delay) */
    CRITICAL: { maxRetries: 3, baseDelayMs: 200 },

    /** Standard reads (2 retries, 300ms base delay) */
    STANDARD: { maxRetries: 2, baseDelayMs: 300 },

    /** Low priority reads (1 retry, 500ms base delay) */
    LOW_PRIORITY: { maxRetries: 1, baseDelayMs: 500 },
} as const;

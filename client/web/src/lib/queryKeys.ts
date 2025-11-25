/**
 * Centralized query keys for React Query
 * 
 * Benefits:
 * - Type-safe query key generation
 * - Consistent invalidation across components
 * - Easy refactoring and maintenance
 * 
 * Usage:
 * ```tsx
 * useQuery({
 *   queryKey: queryKeys.markets.list({ status: 'active' }),
 *   queryFn: () => fetchAllMarkets(program),
 * });
 * ```
 */
export const queryKeys = {
    // Markets
    markets: {
        all: ['markets'] as const,
        list: (filters?: { status?: string; sort?: string }) =>
            ['markets', 'list', filters] as const,
        detail: (marketId: string) =>
            ['markets', 'detail', marketId] as const,
        creator: (wallet: string) =>
            ['markets', 'creator', wallet] as const,
    },

    // User positions
    positions: {
        all: ['positions'] as const,
        user: (wallet: string) =>
            ['positions', 'user', wallet] as const,
        market: (marketId: string, wallet: string) =>
            ['positions', 'market', marketId, wallet] as const,
    },

    // Bets
    bets: {
        all: ['bets'] as const,
        market: (marketId: string) =>
            ['bets', 'market', marketId] as const,
        user: (wallet: string) =>
            ['bets', 'user', wallet] as const,
    },

    // Config
    config: ['config'] as const,
};

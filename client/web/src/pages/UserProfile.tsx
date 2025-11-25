import { useParams, Link } from 'react-router-dom';
import { Header } from '@/components/Header';
import { useAnchorProgram } from '@/solana/program';
import { fetchUserPositions, fetchMarketsBatch } from '@/solana/read';
import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { shortenWallet, formatSol } from '@/utils/format';
import { Trophy, TrendingUp, Activity, DollarSign, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

/**
 * User Profile Page
 * 
 * Displays user's betting history and stats:
 * - Total markets played
 * - Win rate
 * - Total volume
 * - Recent bets
 * 
 * Data source: On-chain positions via fetchUserPositions
 * 
 * TODO: Backend API for enhanced stats
 * - GET /api/users/:wallet/stats
 * - Returns: { marketsPlayed, winRate, totalVolume, rank, profitLoss }
 * - Leaderboard integration
 * - Historical performance chart
 * - Badge/achievement system
 */
export default function UserProfile() {
    const { wallet } = useParams<{ wallet: string }>();
    const program = useAnchorProgram();

    // Fetch user positions and associated market data
    const { data: positions = [], isLoading } = useQuery({
        queryKey: queryKeys.positions.user(wallet || ''),
        queryFn: async () => {
            if (!program || !wallet) return [];
            try {
                const pubkey = new PublicKey(wallet);

                if (import.meta.env.DEV) {
                    console.log('[UserProfile] Fetching positions for:', wallet);
                }

                // 1. Fetch raw positions from on-chain (1 RPC call)
                const rawPositions = await fetchUserPositions(program as any, pubkey);

                if (rawPositions.length === 0) {
                    return [];
                }

                // 2. Extract all unique market pubkeys
                const marketPubkeys = rawPositions.map((p: any) => {
                    const marketPubkey = p.account.market;
                    return marketPubkey.toBase58 ? marketPubkey.toBase58() : marketPubkey.toString();
                });

                if (import.meta.env.DEV) {
                    console.log(`[UserProfile] Batch fetching ${marketPubkeys.length} markets`);
                }

                // 3. Batch fetch all markets in ONE RPC call (instead of N calls)
                const marketsMap = await fetchMarketsBatch(program as any, marketPubkeys);

                if (import.meta.env.DEV) {
                    console.log(`[UserProfile] Fetched ${marketsMap.size} markets`);
                }

                // 4. Map positions to market data
                const positionsWithDetails = rawPositions.map((p: any) => {
                    const marketPubkey = p.account.market;
                    const marketPubkeyStr = marketPubkey.toBase58 ? marketPubkey.toBase58() : marketPubkey.toString();

                    // Get market from batch-fetched map
                    const market = marketsMap.get(marketPubkeyStr);

                    if (!market) {
                        console.warn(`[UserProfile] Market not found in batch: ${marketPubkeyStr}`);
                        return null;
                    }

                    const outcomeIndex = p.account.outcomeIndex ?? p.account.outcome_index;
                    const outcomeLabel = market.outcomes?.[outcomeIndex]?.label || `Outcome ${outcomeIndex}`;
                    const marketQuestion = market.displayQuestion || "Unknown Market";

                    // Check if claimable (market resolved to this outcome)
                    const isResolved = market.state === 'resolved';
                    const winningOutcomeIndex = market.winningOutcomeIndex;
                    const canClaim = isResolved && winningOutcomeIndex === outcomeIndex && !p.account.claimed;

                    return {
                        marketPubkey: marketPubkeyStr,
                        marketQuestion,
                        outcomeLabel,
                        outcomeIndex,
                        amountLamports: p.account.amount?.toNumber() || 0,
                        canClaim,
                        claimed: p.account.claimed
                    };
                }).filter((bet): bet is NonNullable<typeof bet> => bet !== null);

                if (import.meta.env.DEV) {
                    console.log(`[UserProfile] Processed ${positionsWithDetails.length} positions`);
                }

                return positionsWithDetails;
            } catch (error) {
                console.error('Error fetching user profile data:', error);
                return [];
            }
        },
        enabled: !!program && !!wallet,
        staleTime: 60_000, // 1 minute - reduce refetch frequency
    });

    // Calculate stats from positions
    const stats = {
        marketsPlayed: positions.length,
        totalVolume: positions.reduce((sum: number, pos: any) => sum + (pos.amountLamports || 0), 0),
        winningPositions: positions.filter((pos: any) => pos.canClaim).length,
        winRate: positions.length > 0
            ? ((positions.filter((pos: any) => pos.canClaim).length / positions.length) * 100).toFixed(1)
            : '0.0',
    };

    return (
        <>
            <Header />
            <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#1d1d1d] pb-24">
                <div className="container mx-auto px-4 py-8 max-w-4xl">
                    {/* Back Button */}
                    <Link to="/">
                        <Button variant="outline" size="sm" className="mb-4">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Markets
                        </Button>
                    </Link>

                    {/* Profile Header */}
                    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded p-6 mb-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-gradient-to-br from-[#15a349] to-[#0d7a35] rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md">
                                {wallet?.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1">
                                <h1 className="text-2xl font-black text-[#111] dark:text-white">
                                    {shortenWallet(wallet || '')}
                                </h1>
                                <p className="text-sm text-muted-foreground font-mono break-all">
                                    {wallet}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <StatCard
                            icon={<Activity className="w-5 h-5" />}
                            label="Markets Played"
                            value={stats.marketsPlayed}
                            color="text-blue-600"
                        />
                        <StatCard
                            icon={<Trophy className="w-5 h-5" />}
                            label="Win Rate"
                            value={`${stats.winRate}%`}
                            color="text-yellow-600"
                        />
                        <StatCard
                            icon={<DollarSign className="w-5 h-5" />}
                            label="Total Volume"
                            value={formatSol(stats.totalVolume)}
                            color="text-green-600"
                        />
                        <StatCard
                            icon={<TrendingUp className="w-5 h-5" />}
                            label="Winning Bets"
                            value={stats.winningPositions}
                            color="text-purple-600"
                        />
                    </div>

                    {/* Betting History */}
                    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded p-6 shadow-sm">
                        <h2 className="text-xl font-black mb-4 text-[#111] dark:text-white">
                            Betting History
                        </h2>

                        {isLoading ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <div className="animate-spin w-8 h-8 border-4 border-[#15a349] border-t-transparent rounded-full mx-auto mb-2"></div>
                                Loading...
                            </div>
                        ) : positions.length === 0 ? (
                            <div className="text-center py-12">
                                <Trophy className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                                <p className="text-muted-foreground font-semibold">No bets yet</p>
                                <p className="text-sm text-muted-foreground mt-2">
                                    Start betting on markets to see your history here
                                </p>
                                <Link to="/">
                                    <Button className="mt-4">
                                        Browse Markets
                                    </Button>
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {positions.map((position: any, idx: number) => (
                                    <BetHistoryItem key={idx} position={position} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* TODO: Additional Features */}
                    <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded">
                        <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
                            📊 Coming Soon: Enhanced Stats
                        </p>
                        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 ml-4">
                            <li>• Leaderboard ranking</li>
                            <li>• Historical performance chart</li>
                            <li>• Profit/loss tracking</li>
                            <li>• Badge/achievement system</li>
                            <li>• Social features (follow users, share predictions)</li>
                        </ul>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-3">
                            <strong>TODO:</strong> Requires backend API endpoint: GET /api/users/:wallet/stats
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}

interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    color?: string;
}

const StatCard = ({ icon, label, value, color = 'text-[#15a349]' }: StatCardProps) => (
    <div className="bg-[#e8e8e8] dark:bg-[#2a2a2a] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded p-4 shadow-sm hover:shadow-md transition-shadow">
        <div className={cn('flex items-center gap-2 mb-2', color)}>
            {icon}
            <span className="text-xs font-semibold uppercase tracking-wide">
                {label}
            </span>
        </div>
        <div className="text-2xl font-black text-[#111] dark:text-white">
            {value}
        </div>
    </div>
);

interface BetHistoryItemProps {
    position: any;
}

const BetHistoryItem = ({ position }: BetHistoryItemProps) => (
    <Link
        to={`/market/${position.marketPubkey}`}
        className="block p-4 bg-[#f5f5f5] dark:bg-[#2a2a2a] rounded hover:bg-[#e8e8e8] dark:hover:bg-[#333] transition-colors border border-transparent hover:border-[#8b8b8b] dark:hover:border-[#3a3a3a]"
    >
        <div className="flex items-center justify-between">
            <div className="flex-1">
                <div className="font-semibold text-[#111] dark:text-white">
                    {position.marketQuestion || 'Market'}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                    <span className="font-semibold">{position.outcomeLabel}</span>
                    {' • '}
                    <span>{formatSol(position.amountLamports)}</span>
                </div>
            </div>
            {position.canClaim && (
                <div className="flex items-center gap-2 text-green-600 font-semibold text-sm">
                    <Trophy className="w-4 h-4" />
                    Won
                </div>
            )}
        </div>
    </Link>
);

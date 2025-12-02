import { useMemo, useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { useAnchorProgram } from '@/solana/program';
import { fetchUserPositions, fetchMarketsBatch, fetchMarket } from '@/solana/read';
import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { shortenWallet, formatSol } from '@/utils/format';
import { Trophy, TrendingUp, Activity, DollarSign, ArrowLeft, BarChart3, ExternalLink, Plus, CheckCircle, Coins } from 'lucide-react';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useWallet } from '@solana/wallet-adapter-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { getTxExplorerUrl } from '@/utils/solanaExplorer';
import { logPageView, logClick } from '@/lib/analytics';
import { fetchAllMarkets } from '@/solana/read';

// Helper to format lamports to SOL with proper decimals
const LAMPORTS_PER_SOL = 1_000_000_000;

function formatLamportsToSol(amount: number | bigint): string {
    const sol = Number(amount) / LAMPORTS_PER_SOL;
    return sol.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    });
}

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
 * Data source: On-chain positions via fetchUserPositions
 */
export default function UserProfile() {
    const { wallet } = useParams<{ wallet: string }>();
    const program = useAnchorProgram();
    const navigate = useNavigate();
    const { publicKey } = useWallet();
    const [profileUsername, setProfileUsername] = useState<string | null>(null);

    // Fetch username from Supabase for the profile being viewed
    useEffect(() => {
        if (!wallet) return;

        const fetchUsername = async () => {
            try {
                const { data, error } = await (supabase as any)
                    .from('users')
                    .select('username')
                    .eq('pubkey', wallet)
                    .single();

                if (!error && data?.username) {
                    setProfileUsername(data.username);
                } else {
                    setProfileUsername(null);
                }
            } catch (err) {
                console.error('[UserProfile] Failed to fetch username:', err);
                setProfileUsername(null);
            }
        };

        fetchUsername();
    }, [wallet]);

    // Username display logic - works without wallet connected
    const { displayName, displayAddress } = useMemo(() => {
        if (!wallet) return { displayName: 'Unknown', displayAddress: '' };

        const walletAddress = wallet;

        // Use fetched username from Supabase
        const username = profileUsername && profileUsername.trim().length > 0
            ? profileUsername.trim()
            : null;

        const displayName = username ?? shortenWallet(walletAddress);
        const displayAddress = shortenWallet(walletAddress);

        return { displayName, displayAddress };
    }, [wallet, profileUsername]);

    // Check if viewing own profile
    const isOwnProfile = publicKey?.toBase58() === wallet;

    // Track page view
    useEffect(() => {
        logPageView('user_profile', { viewed_wallet: wallet });
    }, [wallet]);

    // Fetch user positions and enrich with market data and transaction signatures
    const { data: profileData, isLoading } = useQuery({
        queryKey: ['userProfile', wallet],
        queryFn: async () => {
            if (!program || !wallet) return { positions: [], marketsMap: new Map(), betsMap: new Map() };

            try {
                // Fetch positions from blockchain
                const pubkey = new PublicKey(wallet);
                const positions = await fetchUserPositions(program as any, pubkey);

                if (import.meta.env.DEV) {
                    console.log(`[UserProfile] Fetched ${positions.length} positions`);
                }

                if (positions.length === 0) {
                    return { positions: [], marketsMap: new Map(), betsMap: new Map() };
                }

                // Fetch bets from Supabase for transaction signatures
                const { data: betsData } = await supabase
                    .from('bets')
                    .select('market_pubkey, outcome_index, tx_sig, block_time, created_at')
                    .eq('bettor_pubkey', wallet)
                    .order('block_time', { ascending: false });

                // Create map of bets by market+outcome for quick lookup
                const betsMap = new Map<string, any>();
                if (betsData) {
                    for (const bet of betsData) {
                        const key = `${bet.market_pubkey}-${bet.outcome_index}`;
                        // Only store the first bet found for a market+outcome combination
                        // This assumes the first one is the relevant one for display,
                        // or that multiple bets on the same outcome are rare/handled differently.
                        if (!betsMap.has(key)) {
                            betsMap.set(key, bet);
                        }
                    }
                }

                // Extract unique market pubkeys from the fetched positions
                const marketPubkeys: string[] = Array.from(
                    new Set(positions.map(p => p.account.market.toBase58()))
                );

                // Fetch market data - returns Map<string, UIMarket>
                const marketsMap = await fetchMarketsBatch(program as any, marketPubkeys);

                // Enrich positions with market details and transaction signatures
                const positionsWithDetails = positions.map(p => {
                    const marketPubkeyStr = p.account.market.toBase58();
                    const market: any = marketsMap.get(marketPubkeyStr);

                    if (!market) {
                        console.warn(`[UserProfile] Market not found in batch: ${marketPubkeyStr}`);
                        return null;
                    }

                    const outcomeIndex = p.account.outcomeIndex ?? p.account.outcome_index;
                    const outcomeLabel = market.outcomes?.[outcomeIndex]?.label || `Outcome ${outcomeIndex}`;
                    const stakeLamports = p.account.amount?.toNumber() || 0;

                    // Market state
                    const isResolved = market.state === 'resolved';
                    const isVoid = market.winningOutcomeIndex === -2;
                    const winningOutcomeIndex = market.winningOutcomeIndex;

                    // Check if user won
                    const didWin = isResolved && !isVoid && winningOutcomeIndex === outcomeIndex;
                    const didLose = isResolved && !isVoid && winningOutcomeIndex !== outcomeIndex;
                    const canClaim = didWin && !p.account.claimed;

                    // Calculate payout for won positions
                    let payoutLamports = 0;
                    if (didWin) {
                        const totalPool = Number(market.volumeLamports || 0);
                        const winningPool = Number(market.outcomes[winningOutcomeIndex]?.poolLamports || 1);
                        payoutLamports = totalPool > 0 && winningPool > 0
                            ? Math.floor((stakeLamports * totalPool) / winningPool)
                            : stakeLamports;
                    } else if (isVoid) {
                        // Voided markets return stake
                        payoutLamports = stakeLamports;
                    }

                    // Get transaction signature from bets table
                    const betKey = `${marketPubkeyStr}-${outcomeIndex}`;
                    const bet = betsMap.get(betKey);
                    const txSignature = bet?.tx_sig || null;
                    const createdAt = bet?.block_time || bet?.created_at || null;

                    return {
                        marketPubkey: marketPubkeyStr,
                        marketQuestion: market.displayQuestion || 'Unknown Market',
                        outcomeLabel,
                        outcomeIndex,
                        stakeLamports,
                        payoutLamports,
                        isResolved,
                        isVoid,
                        didWin,
                        didLose,
                        canClaim,
                        claimed: p.account.claimed,
                        market, // Include full market for stats calculation
                        txSignature,
                        createdAt,
                    };
                }).filter((bet): bet is NonNullable<typeof bet> => bet !== null);

                // Sort by latest first (createdAt descending)
                positionsWithDetails.sort((a, b) => {
                    const getTimestamp = (val: any) => {
                        if (!val) return 0;
                        // Handle Solana block time (seconds) vs JS timestamp (ms)
                        if (typeof val === 'number') {
                            return val < 10000000000 ? val * 1000 : val;
                        }
                        return new Date(val).getTime();
                    };
                    return getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
                });

                if (import.meta.env.DEV) {
                    console.log(`[UserProfile] Processed ${positionsWithDetails.length} positions`);
                }

                return { positions: positionsWithDetails, marketsMap, betsMap };
            } catch (error) {
                console.error('Error fetching user profile data:', error);
                return { positions: [], marketsMap: new Map(), betsMap: new Map() };
            }
        },
        enabled: !!program && !!wallet,
        staleTime: 60_000, // 1 minute
    });

    const positions = useMemo(() => profileData?.positions || [], [profileData?.positions]);
    const marketsMap = profileData?.marketsMap || new Map();

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    const totalPages = Math.ceil(positions.length / ITEMS_PER_PAGE);
    const currentPositions = positions.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    // Reset to page 1 when wallet changes
    useEffect(() => {
        setCurrentPage(1);
    }, [wallet]);

    // Fetch created markets for this profile
    const { data: createdMarkets, isLoading: marketsLoading } = useQuery({
        queryKey: ['createdMarkets', wallet],
        queryFn: async () => {
            if (!program || !wallet) return [];
            try {
                const allMarkets = await fetchAllMarkets(program as any, publicKey ?? null);
                // Filter markets created by this wallet
                return allMarkets.filter(m => m.creatorPubkey === wallet);
            } catch (error) {
                console.error('Error fetching created markets:', error);
                return [];
            }
        },
        enabled: !!program && !!wallet && !isOwnProfile,
        staleTime: 60_000,
    });

    // Fetch comprehensive activity feed (bets, creations, resolutions, claims)
    const { data: activityData, isLoading: activityLoading } = useQuery({
        queryKey: ['userActivity', wallet],
        queryFn: async () => {
            if (!wallet) return [];

            try {
                const activities: any[] = [];

                // Fetch bets
                const { data: bets } = await supabase
                    .from('bets')
                    .select('*')
                    .eq('bettor_pubkey', wallet)
                    .order('block_time', { ascending: false })
                    .limit(50);

                if (bets) {
                    activities.push(...bets.map(bet => ({
                        type: 'bet',
                        timestamp: new Date(bet.block_time).getTime(),
                        data: bet,
                    })));
                }

                // Fetch market creations
                const { data: creations } = await supabase
                    .from('market_events')
                    .select('*')
                    .eq('creator_pubkey', wallet)
                    .order('block_time', { ascending: false })
                    .limit(50);

                if (creations) {
                    activities.push(...creations.map(creation => ({
                        type: 'creation',
                        timestamp: new Date(creation.block_time).getTime(),
                        data: creation,
                    })));
                }

                // Fetch market resolutions
                const { data: resolutions } = await supabase
                    .from('market_resolutions')
                    .select('*')
                    .order('block_time', { ascending: false })
                    .limit(50);

                if (resolutions) {
                    // Filter resolutions for markets created by this user
                    const userResolutions = resolutions.filter(res => {
                        // We'll need to check if the market was created by this user
                        // For now, include all and we'll filter in the UI if needed
                        return true;
                    });

                    activities.push(...userResolutions.map(resolution => ({
                        type: 'resolution',
                        timestamp: new Date(resolution.block_time).getTime(),
                        data: resolution,
                    })));
                }

                // Fetch claims
                const { data: claims } = await supabase
                    .from('claims')
                    .select('*')
                    .eq('user_pubkey', wallet)
                    .order('block_time', { ascending: false })
                    .limit(50);

                if (claims) {
                    activities.push(...claims.map(claim => ({
                        type: 'claim',
                        timestamp: new Date(claim.block_time).getTime(),
                        data: claim,
                    })));
                }

                // Sort all activities by timestamp (newest first)
                activities.sort((a, b) => b.timestamp - a.timestamp);

                return activities;
            } catch (error) {
                console.error('Error fetching activity:', error);
                return [];
            }
        },
        enabled: !!wallet && isOwnProfile,
        staleTime: 30_000, // 30 seconds
    });

    const activities = activityData || [];

    // Calculate enhanced stats from positions
    const stats = useMemo(() => {
        if (positions.length === 0) {
            return {
                totalMarkets: 0,
                totalVolume: 0,
                realizedPnL: 0,
                openExposure: 0,
                winRate: 0,
                resolvedCount: 0,
                wonCount: 0,
                lostCount: 0,
                activeCount: 0,
            };
        }

        let totalStaked = 0;
        let totalWinnings = 0;
        let openExposure = 0;
        let resolvedCount = 0;
        let wonCount = 0;
        let activeCount = 0;

        positions.forEach((position: any) => {
            const stake = position.stakeLamports || 0;
            totalStaked += stake;

            if (position.isResolved) {
                resolvedCount++;

                if (position.didWin) {
                    wonCount++;
                    totalWinnings += position.payoutLamports || 0;
                } else if (position.isVoid) {
                    // Voided markets return stake
                    totalWinnings += stake;
                }
                // If lost, winnings = 0 (stake already counted in totalStaked)
            } else {
                // Market still active/locked
                activeCount++;
                openExposure += stake;
            }
        });

        const lostCount = resolvedCount - wonCount;
        const realizedPnL = totalWinnings - (totalStaked - openExposure);
        const winRate = resolvedCount > 0 ? (wonCount / resolvedCount) * 100 : 0;

        // Convert lamports to SOL
        const LAMPORTS_PER_SOL = 1_000_000_000;

        return {
            totalMarkets: positions.length,
            totalVolume: totalStaked / LAMPORTS_PER_SOL,
            realizedPnL: realizedPnL / LAMPORTS_PER_SOL,
            openExposure: openExposure / LAMPORTS_PER_SOL,
            winRate,
            resolvedCount,
            wonCount,
            lostCount,
            activeCount,
        };
    }, [positions]);

    return (
        <>
            <Header />
            {/* Proper light/dark backgrounds - no grey banner */}
            <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#111] pb-24">
                <div className="container mx-auto px-4 py-8 max-w-4xl">
                    {/* Navigation Buttons - Native buttons for full style control */}
                    <div className="flex gap-2 mb-6">
                        <Link to="/">
                            <button className="inline-flex items-center gap-2 px-4 h-8 text-sm font-semibold bg-white dark:bg-[#1f1f1f] border border-[#8b8b8b] dark:border-[#3a3a3a] text-[#111] dark:text-[#e8e8e8] rounded hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] hover:border-[#666] dark:hover:border-[#4a4a4a] transition-colors">
                                <ArrowLeft className="w-4 h-4" />
                                Back to Markets
                            </button>
                        </Link>
                        {isOwnProfile && (
                            <Link to="/my-bets">
                                <button className="inline-flex items-center gap-2 px-4 h-8 text-sm font-semibold bg-white dark:bg-[#1f1f1f] border border-[#8b8b8b] dark:border-[#3a3a3a] text-[#111] dark:text-[#e8e8e8] rounded hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] hover:border-[#666] dark:hover:border-[#4a4a4a] transition-colors">
                                    <BarChart3 className="w-4 h-4" />
                                    My Bets
                                </button>
                            </Link>
                        )}
                    </div>

                    {/* Profile Header - Improved dark mode styling */}
                    <div className="bg-white dark:bg-[#1f1f1f] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded-lg p-6 mb-6 shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-gradient-to-br from-[#15a349] to-[#0d7a35] rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md">
                                {displayName.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1">
                                <h1 className="text-2xl font-black text-[#111] dark:text-[#e8e8e8]">
                                    {displayName}
                                </h1>
                                <p className="text-xs text-[#666] dark:text-[#999] font-mono mt-1">
                                    {displayAddress}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Stats Grid - 5 cards (RESOLVED removed) */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                        <StatCard
                            icon={<Activity className="w-5 h-5" />}
                            label="Markets Bet"
                            value={stats.totalMarkets}
                            color="text-blue-600 dark:text-blue-400"
                        />
                        <StatCard
                            icon={<Trophy className="w-5 h-5" />}
                            label="Win Rate"
                            value={`${stats.winRate.toFixed(1)}%`}
                            subtitle={stats.resolvedCount > 0 ? `${stats.wonCount}/${stats.resolvedCount}` : undefined}
                            color="text-yellow-600 dark:text-yellow-400"
                        />
                        <StatCard
                            icon={<DollarSign className="w-5 h-5" />}
                            label="Total Volume"
                            value={formatSol(stats.totalVolume, 4)}
                            color="text-green-600 dark:text-green-400"
                        />
                        <StatCard
                            icon={<TrendingUp className="w-5 h-5" />}
                            label="Realized PnL"
                            value={formatSol(Math.abs(stats.realizedPnL), 4)}
                            valuePrefix={stats.realizedPnL >= 0 ? '+' : '-'}
                            color={stats.realizedPnL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                        />
                        <StatCard
                            icon={<Activity className="w-5 h-5" />}
                            label="Open Exposure"
                            value={formatSol(stats.openExposure, 4)}
                            subtitle={stats.activeCount > 0 ? `${stats.activeCount} active` : undefined}
                            color="text-purple-600 dark:text-purple-400"
                        />
                    </div>

                    {/* Activity Feed or Created Markets */}
                    {isOwnProfile ? (
                        <div className="bg-white dark:bg-[#1f1f1f] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded-lg p-6 shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                            <h2 className="text-xl font-black mb-5 text-[#111] dark:text-[#e8e8e8]">
                                Activity
                            </h2>

                            {activityLoading ? (
                                <div className="text-center py-8 text-[#666] dark:text-[#999]">
                                    <div className="animate-spin w-8 h-8 border-4 border-[#15a349] border-t-transparent rounded-full mx-auto mb-2"></div>
                                    Loading...
                                </div>
                            ) : activities.length === 0 ? (
                                <div className="text-center py-12">
                                    <Activity className="w-16 h-16 mx-auto mb-4 text-[#999] dark:text-[#666] opacity-50" />
                                    <p className="text-[#333] dark:text-[#ccc] font-semibold">No activity yet</p>
                                    <p className="text-sm text-[#666] dark:text-[#999] mt-2">
                                        Start betting on markets to see your activity here
                                    </p>
                                    <Link to="/">
                                        <button className="inline-flex items-center gap-2 px-4 h-8 text-sm font-semibold bg-white dark:bg-[#1f1f1f] border border-[#8b8b8b] dark:border-[#3a3a3a] text-[#111] dark:text-[#e8e8e8] rounded hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] hover:border-[#666] dark:hover:border-[#4a4a4a] transition-colors mt-4">
                                            Browse Markets
                                        </button>
                                    </Link>
                                </div>
                            ) : (
                                <div className="space-y-0 divide-y divide-[#e0e0e0] dark:divide-[#333] border border-[#e0e0e0] dark:border-[#333] rounded-lg overflow-hidden">
                                    {activities.slice(0, 20).map((activity: any, idx: number) => (
                                        <ActivityItem key={`${activity.type}-${activity.data.id || idx}`} activity={activity} />
                                    ))}
                                </div>
                            )}

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#e0e0e0] dark:border-[#333]">
                                    <div className="text-xs text-[#666] dark:text-[#999]">
                                        Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, positions.length)} of {positions.length} bets
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1.5 text-xs font-bold bg-white dark:bg-[#2a2a2a] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f5f5] dark:hover:bg-[#333] text-[#111] dark:text-[#e8e8e8] transition-colors"
                                        >
                                            Previous
                                        </button>
                                        <div className="text-xs font-bold text-[#111] dark:text-[#e8e8e8] px-2">
                                            Page {currentPage} of {totalPages}
                                        </div>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            className="px-3 py-1.5 text-xs font-bold bg-white dark:bg-[#2a2a2a] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f5f5f5] dark:hover:bg-[#333] text-[#111] dark:text-[#e8e8e8] transition-colors"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-[#1f1f1f] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded-lg p-6 shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                            <h2 className="text-xl font-black mb-5 text-[#111] dark:text-[#e8e8e8]">
                                Created Markets
                            </h2>

                            {marketsLoading ? (
                                <div className="text-center py-8 text-[#666] dark:text-[#999]">
                                    <div className="animate-spin w-8 h-8 border-4 border-[#15a349] border-t-transparent rounded-full mx-auto mb-2"></div>
                                    Loading...
                                </div>
                            ) : !createdMarkets || createdMarkets.length === 0 ? (
                                <div className="text-center py-12">
                                    <Trophy className="w-16 h-16 mx-auto mb-4 text-[#999] dark:text-[#666] opacity-50" />
                                    <p className="text-[#333] dark:text-[#ccc] font-semibold">No markets created yet</p>
                                    <p className="text-sm text-[#666] dark:text-[#999] mt-2">
                                        This user hasn't created any markets
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {createdMarkets.map((market: any) => (
                                        <Link
                                            key={market.pubkey}
                                            to={`/market/${market.pubkey}`}
                                            className="block bg-white dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded-lg p-4 hover:bg-[#fafafa] dark:hover:bg-[#252525] hover:border-[#d0d0d0] dark:hover:border-[#444] transition-all"
                                        >
                                            <div className="font-bold text-[#111] dark:text-[#e8e8e8] mb-2">
                                                {market.displayQuestion}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-[#666] dark:text-[#999]">
                                                <span>Vol: {formatSol(Number(market.volumeLamports) / 1e9, 2)} SOL</span>
                                                <span>•</span>
                                                <span className={cn(
                                                    "font-bold uppercase",
                                                    market.state === 'open' && "text-green-600 dark:text-green-400",
                                                    market.state === 'locked' && "text-orange-600 dark:text-orange-400",
                                                    market.state === 'resolved' && "text-blue-600 dark:text-blue-400"
                                                )}>
                                                    {market.state}
                                                </span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}


                </div>
            </div>
        </>
    );
}

// Activity Item Component
interface ActivityItemProps {
    activity: {
        type: 'bet' | 'creation' | 'resolution' | 'claim';
        timestamp: number;
        data: any;
    };
}

const ActivityItem = ({ activity }: ActivityItemProps) => {
    const { type, timestamp, data } = activity;
    const timeAgo = formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    const program = useAnchorProgram();
    const [marketData, setMarketData] = useState<any>(null);

    // Fetch market data to get question and outcomes
    useEffect(() => {
        const loadMarket = async () => {
            if (!data.market_pubkey) return;

            // 1. Try fetching with centralized fetchMarket (handles on-chain + Supabase merge)
            if (program) {
                try {
                    const uiMarket = await fetchMarket(program, data.market_pubkey);
                    if (uiMarket) {
                        setMarketData(uiMarket);
                        return;
                    }
                } catch (error) {
                    console.warn('fetchMarket failed for activity item, trying Supabase fallback', error);
                }
            }

            // 2. Fallback to Supabase metadata directly (if program not ready or fetchMarket failed)
            try {
                const { data: meta, error } = await supabase
                    .from('markets')
                    .select('question, outcome_labels')
                    .eq('market_pubkey', data.market_pubkey)
                    .single();

                if (meta && !error) {
                    setMarketData({
                        question: meta.question,
                        outcomes: meta.outcome_labels ? Object.values(meta.outcome_labels).map((label: any, index: number) => ({
                            index,
                            label
                        })) : []
                    });
                }
            } catch (err) {
                console.error('Error fetching market metadata for activity:', err);
            }
        };

        loadMarket();
    }, [program, data.market_pubkey]);

    const renderIcon = () => {
        switch (type) {
            case 'bet':
                return <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
            case 'creation':
                return <Plus className="w-4 h-4 text-green-600 dark:text-green-400" />;
            case 'resolution':
                return <CheckCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
            case 'claim':
                return <Coins className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />;
        }
    };

    const getOutcomeLabel = (outcomeIndex: number) => {
        if (!marketData || !marketData.outcomes) return `Outcome ${outcomeIndex}`;
        // Handle both on-chain structure (array of objects) and fallback structure (array of objects)
        const outcome = marketData.outcomes[outcomeIndex];
        return outcome?.label || `Outcome ${outcomeIndex}`;
    };

    const getMarketQuestion = () => {
        if (!marketData) return 'Loading...';
        // Support both UIMarket (displayQuestion) and raw Supabase fallback (question)
        return marketData.displayQuestion || marketData.question || 'Unknown Market';
    };

    const renderContent = () => {
        switch (type) {
            case 'bet':
                return (
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#111] dark:text-[#e8e8e8] text-sm">
                            Placed bet: {formatLamportsToSol(data.amount_lamports)} SOL
                        </div>
                        <div className="text-xs text-[#666] dark:text-[#999] mt-1 truncate">
                            {data.outcome_label || getOutcomeLabel(data.outcome_index)} • {getMarketQuestion()}
                        </div>
                        <div className="text-xs text-[#999] dark:text-[#666] mt-0.5">
                            {timeAgo}
                        </div>
                    </div>
                );
            case 'creation':
                return (
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#111] dark:text-[#e8e8e8] text-sm">
                            Created market
                        </div>
                        <div className="text-xs text-[#666] dark:text-[#999] mt-1 truncate">
                            {getMarketQuestion()}
                        </div>
                        <div className="text-xs text-[#999] dark:text-[#666] mt-0.5">
                            {data.outcomes_count} outcomes • {timeAgo}
                        </div>
                    </div>
                );
            case 'resolution':
                return (
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#111] dark:text-[#e8e8e8] text-sm">
                            Market resolved
                        </div>
                        <div className="text-xs text-[#666] dark:text-[#999] mt-1 truncate">
                            {data.auto_void ? 'Voided' : `Winner: ${getOutcomeLabel(data.winner_index)}`} • {getMarketQuestion()}
                        </div>
                        <div className="text-xs text-[#999] dark:text-[#666] mt-0.5">
                            {timeAgo}
                        </div>
                    </div>
                );
            case 'claim':
                return (
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#111] dark:text-[#e8e8e8] text-sm">
                            Claimed {formatLamportsToSol(data.amount_lamports)} SOL
                        </div>
                        <div className="text-xs text-[#666] dark:text-[#999] mt-1 truncate">
                            {getMarketQuestion()}
                        </div>
                        <div className="text-xs text-[#999] dark:text-[#666] mt-0.5">
                            {timeAgo}
                        </div>
                    </div>
                );
        }
    };

    const marketPubkey = data.market_pubkey;
    const txSignature = data.tx_sig;

    const handleExplorerClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (txSignature) {
            window.open(getTxExplorerUrl(txSignature), '_blank');
            logClick('activity_tx_explorer', { tx_sig: txSignature, activity_type: type });
        }
    };

    return (
        <div className="flex items-center gap-3 p-4 hover:bg-[#fafafa] dark:hover:bg-[#252525] transition-colors">
            <div className="flex-shrink-0">
                {renderIcon()}
            </div>
            <Link
                to={`/market/${marketPubkey}`}
                className="flex-1 min-w-0"
                onClick={() => logClick('activity_market_link', { market: marketPubkey, activity_type: type })}
            >
                {renderContent()}
            </Link>
            <div className="flex items-center gap-2 flex-shrink-0">
                {txSignature && (
                    <button
                        onClick={handleExplorerClick}
                        className="p-1.5 hover:bg-[#e0e0e0] dark:hover:bg-[#333] rounded transition-colors"
                        title="View on Solana Explorer"
                    >
                        <ExternalLink className="w-4 h-4 text-[#666] dark:text-[#999]" />
                    </button>
                )}
            </div>
        </div>
    );
};


interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    subtitle?: string;
    valuePrefix?: string;
    color?: string;
}

const StatCard = ({ icon, label, value, subtitle, valuePrefix, color = 'text-[#15a349]' }: StatCardProps) => (
    <div className="bg-white dark:bg-[#1f1f1f] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded-lg p-4 shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-shadow">
        <div className={cn('flex items-center gap-2 mb-2', color)}>
            {icon}
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#666] dark:text-[#999]">
                {label}
            </span>
        </div>
        <div className="text-2xl font-black text-[#111] dark:text-[#e8e8e8]">
            {valuePrefix}{value}
        </div>
        {subtitle && (
            <div className="text-xs text-[#666] dark:text-[#999] mt-1">
                {subtitle}
            </div>
        )}
    </div>
);

interface BetHistoryItemProps {
    position: any;
}

const BetHistoryItem = ({ position }: BetHistoryItemProps) => {
    // Format timestamp if available
    const timeAgo = position.createdAt ? formatDistanceToNow(new Date(position.createdAt), { addSuffix: true }) : null;

    return (
        <div className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 bg-white dark:bg-[#1f1f1f] hover:bg-[#fafafa] dark:hover:bg-[#252525] transition-colors">
            {/* Main Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <Link
                        to={`/market/${position.marketPubkey}`}
                        className="font-bold text-[#111] dark:text-[#e8e8e8] truncate hover:underline text-sm sm:text-base"
                    >
                        {position.marketQuestion || 'Market'}
                    </Link>
                    {position.canClaim && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                            WON
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3 text-xs sm:text-sm text-[#555] dark:text-[#aaa]">
                    <div className="flex items-center gap-1">
                        <span className="text-[#666] dark:text-[#888]">Bet:</span>
                        <span className={`font-bold ${position.didWin ? 'text-green-600 dark:text-green-400' :
                            position.didLose ? 'text-red-600 dark:text-red-400' :
                                'text-[#111] dark:text-[#e8e8e8]'
                            }`}>
                            {position.outcomeLabel}
                        </span>
                    </div>
                    <span className="text-[#ccc] dark:text-[#444]">|</span>
                    <div className="font-mono font-medium">
                        {formatLamportsToSol(position.stakeLamports)} SOL
                    </div>
                    {timeAgo && (
                        <>
                            <span className="text-[#ccc] dark:text-[#444] hidden sm:inline">|</span>
                            <span className="text-[#999] dark:text-[#666] hidden sm:inline">{timeAgo}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Actions / Meta Right */}
            <div className="flex items-center justify-between sm:justify-end gap-4 mt-1 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#f0f0f0] dark:border-[#333] sm:border-none">
                {timeAgo && (
                    <span className="text-xs text-[#999] dark:text-[#666] sm:hidden">{timeAgo}</span>
                )}

                {position.txSignature && (
                    <a
                        href={getTxExplorerUrl(position.txSignature)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs font-medium text-[#666] dark:text-[#999] hover:text-[#111] dark:hover:text-white transition-colors bg-[#f5f5f5] dark:bg-[#2a2a2a] px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3a3a3a]"
                    >
                        <span>Solscan</span>
                        <ExternalLink className="w-3 h-3" />
                    </a>
                )}
            </div>
        </div>
    );
};

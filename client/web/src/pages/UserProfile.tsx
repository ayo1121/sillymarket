import { useMemo, useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { useAnchorProgram } from '@/solana/program';
import { fetchUserPositions, fetchMarketsBatch } from '@/solana/read';
import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { shortenWallet, formatSol } from '@/utils/format';
import { Trophy, TrendingUp, Activity, DollarSign, ArrowLeft, BarChart3, ExternalLink } from 'lucide-react';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useWallet } from '@solana/wallet-adapter-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { getTxExplorerUrl } from '@/utils/solanaExplorer';
import { logPageView, logClick } from '@/lib/analytics';

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

    const positions = profileData?.positions || [];
    const marketsMap = profileData?.marketsMap || new Map();

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
            <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#1d1d1d] pb-24">
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

                    {/* Betting History - Improved dark mode */}
                    <div className="bg-white dark:bg-[#1f1f1f] border border-[#d4d4d4] dark:border-[#3a3a3a] rounded-lg p-6 shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                        <h2 className="text-xl font-black mb-5 text-[#111] dark:text-[#e8e8e8]">
                            Betting History
                        </h2>

                        {isLoading ? (
                            <div className="text-center py-8 text-[#666] dark:text-[#999]">
                                <div className="animate-spin w-8 h-8 border-4 border-[#15a349] border-t-transparent rounded-full mx-auto mb-2"></div>
                                Loading...
                            </div>
                        ) : positions.length === 0 ? (
                            <div className="text-center py-12">
                                <Trophy className="w-16 h-16 mx-auto mb-4 text-[#999] dark:text-[#666] opacity-50" />
                                <p className="text-[#333] dark:text-[#ccc] font-semibold">No bets yet</p>
                                <p className="text-sm text-[#666] dark:text-[#999] mt-2">
                                    Start betting on markets to see your history here
                                </p>
                                <Link to="/">
                                    <button className="inline-flex items-center gap-2 px-4 h-8 text-sm font-semibold bg-white dark:bg-[#1f1f1f] border border-[#8b8b8b] dark:border-[#3a3a3a] text-[#111] dark:text-[#e8e8e8] rounded hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] hover:border-[#666] dark:hover:border-[#4a4a4a] transition-colors mt-4">
                                        Browse Markets
                                    </button>
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {positions.map((position: any, idx: number) => (
                                    <BetHistoryItem key={idx} position={position} />
                                ))}
                            </div>
                        )}
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
        <div className="bg-white dark:bg-[#1f1f1f] border border-[#e0e0e0] dark:border-[#333] rounded-lg p-4 hover:bg-[#fafafa] dark:hover:bg-[#252525] hover:border-[#d0d0d0] dark:hover:border-[#444] transition-all">
            <div className="flex items-start justify-between gap-3 mb-2">
                <Link to={`/market/${position.marketPubkey}`} className="flex-1 min-w-0">
                    <div className="font-bold text-[#111] dark:text-[#e8e8e8] mb-1.5 line-clamp-2">
                        {position.marketQuestion || 'Market'}
                    </div>
                    <div className="text-sm text-[#555] dark:text-[#aaa] mb-1">
                        <span className="font-semibold text-[#333] dark:text-[#ccc]">{position.outcomeLabel}</span>
                        {' • '}
                        <span className="font-mono">{formatLamportsToSol(position.stakeLamports)} SOL</span>
                    </div>
                    {timeAgo && (
                        <div className="text-xs text-[#999] dark:text-[#666]">
                            {timeAgo}
                        </div>
                    )}
                </Link>
                {position.canClaim && (
                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-semibold text-sm flex-shrink-0">
                        <Trophy className="w-4 h-4" />
                        Won
                    </div>
                )}
            </div>

            {/* Visible Solscan button */}
            {position.txSignature && (
                <div className="mt-2">
                    <a
                        href={getTxExplorerUrl(position.txSignature)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center text-xs font-medium underline text-[#666] dark:text-[#c7c7c7] hover:text-[#111] dark:hover:text-white transition-colors"
                    >
                        View on Solscan
                    </a>
                </div>
            )}
        </div>
    );
};

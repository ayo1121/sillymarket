import { useNavigate, useLocation } from 'react-router-dom';
import { Home, TrendingUp, BarChart3, User } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * MOBILE FEATURE: Bottom Navigation Bar
 * 
 * Mobile-only bottom navigation bar with Win95 styling.
 * - Fixed positioning at bottom on mobile
 * - Hidden on desktop via CSS breakpoints (md and above)
 * - Win95 styled with raised borders and shadows
 * - Active state highlighting
 */
export const BottomNav = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const navItems = [
        {
            label: 'Markets',
            icon: Home,
            path: '/',
            isActive: location.pathname === '/',
        },
        {
            label: 'My Bets',
            icon: TrendingUp,
            path: '/my-bets',
            isActive: location.pathname === '/my-bets' && !location.search.includes('view=markets'),
        },
        {
            label: 'My Markets',
            icon: BarChart3,
            path: '/my-bets?view=markets',
            isActive: location.pathname === '/my-bets' && location.search.includes('view=markets'),
        },
        {
            label: 'Profile',
            icon: User,
            path: '/my-bets',
            isActive: false, // Profile doesn't have a dedicated page yet
        },
    ];

    return (
        <>
            {/* Spacer to prevent content from being hidden behind bottom nav */}
            <div className="h-16 md:hidden" aria-hidden="true" />

            {/* Bottom Navigation - Mobile Only */}
            <nav
                className={cn(
                    "fixed bottom-0 left-0 right-0 z-50",
                    "md:hidden", // Hidden on desktop
                    "bg-[#c0c0c0] dark:bg-[#1d1d1d]",
                    "border-t-2 border-white/60 dark:border-[#2d2d2d]",
                    "shadow-[0_-2px_8px_rgba(0,0,0,0.15)]",
                    "win95-raised"
                )}
                aria-label="Mobile navigation"
            >
                <div className="grid grid-cols-4 h-16">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.path}
                                onClick={() => navigate(item.path)}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1",
                                    "transition-all duration-200",
                                    "border-r border-[#8a8a8a]/30 dark:border-[#3a3a3a] last:border-r-0",
                                    "active:scale-95",
                                    // Touch target optimization - minimum 44px height
                                    "min-h-[44px]",
                                    item.isActive
                                        ? "bg-[#d4d4d4] dark:bg-[#2a2a2a] shadow-inner"
                                        : "hover:bg-[#d0d0d0] dark:hover:bg-[#252525]"
                                )}
                                aria-label={item.label}
                                aria-current={item.isActive ? 'page' : undefined}
                            >
                                <Icon
                                    className={cn(
                                        "w-5 h-5",
                                        item.isActive
                                            ? "text-[#111] dark:text-white"
                                            : "text-[#5f5f5f] dark:text-[#c7c7c7]"
                                    )}
                                />
                                <span
                                    className={cn(
                                        "text-[10px] font-bold uppercase tracking-wide",
                                        item.isActive
                                            ? "text-[#111] dark:text-white"
                                            : "text-[#5f5f5f] dark:text-[#c7c7c7]"
                                    )}
                                >
                                    {item.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </nav>
        </>
    );
};

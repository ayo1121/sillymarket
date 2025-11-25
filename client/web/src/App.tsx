import { lazy, Suspense } from 'react';
import AuthWalletGate from "@/components/AuthWalletGate";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { BottomNav } from "@/components/BottomNav";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { useClaimableWinnings } from "@/hooks/useClaimableWinnings";
import { HelmetProvider } from 'react-helmet-async';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { PendingTransactions } from '@/components/PendingTransactions';
import { MarketCardSkeletonGrid } from '@/components/skeletons/MarketCardSkeleton';
import { MarketDetailsSkeleton } from '@/components/skeletons/MarketDetailsSkeleton';

// Lazy load pages for code splitting
const Index = lazy(() => import('./pages/Index'));
const MyBets = lazy(() => import('./pages/MyBets'));
const MarketDetails = lazy(() => import('./pages/MarketDetails'));
const CreateMarket = lazy(() => import('./pages/CreateMarket'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const NotFound = lazy(() => import('./pages/NotFound'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));


/**
 * React Query Configuration
 * 
 * Stale-While-Revalidate Strategy:
 * - Show cached data instantly (staleTime: 30s)
 * - Keep data in cache for 5 minutes
 * - Refetch on window focus and reconnect
 * - No automatic polling (use real-time updates instead)
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale-while-revalidate: show cached data instantly
      staleTime: 30 * 1000, // 30 seconds - data considered fresh
      gcTime: 5 * 60 * 1000, // 5 minutes - keep in cache (formerly cacheTime)

      // Refetch strategies
      refetchOnWindowFocus: true, // Refetch when user returns to tab
      refetchOnReconnect: true, // Refetch when network reconnects
      refetchInterval: false, // Disable automatic polling (use real-time instead)

      // Retry configuration
      retry: 1, // Retry failed requests once
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});



/**
 * Loading component for lazy-loaded routes
 */
const PageLoader = () => (
  <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#1d1d1d] p-4">
    <MarketCardSkeletonGrid count={6} />
  </div>
);

/**
 * App wrapper with notifications detection
 * Detects claimable winnings and creates notifications
 */
const AppContent = () => {
  useClaimableWinnings();
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <NotificationsProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />

          {/* PWA Components */}
          <OfflineIndicator />
          <PendingTransactions />

          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/my-bets" element={<MyBets />} />
                <Route path="/market/:id" element={<MarketDetails />} />
                <Route path="/create-market" element={<CreateMarket />} />
                <Route path="/profile/:wallet" element={<UserProfile />} />
                <Route path="/terms-of-service" element={<TermsOfService />} />
                <Route path="/admin" element={<AdminPanel />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <BottomNav />
          <AppContent />
          <Analytics />
          <SpeedInsights />
        </TooltipProvider>
      </NotificationsProvider>
    </HelmetProvider>
  </QueryClientProvider>
);

export default App;

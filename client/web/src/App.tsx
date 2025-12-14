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
import { SillyCharacterWidget } from '@/components/SillyCharacterWidget';

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
 * Stale-While-Revalidate Strategy (Optimized for RPC Rate Limiting):
 * - Show cached data instantly (staleTime: 60s - increased from 30s)
 * - Keep data in cache for 10 minutes (increased from 5min)
 * - Disable refetch on window focus to reduce RPC spikes
 * - Refetch on reconnect (network recovery)
 * - Smart retry logic: don't retry on 429 errors
 * - No automatic polling (use real-time updates instead)
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale-while-revalidate: show cached data instantly
      staleTime: 60 * 1000, // 60 seconds - increased to reduce refetch frequency
      gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache longer

      // Refetch strategies (optimized to reduce RPC load)
      refetchOnWindowFocus: false, // Disabled to prevent RPC spikes when switching tabs
      refetchOnReconnect: true, // Refetch when network reconnects
      refetchInterval: false, // Disable automatic polling (use real-time instead)

      // Retry configuration (smart 429 handling)
      retry: (failureCount, error) => {
        // Don't retry on rate limit errors
        const errorMessage = (error as any)?.message?.toLowerCase() || '';
        if (
          errorMessage.includes('429') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('too many requests')
        ) {
          return false; // Stop retrying immediately
        }

        // Retry other errors up to 2 times
        return failureCount < 2;
      },
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
 * Error fallback for lazy loading failures
 */
const LazyLoadError = ({ error }: { error?: Error }) => (
  <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#1d1d1d] flex items-center justify-center p-4">
    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded p-6 max-w-md">
      <h1 className="text-2xl font-black mb-4">Loading Error</h1>
      <p className="text-muted-foreground mb-4">
        Failed to load page. This might be due to a network issue or browser cache.
      </p>
      {error && (
        <pre className="text-xs bg-[#f5f5f5] dark:bg-[#2a2a2a] p-3 rounded mb-4 overflow-auto">
          {error.message}
        </pre>
      )}
      <button
        onClick={() => window.location.reload()}
        className="bg-[#15a349] text-white px-4 py-2 rounded font-bold hover:bg-[#0d7a35]"
      >
        Reload Page
      </button>
    </div>
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
            <BottomNav />
            <SillyCharacterWidget />
          </BrowserRouter>
          <AppContent />
          <Analytics />
          <SpeedInsights />
        </TooltipProvider>
      </NotificationsProvider>
    </HelmetProvider>
  </QueryClientProvider>
);

export default App;

import AuthWalletGate from "@/components/AuthWalletGate";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import MyBets from "./pages/MyBets";
import MarketDetails from "./pages/MarketDetails";
import CreateMarket from "./pages/CreateMarket";
import AdminPanel from "./pages/AdminPanel";
import NotFound from "./pages/NotFound";
import TermsOfService from "./pages/TermsOfService";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/my-bets" element={<MyBets />} />
          <Route path="/market/:id" element={<MarketDetails />} />
          <Route path="/create-market" element={<CreateMarket />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route path="/admin" element={<AdminPanel />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
      <SpeedInsights />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

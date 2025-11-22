import { WalletIdentityProvider } from "./auth/walletIdentity";
import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./dev/ErrorBoundary";
import { WalletProvider } from "./solana/wallet";
import { MarketsProvider } from "./hooks/marketsContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <WalletIdentityProvider>
        <MarketsProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </MarketsProvider>
      </WalletIdentityProvider>
    </WalletProvider>
  </React.StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { WalletProvider } from "./solana/wallet";
import { MarketsProvider } from "./hooks/marketsContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <MarketsProvider>
        <App />
      </MarketsProvider>
    </WalletProvider>
  </React.StrictMode>
);

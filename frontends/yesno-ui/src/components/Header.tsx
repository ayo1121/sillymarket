// src/components/Header.tsx
"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import React, { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

// Load wallet button only on the client (prevents hydration mismatch)
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

// Owner from env
const OWNER_B58 = (process.env.NEXT_PUBLIC_OWNER ?? "").trim();

export default function Header() {
  const { publicKey, connected } = useWallet();

  const isOwner = useMemo(() => {
    try {
      if (!connected || !publicKey || !OWNER_B58) return false;
      return publicKey.equals(new PublicKey(OWNER_B58));
    } catch {
      return false;
    }
  }, [connected, publicKey]);

  return (
    <header className="w-full bg-[#c0c0c0] border-b-2 border-t-2 border-l-2 border-r-2 border-[#dfdfdf] border-b-[#808080] border-r-[#808080]">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between">
        {/* Logo/Title with Windows 95 style */}
        <Link 
          href="/" 
          className="font-bold text-black text-lg hover:underline"
          style={{ fontFamily: '"MS Sans Serif", Arial, sans-serif' }}
        >
          SILLYMARKET
        </Link>

        <nav className="flex items-center gap-2">
          {/* Only show Create when owner wallet is connected */}
          {isOwner && (
            <Link
              href="/create"
              className="btn95 px-3 py-1.5 text-sm font-medium"
              title="Create a new market"
            >
              ＋ New Market
            </Link>
          )}

          <Link 
            href="/positions" 
            className="btn95-ghost px-3 py-1.5 text-sm hover:underline"
          >
            My Positions
          </Link>

          {/* Client-only wallet button with Windows 95 styling */}
          <div className="wallet95-wrapper">
            <WalletMultiButton className="!bg-[#c0c0c0] !border !border-[#dfdfdf] !border-b-[#808080] !border-r-[#808080] !text-black !font-normal !text-sm !px-3 !py-1.5 hover:!bg-[#d0d0d0] active:!border-[#808080] active:!border-b-[#dfdfdf] active:!border-r-[#dfdfdf]" />
          </div>
        </nav>
      </div>

      <style jsx>{`
        /* Windows 95 button styles */
        .btn95 {
          background: #c0c0c0;
          border: 2px solid;
          border-color: #dfdfdf #808080 #808080 #dfdfdf;
          color: black;
          font-family: "MS Sans Serif", Arial, sans-serif;
          font-size: 11px;
          font-weight: normal;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
        }

        .btn95:hover {
          background: #d0d0d0;
        }

        .btn95:active {
          border-color: #808080 #dfdfdf #dfdfdf #808080;
        }

        .btn95-ghost {
          background: transparent;
          border: 1px solid transparent;
          color: black;
          font-family: "MS Sans Serif", Arial, sans-serif;
          font-size: 11px;
          font-weight: normal;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
        }

        .btn95-ghost:hover {
          text-decoration: underline;
          background: #00000010;
        }

        /* Override wallet button styles */
        .wallet95-wrapper :global(.wallet-adapter-button) {
          background: #c0c0c0 !important;
          border: 2px solid !important;
          border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
          color: black !important;
          font-family: "MS Sans Serif", Arial, sans-serif !important;
          font-size: 11px !important;
          font-weight: normal !important;
          height: auto !important;
          padding: 4px 12px !important;
        }

        .wallet95-wrapper :global(.wallet-adapter-button:hover) {
          background: #d0d0d0 !important;
        }

        .wallet95-wrapper :global(.wallet-adapter-button:active) {
          border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
        }

        .wallet95-wrapper :global(.wallet-adapter-button:not([disabled]):hover) {
          background: #d0d0d0 !important;
        }
      `}</style>
    </header>
  );
}

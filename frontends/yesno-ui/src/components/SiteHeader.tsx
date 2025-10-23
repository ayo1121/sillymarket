// src/components/SiteHeader.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';
import { OWNER } from '@/lib/constants';
import { ClientWalletButton } from '@/components/wallet/ClientWalletButton';
import Image from 'next/image';

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== '/' && pathname?.startsWith(href));

  return (
    <Link
      href={href}
      className={`win95-btn px-4 py-1.5 text-sm text-center h-full flex items-center justify-center ${
        active
          ? '!bg-[#000080] !text-white !border-[#000080]'
          : 'text-black hover:bg-[#d0d0d0]'
      }`}
    >
      {children}
    </Link>
  );
}

export default function SiteHeader() {
  const wallet = useWallet();
  const isOwner =
    !!wallet.publicKey && OWNER && wallet.publicKey.equals(OWNER);
  const [logoKey, setLogoKey] = useState(0);

  // Force refresh logo cache by remounting the component
  useEffect(() => {
    setLogoKey(prev => prev + 1);
  }, []);

  return (
    <header className="w-full bg-[#c0c0c0] border-2 border-t-[#dfdfdf] border-l-[#dfdfdf] border-b-[#808080] border-r-[#808080] sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-4 flex items-center justify-between gap-4 font-['MS_Sans_Serif'] h-12">
        {/* Left: logo */}
        <div className="flex items-center gap-0 h-full">
          <Link href="/" className="flex items-center shrink-0 no-underline h-full mr-2">
            {/* Logo container - FULL HEIGHT with no white borders */}
            <div className="h-full aspect-square relative flex items-center justify-center">
              <Image
                key={logoKey}
                src="/logo.png"
                alt="SILLYMARKET Logo"
                fill
                className="object-cover"
                style={{
                  filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.3))'
                }}
                priority
              />
            </div>
          </Link>

          {/* Navigation buttons with full height - sticking to home button */}
          <nav className="flex items-stretch gap-2 h-full">
            <NavLink href="/">Home</NavLink>
            <NavLink href="/positions">My Positions</NavLink>
            {isOwner && <NavLink href="/create">Create</NavLink>}
          </nav>
        </div>

        {/* Right: wallet connect */}
        <div className="flex items-center gap-2 shrink-0 h-full">
          <div className="win95-wallet-wrapper [&_*]:!text-sm h-full flex items-center">
            <ClientWalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}

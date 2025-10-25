'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { fetchMarketMetadata, getMarketNameWithFallback, type MarketMetadata } from '@/lib/program/metadata';

type MarketRow = { 
  pubkey: string; 
  lamports?: number;
  metadata?: MarketMetadata | null;
  name?: string;
};
type ApiOk = MarketRow[] | { items: MarketRow[] } | { data: MarketRow[] };

export default function MarketList() {
  const { connection } = useConnection();
  const [items, setItems] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        // Fetch market list from API
        const res = await fetch('/api/markets', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        const normalized: MarketRow[] = Array.isArray(body)
          ? (body as MarketRow[])
          : Array.isArray((body as any)?.items)
          ? ((body as any).items as MarketRow[])
          : Array.isArray((body as any)?.data)
          ? ((body as any).data as MarketRow[])
          : [];
        
        // Fetch metadata for each market from blockchain
        const withMetadata = await Promise.all(
          normalized.map(async (item) => {
            try {
              const pubkey = new PublicKey(item.pubkey);
              const metadata = await fetchMarketMetadata(connection, pubkey);
              const name = getMarketNameWithFallback(metadata, item.pubkey);
              return { ...item, metadata, name };
            } catch (e) {
              console.error(`Failed to fetch metadata for ${item.pubkey}:`, e);
              return { ...item, name: 'Unnamed Market' };
            }
          })
        );
        
        if (!cancelled) setItems(withMetadata);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [connection]);

  const hasItems = useMemo(() => items.length > 0, [items]);

  if (loading) {
    return <div className="rounded-lg border border-stroke bg-surface p-4 text-sm opacity-80">Loading markets…</div>;
  }
  if (err) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
        <div className="font-semibold">Error</div>
        <div className="opacity-80">Failed to load markets ({err}).</div>
      </div>
    );
  }
  if (!hasItems) {
    return (
      <div className="rounded-lg border border-stroke bg-surface p-4 text-sm opacity-80">
        No markets found.
        <div className="mt-2 text-xs opacity-70">
          Ensure <code>.env.local</code> has <code>NEXT_PUBLIC_PROGRAM_ID</code> and <code>NEXT_PUBLIC_RPC</code>, then refresh.
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.pubkey}>
          <Link
            href={`/market/${it.pubkey}`}
            className="flex flex-col rounded-lg border border-stroke bg-surface px-4 py-3 hover:border-white/20 hover:bg-white/10 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-semibold text-sm mb-1">{it.name || 'Unnamed Market'}</div>
                {it.metadata?.category && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded">
                    {it.metadata.category}
                  </span>
                )}
              </div>
              {typeof it.lamports === 'number' && (
                <span className="text-xs opacity-70">{it.lamports.toLocaleString()} lamports</span>
              )}
            </div>
            <div className="font-mono text-xs opacity-50 mt-2">{it.pubkey.slice(0, 8)}...{it.pubkey.slice(-8)}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

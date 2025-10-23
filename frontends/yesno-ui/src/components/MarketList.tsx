'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type MarketRow = { pubkey: string; lamports?: number; };
type ApiOk = MarketRow[] | { items: MarketRow[] } | { data: MarketRow[] };

export default function MarketList() {
  const [items, setItems] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
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
        if (!cancelled) setItems(normalized);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

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
            className="flex items-center justify-between rounded-lg border border-stroke bg-surface px-4 py-3 hover:border-white/20 hover:bg-white/10"
          >
            <span className="font-mono text-sm">{it.pubkey}</span>
            {typeof it.lamports === 'number' && (
              <span className="text-xs opacity-70">{it.lamports.toLocaleString()} lamports</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

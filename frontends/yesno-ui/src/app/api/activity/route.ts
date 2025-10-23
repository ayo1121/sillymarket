// src/app/api/activity/route.ts
import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

// Server-only RPC URL (put in .env, NOT exposed to client)
// HELIUS_RPC_URL="https://api.helius.xyz/v0/...."
const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  process.env.ALB_RPC_URL ||
  'https://api.devnet.solana.com';

const connection = new Connection(RPC_URL, { commitment: 'confirmed' });

// Tiny in-memory cache (per server worker)
type CacheEntry = { ts: number; data: any };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function validBase58(s: string) {
  try { new PublicKey(s); return true; } catch { return false; }
}

function parseMemoFromParsedTx(tx: any): string | null {
  try {
    const instrs = tx?.transaction?.message?.instructions ?? [];
    for (const ix of instrs) {
      if (ix?.program === 'spl-memo' && typeof ix?.parsed === 'string') return ix.parsed as string;
    }
    const logs: string[] = tx?.meta?.logMessages ?? [];
    for (let i = 0; i < logs.length; i++) {
      const line = logs[i] || '';
      if (/^Program log: Memo/i.test(line)) {
        const next = logs[i + 1] || '';
        if (next.startsWith('Program log: ')) return next.replace(/^Program log:\s*/, '');
      }
      const one = line.match(/^Program log:\s*Memo:\s*(.+)$/i);
      if (one) return one[1];
    }
  } catch {}
  return null;
}

type ActivityRow =
  | { type: 'place'; sig: string; ts: number | null; wallet: string; side: 'YES' | 'NO' | '?'; amount?: string }
  | { type: 'resolve'; sig: string; ts: number | null; wallet: string; outcome: 'YES' | 'NO' | '?' }
  | { type: 'claim'; sig: string; ts: number | null; wallet: string; amount?: string };

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  let running = 0;
  return await new Promise<R[]>((resolve) => {
    const next = () => {
      if (idx >= items.length && running === 0) return resolve(out);
      while (running < limit && idx < items.length) {
        const i = idx++;
        running++;
        fn(items[i], i)
          .then((r) => { out[i] = r; })
          .catch(() => { out[i] = undefined as any; })
          .finally(() => { running--; next(); });
      }
    };
    next();
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const market = (searchParams.get('market') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 12), 1), 20);
    const sigLimit = Math.min(Math.max(Number(searchParams.get('sigLimit') || 18), 5), 50);
    if (!market || !validBase58(market)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing "market" param' }, { status: 400 });
    }

    const cacheKey = `${market}:${limit}:${sigLimit}`;
    const now = Date.now();
    const hit = CACHE.get(cacheKey);
    if (hit && now - hit.ts < TTL_MS) {
      return NextResponse.json({ ok: true, source: 'cache', cachedAt: hit.ts, ttlMs: TTL_MS, rows: hit.data });
    }

    const marketPk = new PublicKey(market);
    const sigs = await connection.getSignaturesForAddress(marketPk, { limit: sigLimit }, 'confirmed');
    const slice = sigs.slice(0, sigLimit);
    const toParse = slice.slice(0, Math.min(limit, slice.length));

    const parsed = await mapLimit(
      toParse,
      3,
      async (s) => {
        await sleep(25);
        return await connection.getParsedTransaction(s.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
      }
    );

    const rows: ActivityRow[] = [];
    for (let i = 0; i < toParse.length; i++) {
      const ptx = parsed[i];
      if (!ptx) continue;

      const memoText = parseMemoFromParsedTx(ptx) || '';
      const keys = ptx?.transaction?.message?.accountKeys ?? [];
      const firstSigner = keys.find((k: any) => k?.signer)?.pubkey ?? keys[0]?.pubkey ?? '';
      const walletPk = typeof firstSigner === 'string' ? firstSigner : String(firstSigner || '');
      const ts = ptx?.blockTime ?? toParse[i].blockTime ?? null;

      const mPlace = memoText.match(/^Place\s+(YES|NO)\s+([0-9.]+)/i);
      if (mPlace) {
        rows.push({
          type: 'place',
          sig: toParse[i].signature,
          ts,
          wallet: walletPk,
          side: mPlace[1].toUpperCase() === 'YES' ? 'YES' : 'NO',
          amount: mPlace[2],
        });
        continue;
      }

      const mResolve = memoText.match(/^Resolve\s+(YES|NO)/i);
      if (mResolve) {
        rows.push({
          type: 'resolve',
          sig: toParse[i].signature,
          ts,
          wallet: walletPk,
          outcome: mResolve[1].toUpperCase() === 'YES' ? 'YES' : 'NO',
        });
        continue;
      }

      if (/^Claim\b/i.test(memoText)) {
        rows.push({
          type: 'claim',
          sig: toParse[i].signature,
          ts,
          wallet: walletPk,
        });
        continue;
      }
    }

    rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    CACHE.set(cacheKey, { ts: now, data: rows });
    return NextResponse.json({ ok: true, source: 'live', cachedAt: now, ttlMs: TTL_MS, rows });
  } catch (e: any) {
    console.error('API /api/activity error:', e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

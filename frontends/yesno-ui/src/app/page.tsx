// src/app/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { Idl, BorshCoder } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

import { useToast } from '@/components/ui/Toast';
import { loadYesNoIDL, getCoderOrNull } from '@/lib/idl';
import { getConnection } from '@/lib/actions/connection';

import { PROGRAM_ID, MINT, OWNER, DECIMALS, MINT_SYMBOL } from '@/lib/constants';
import { MintBadge } from '@/components/ui/MintBadge';
import { ConnectGate } from '@/components/ui/ConnectGate';
import { ShareModal } from '@/components/ShareModal';

/* ============================== small utils ============================== */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: new TextEncoder().encode(text),
  });
}

function atomsToUi6(atoms?: bigint) {
  if (atoms === undefined) return '-';
  const neg = atoms < 0n ? '-' : '';
  const a = atoms < 0n ? -atoms : atoms;
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, '0');
  return `${neg}${whole}.${frac}`;
}
function trimUi6(s: string) {
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/* ============================== local name cache ============================== */
const LS_KEY = 'ynb-market-names';
function getSavedMarketName(addr: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const v = map?.[addr];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/* ============================== decoding helpers ============================== */
type MarketRow = {
  addr: PublicKey;
  title: string;
  yesAtoms?: bigint;
  noAtoms?: bigint;
  cutoff?: number;
  resolved?: boolean;
  winner?: 'yes' | 'no' | null;
  mint?: string;
};

function bnLikeToBigint(v: any): bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (v && typeof v?.toString === 'function') return BigInt(v.toString());
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  return undefined;
}
function tsGuess(v: any): number | undefined {
  const n = bnLikeToBigint(v);
  if (n === undefined) return undefined;
  const t = Number(n);
  return t > 1e12 ? Math.floor(t / 1000) : t;
}
function extractKnownFields(decoded: any): Omit<MarketRow, 'addr' | 'title'> & { _title?: string } {
  const out: any = {};
  const keys = Object.keys(decoded ?? {});
  const l = keys.map((k) => k.toLowerCase());
  const get = (re: RegExp) => {
    const i = l.findIndex((k) => re.test(k));
    return i >= 0 ? decoded[keys[i]] : undefined;
  };

  const yes = get(/(^|_)yes($|_)|pool_yes|yes_pool|total_yes/);
  const no = get(/(^|_)no($|_)|pool_no|no_pool|total_no/);
  const yb = bnLikeToBigint(yes);
  const nb = bnLikeToBigint(no);
  if (yb !== undefined) out.yesAtoms = yb;
  if (nb !== undefined) out.noAtoms = nb;

  const cut = get(/(cut_?off|deadline|close|lock).*?(time|ts)?$/);
  const t = tsGuess(cut);
  if (t !== undefined) out.cutoff = t;

  const resolved = get(/(resolved|settled|closed)$/);
  if (typeof resolved === 'boolean') out.resolved = resolved;

  const rawWin = get(/(winner|result|winning|side|outcome)$/);
  if (typeof rawWin === 'string') {
    const w = rawWin.toLowerCase();
    out.winner = w === 'yes' ? 'yes' : w === 'no' ? 'no' : null;
  } else if (rawWin && (rawWin as any).__kind) {
    const w = String((rawWin as any).__kind).toLowerCase();
    out.winner = w === 'yes' ? 'yes' : w === 'no' ? 'no' : null;
  } else {
    const bn = bnLikeToBigint(rawWin);
    if (bn !== undefined) {
      const n = Number(bn);
      out.winner = n === 1 || n === 3 ? 'yes' : n === 0 || n === 2 ? 'no' : null;
    }
  }

  const mint = get(/^mint$/);
  if (mint) out.mint = String(mint);

  const titleCandidates = ['name', 'title', 'question', 'marketName'];
  for (const c of titleCandidates) {
    const v = decoded[c];
    if (typeof v === 'string' && v.trim()) { out._title = v.trim(); break; }
    if (v?.buffer instanceof ArrayBuffer) {
      try {
        const t2 = new TextDecoder().decode(new Uint8Array(v.buffer));
        const s = t2.replace(/\0+$/, '').trim();
        if (s) { out._title = s; break; }
      } catch {}
    }
    if (Array.isArray(v)) {
      try {
        const t3 = new TextDecoder().decode(Uint8Array.from(v));
        const s = t3.replace(/\0+$/, '').trim();
        if (s) { out._title = s; break; }
      } catch {}
    }
  }
  return out;
}

/* ============================== live cutoff timer ============================== */
function formatDur(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const rr = String(r).padStart(2, '0');
  return h > 0 ? `${h}h ${mm}m ${rr}s` : `${m}m ${rr}s`;
}

/* ============================== Odds mini (with timer & color fade) ============================== */
function OddsMini({
  yesAtoms, noAtoms, cutoff, flashYes, flashNo, deltaYes, deltaNo,
}: {
  yesAtoms?: bigint; noAtoms?: bigint; cutoff?: number;
  flashYes?: boolean; flashNo?: boolean;
  deltaYes?: number;  deltaNo?: number;
}) {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const data = useMemo(() => {
    if (yesAtoms === undefined || noAtoms === undefined) return null;
    const y = Number(yesAtoms);
    const n = Number(noAtoms);
    const t = y + n;
    if (t <= 0) return { yPct: 0, nPct: 0, pool: '0' };
    return {
      yPct: (y / t) * 100,
      nPct: (n / t) * 100,
      pool: trimUi6(atomsToUi6(BigInt(y + n))),
    };
  }, [yesAtoms, noAtoms]);

  const remaining = cutoff ? cutoff - now : undefined;

  if (!data) return <span className="opacity-60 text-black">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-black">
      <span className={`inline-flex items-center gap-1 ${flashYes ? 'animate-pulse' : ''}`} title="YES share">
        <span className="h-2 w-2 bg-emerald-600 inline-block" /> {data.yPct.toFixed(1)}%
        {deltaYes !== undefined && deltaYes !== 0 ? (
          <span className={`ml-1 ${deltaYes > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {deltaYes > 0 ? '▲' : '▼'}
          </span>
        ) : null}
      </span>
      <span className="opacity-50">/</span>
      <span className={`inline-flex items-center gap-1 ${flashNo ? 'animate-pulse' : ''}`} title="NO share">
        <span className="h-2 w-2 bg-rose-600 inline-block" /> {data.nPct.toFixed(1)}%
        {deltaNo !== undefined && deltaNo !== 0 ? (
          <span className={`ml-1 ${deltaNo > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {deltaNo > 0 ? '▲' : '▼'}
          </span>
        ) : null}
      </span>
      <span className="opacity-50">•</span>
      <span className="opacity-80" title="Total pool (YES+NO)">Pool {data.pool}</span>
      {typeof remaining === 'number' && (
        <>
          <span className="opacity-50">•</span>
          <span
            className={`opacity-80 ${remaining <= 300 ? 'text-rose-700' : remaining <= 3600 ? 'text-amber-700' : ''}`}
            title="Time to cutoff"
          >
            {remaining > 0 ? `Closes in ${formatDur(remaining)}` : 'Closed'}
          </span>
        </>
      )}
    </div>
  );
}

/* ============================== find sweep-fees ix in IDL ============================== */
function findSweepFeesIx(idl: Idl) {
  const list = idl.instructions ?? [];
  const score = (n: string) => {
    const s = n.toLowerCase();
    let v = 0;
    if (s.includes('sweep')) v += 6;
    if (s.includes('collect') || s.includes('withdraw')) v += 4;
    if (s.includes('fee')) v += 8;
    if (s.includes('fees')) v += 10;
    return v;
  };
  return [...list].sort((a, b) => score(b.name) - score(a.name))[0] ?? null;
}

/* ============================== Anchor discriminator helper ============================== */
async function disc8(name: string) {
  const msg = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest('SHA-256', msg);
  return new Uint8Array(hash).slice(0, 8);
}

/* ============================== Anchor Error Decoding ============================== */
const decodeAnchorError = (error: any): string => {
  if (!error) return 'Unknown error occurred';
  
  // Check for Anchor error logs
  if (error.logs && Array.isArray(error.logs)) {
    const errorLog = error.logs.find((log: string) => 
      log.includes('Error Message:') || log.includes('Program log: Error:')
    );
    
    if (errorLog) {
      // Extract the actual error message
      const message = errorLog
        .replace('Error Message: ', '')
        .replace('Program log: Error: ', '')
        .trim();
      return message || 'Anchor program error';
    }
    
    // Return all logs if no specific error message found
    return error.logs.join('\n');
  }
  
  // Check for transaction error
  if (error.message) {
    return error.message;
  }
  
  return String(error);
};

/* ============================== Enhanced Skeleton Loading ============================== */
function MarketSkeleton() {
  return (
    <div className="frame animate-pulse">
      <div className="titlebar h-6 bg-gradient-to-r from-gray-300 to-gray-200 mb-3 rounded"></div>
      <div className="frame-body p-3 space-y-3">
        <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded"></div>
        <div className="h-3 bg-gradient-to-r from-gray-200 to-gray-100 rounded w-3/4"></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="h-8 bg-gradient-to-r from-gray-200 to-gray-100 rounded"></div>
          <div className="h-8 bg-gradient-to-r from-gray-200 to-gray-100 rounded"></div>
        </div>
        <div className="h-3 bg-gradient-to-r from-gray-200 to-gray-100 rounded w-1/2"></div>
        <div className="h-8 bg-gradient-to-r from-gray-200 to-gray-100 rounded"></div>
      </div>
    </div>
  );
}

/* ============================== Enhanced Search with Suggestions ============================== */
function SearchSuggestions({ 
  search, 
  rows, 
  onSelect 
}: { 
  search: string; 
  rows: MarketRow[]; 
  onSelect: (title: string) => void;
}) {
  const suggestions = useMemo(() => {
    if (!search.trim() || search.length < 2) return [];
    
    const searchLower = search.toLowerCase();
    const uniqueTitles = new Set<string>();
    
    return rows
      .filter(m => 
        m.title.toLowerCase().includes(searchLower) || 
        m.addr.toBase58().toLowerCase().includes(searchLower)
      )
      .slice(0, 5) // Limit to 5 suggestions
      .filter(m => {
        if (uniqueTitles.has(m.title)) return false;
        uniqueTitles.add(m.title);
        return true;
      });
  }, [search, rows]);

  if (!suggestions.length || !search.trim()) return null;

  return (
    <div className="absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-b-lg shadow-lg z-50 max-h-60 overflow-y-auto">
      {suggestions.map((market, index) => (
        <button
          key={market.addr.toBase58()}
          className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
          onClick={() => onSelect(market.title)}
        >
          <div className="font-medium text-sm text-gray-800 truncate">
            {market.title}
          </div>
          <div className="text-xs text-gray-500 font-mono mt-1">
            {market.addr.toBase58().slice(0, 8)}...{market.addr.toBase58().slice(-8)}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs">
            <span className="text-emerald-600">YES: {market.yesAtoms ? trimUi6(atomsToUi6(market.yesAtoms)) : '0'}</span>
            <span className="text-rose-600">NO: {market.noAtoms ? trimUi6(atomsToUi6(market.noAtoms)) : '0'}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ============================== Enhanced Status Indicators ============================== */
function StatusIndicator({ 
  status, 
  winner,
  size = "md"
}: { 
  status: 'open' | 'locked' | 'resolved'; 
  winner?: 'yes' | 'no' | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-1.5 text-sm",
    lg: "px-4 py-2 text-base"
  };

  const statusConfig = {
    open: {
      bg: "bg-emerald-100",
      text: "text-emerald-800",
      border: "border-emerald-300",
      icon: "🟢",
      label: "OPEN"
    },
    locked: {
      bg: "bg-amber-100",
      text: "text-amber-800",
      border: "border-amber-300",
      icon: "🔒",
      label: "LOCKED"
    },
    resolved: {
      bg: winner === 'yes' ? "bg-emerald-100" : winner === 'no' ? "bg-rose-100" : "bg-blue-100",
      text: winner === 'yes' ? "text-emerald-800" : winner === 'no' ? "text-rose-800" : "text-blue-800",
      border: winner === 'yes' ? "border-emerald-300" : winner === 'no' ? "border-rose-300" : "border-blue-300",
      icon: winner === 'yes' ? "✅" : winner === 'no' ? "❌" : "⏳",
      label: winner === 'yes' ? "YES WON" : winner === 'no' ? "NO WON" : "RESOLVED"
    }
  };

  const config = statusConfig[status];

  return (
    <div className={`
      inline-flex items-center gap-2 rounded-full border font-semibold
      ${config.bg} ${config.text} ${config.border} ${sizeClasses[size]}
      transition-all duration-200 hover:scale-105
    `}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </div>
  );
}

/* ============================== Page ============================== */
export default function HomePage() {
  const { push } = useToast();
  const wallet = useWallet();
  const connection = getConnection();

  const [idl, setIdl] = useState<Idl | null>(null);
  const [coder, setCoder] = useState<BorshCoder | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'locked' | 'resolved'>('open');
  const [hideEmpty, setHideEmpty] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'cutoffDesc' | 'poolDesc'>('cutoffDesc');
  const [onlySweepable, setOnlySweepable] = useState<boolean>(false);

  // UI states
  const [mounted, setMounted] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);

  // secondary checkbox filters
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const [onlyRecent, setOnlyRecent] = useState(false);

  // watchlist & recent data
  const [watch, setWatch] = useState<Record<string, true>>(() => {
    try { return JSON.parse(localStorage.getItem('ynb-watch') || '{}'); } catch { return {}; }
  });

  const [recent, setRecent] = useState<Array<{ addr: string; title: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('ynb-recent') || '[]'); } catch { return []; }
  });
  const recentOrder = useMemo(() => {
    const map: Record<string, number> = {};
    recent.forEach((r, i) => { map[r.addr] = i; });
    return map;
  }, [recent]);

  // sweep meta
  const [busySweepId, setBusySweepId] = useState<string | null>(null);
  const [busySweepAll, setBusySweepAll] = useState<boolean>(false);
  const [sweepIx, setSweepIx] = useState<any | null>(null);
  const [sweepableMap, setSweepableMap] = useState<Record<string, boolean>>({}); // addr -> hasFees?

  // odds-diff memory (for flash + biggest movers)
  const prevPoolsRef = useRef<Record<string, { y: number; n: number }>>({});
  const [flashYes, setFlashYes] = useState<Record<string, true>>({});
  const [flashNo, setFlashNo] = useState<Record<string, true>>({});
  const [deltas, setDeltas] = useState<Record<string, { dYes: number; dNo: number }>>({});
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  // cluster / slot for status bar
  const [slot, setSlot] = useState<number | null>(null);
  const cluster = useMemo(() => {
    const ep = connection.rpcEndpoint.toLowerCase();
    if (ep.includes('devnet')) return 'devnet';
    if (ep.includes('testnet')) return 'testnet';
    if (ep.includes('mainnet')) return 'mainnet';
    return 'custom';
  }, [connection.rpcEndpoint]);

  // infinite scroll
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // live updates polling
  const [pendingUpdates, setPendingUpdates] = useState<{ changed: number; snapshot: MarketRow[] } | null>(null);

  // share modal and card refs
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareImg, setShareImg] = useState<string | null>(null);
  const [shareTitle, setShareTitle] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isOwner = wallet.publicKey?.equals(OWNER) ?? false;

  // Load IDL once
  useEffect(() => {
    (async () => {
      try {
        const loaded = await loadYesNoIDL();
        if (!loaded) throw new Error('IDL JSON not found (src/idl/yesno_bets.json)');
        setIdl(loaded);
        setCoder(getCoderOrNull(loaded));
        const s = findSweepFeesIx(loaded);
        if (s) setSweepIx(s);
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load IDL');
      }
    })();
  }, []);

  // Scan program accounts
  const baseScan = useCallback(async (): Promise<MarketRow[]> => {
    if (!idl || !coder) return [];
    const accs = await connection.getProgramAccounts(PROGRAM_ID, { commitment: 'processed' });

    const accountNames = (idl.accounts ?? []).map((a) => a.name);
    const prefer = [
      ...accountNames.filter((n) => /market/i.test(n)),
      ...accountNames.filter((n) => !/market/i.test(n)),
    ];

    const out: MarketRow[] = [];
    for (const a of accs.slice(0, 200)) {
      let decoded: any | null = null;
      let title = a.pubkey.toBase58();

      for (const nm of prefer) {
        try {
          decoded = coder!.accounts.decode(nm, a.account.data);
          if (decoded) break;
        } catch {}
      }
      if (!decoded) continue;

      const fields = extractKnownFields(decoded);
      if (fields.mint && new PublicKey(fields.mint).toBase58() !== MINT.toBase58()) continue;

      const saved = getSavedMarketName(a.pubkey.toBase58());
      if (saved) title = saved;
      else if (fields._title) title = fields._title;

      out.push({
        addr: a.pubkey,
        title,
        yesAtoms: fields.yesAtoms,
        noAtoms: fields.noAtoms,
        cutoff: fields.cutoff,
        resolved: fields.resolved,
        winner: fields.winner ?? null,
        mint: fields.mint,
      });

      if (out.length % 25 === 0) await sleep(15);
    }
    return out;
  }, [idl, coder, connection]);

  const refresh = useCallback(async () => {
    if (!idl || !coder) return;
    setLoading(true);
    setErr(null);

    try {
      const out = await baseScan();

      // Compute diffs vs previous snapshot (for flash + movers)
      const prev = prevPoolsRef.current;
      const flashesY: Record<string, true> = {};
      const flashesN: Record<string, true> = {};
      const d: Record<string, { dYes: number; dNo: number }> = {};
      out.forEach((m) => {
        const y = Number(m.yesAtoms ?? 0n);
        const n = Number(m.noAtoms ?? 0n);
        const t = y + n || 1;
        const yPct = (y / t) * 100;
        const nPct = (n / t) * 100;

        const p = prev[m.addr.toBase58()];
        if (p) {
          const tPrev = (p.y + p.n) || 1;
          const yPrevPct = (p.y / tPrev) * 100;
          const nPrevPct = (p.n / tPrev) * 100;
          const dY = +(yPct - yPrevPct).toFixed(1);
          const dN = +(nPct - nPrevPct).toFixed(1);
          if (dY !== 0) flashesY[m.addr.toBase58()] = true;
          if (dN !== 0) flashesN[m.addr.toBase58()] = true;
          d[m.addr.toBase58()] = { dYes: dY, dNo: dN };
        } else {
          d[m.addr.toBase58()] = { dYes: 0, dNo: 0 };
        }
        prev[m.addr.toBase58()] = { y, n };
      });
      setDeltas(d);
      setFlashYes(flashesY);
      setFlashNo(flashesN);
      setTimeout(() => { setFlashYes({}); setFlashNo({}); }, 200); // 200ms subtle flash

      setRows(out);
      setLastRefreshedAt(Date.now());
      setSlot(await connection.getSlot('processed').catch(() => null));
      setVisibleCount(20); // reset infinite window on fresh query
      setPendingUpdates(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load markets');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [idl, coder, connection, baseScan]);

  useEffect(() => { refresh(); }, [refresh]);

  // Quiet polling for live updates (notify but don't auto-apply)
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        if (!idl || !coder) return;
        const snap = await baseScan();
        // count changes in YES/NO pct vs current rows
        const current = new Map(rows.map(r => [r.addr.toBase58(), r]));
        let changed = 0;
        snap.forEach(m => {
          const cur = current.get(m.addr.toBase58());
          if (!cur) return;
          const y = Number(m.yesAtoms ?? 0n), n = Number(m.noAtoms ?? 0n);
          const t = y + n || 1;
          const yPct = (y / t) * 100;
          const yn = Number(cur.yesAtoms ?? 0n), nn = Number(cur.noAtoms ?? 0n);
          const tt = yn + nn || 1;
          const yPctPrev = (yn / tt) * 100;
          if (+yPct.toFixed(1) !== +yPctPrev.toFixed(1)) changed++;
        });
        if (changed > 0) setPendingUpdates({ changed, snapshot: snap });
      } catch {}
    }, 12000);
    return () => clearInterval(id);
  }, [idl, coder, rows, baseScan]);

  // Apply quiet snapshot when requested
  const applyPending = useCallback(() => {
    if (!pendingUpdates) return;
    setRows(pendingUpdates.snapshot);
    setLastRefreshedAt(Date.now());
    setPendingUpdates(null);
  }, [pendingUpdates]);

  // Probe which markets have sweepable fees
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rows.length) { setSweepableMap({}); return; }
      const next: Record<string, boolean> = {};
      const BATCH = 8;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (m) => {
            try {
              const [vaultAuth] = PublicKey.findProgramAddressSync(
                [new TextEncoder().encode('vault-auth'), m.addr.toBuffer()],
                PROGRAM_ID
              );
              const vaultAta = getAssociatedTokenAddressSync(MINT, vaultAuth, true);
              const info = await connection.getTokenAccountBalance(vaultAta, 'processed').catch(() => null);
              const vaultAtoms = info?.value?.amount != null ? BigInt(info.value.amount) : 0n;
              const pool = (m.yesAtoms ?? 0n) + (m.noAtoms ?? 0n);
              const pending = vaultAtoms > pool ? vaultAtoms - pool : 0n;
              next[m.addr.toBase58()] = pending > 0n;
            } catch {
              next[m.addr.toBase58()] = false;
            }
          })
        );
        if (cancelled) return;
        await sleep(40);
      }
      if (!cancelled) setSweepableMap(next);
    })();
    return () => { cancelled = true; };
  }, [rows, connection]);

  /* ============================== SWEEP FEES (owner, per-market + batch) ============================== */
  async function ensureAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const info = await connection.getAccountInfo(ata, 'processed');
    if (info) return { ata, ix: null as TransactionInstruction | null };
    const ix = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return { ata, ix };
  }

  function mapSweepAccount(
    nameRaw: string,
    ctx: {
      ownerPk: PublicKey;
      market: PublicKey;
      mint: PublicKey;
      vaultAuth: PublicKey;
      vaultAta: PublicKey;
      ownerFeeAta: PublicKey;
    }
  ): PublicKey {
    const n = nameRaw.toLowerCase().replace(/\s+/g, '');
    if (n === 'owner') return ctx.ownerPk;
    if (n === 'market') return ctx.market;
    if (['bet_mint', 'betmint', 'mint'].includes(n)) return ctx.mint;
    if (['vault_authority', 'vaultauthority'].includes(n)) return ctx.vaultAuth;
    if (n === 'vault') return ctx.vaultAta;
    if (['owner_fee_ata', 'ownerfeeata'].includes(n)) return ctx.ownerFeeAta;
    if (['token_program', 'tokenprogram'].includes(n)) return TOKEN_PROGRAM_ID;
    if (['associated_token_program', 'associatedtokenprogram'].includes(n)) return ASSOCIATED_TOKEN_PROGRAM_ID;
    if (['system_program', 'systemprogram'].includes(n)) return SystemProgram.programId;
    if (n === 'rent') return SYSVAR_RENT_PUBKEY;
    throw new Error(`Unmapped account in IDL for sweep_fees: ${nameRaw}`);
  }

  const onSweepOne = useCallback(
    async (marketPk: PublicKey) => {
      if (!wallet.publicKey || !idl) return;
      const isOwner = wallet.publicKey.equals(OWNER);
      if (!isOwner) return;

      setBusySweepId(marketPk.toBase58());
      try {
        const ixDef =
          (idl.instructions ?? []).find((i: any) => i.name.toLowerCase() === 'sweep_fees') ?? {
            name: 'sweep_fees',
            accounts: [
              { name: 'owner', isMut: true, isSigner: true },
              { name: 'market', isMut: true, isSigner: false },
              { name: 'bet_mint', isMut: false, isSigner: false },
              { name: 'vault_authority', isMut: false, isSigner: false },
              { name: 'vault', isMut: true, isSigner: false },
              { name: 'owner_fee_ata', isMut: true, isSigner: false },
              { name: 'token_program', isMut: false, isSigner: false },
              { name: 'associated_token_program', isMut: false, isSigner: false },
              { name: 'system_program', isMut: false, isSigner: false },
              { name: 'rent', isMut: false, isSigner: false },
            ],
            args: [],
          };

        const [vaultAuth] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('vault-auth'), marketPk.toBuffer()],
          PROGRAM_ID
        );
        const vaultAta = getAssociatedTokenAddressSync(MINT, vaultAuth, true);
        const ownerFeeAta = getAssociatedTokenAddressSync(MINT, OWNER, false);

        const needOwner = await ensureAtaIx(OWNER, OWNER, MINT);

        const ctx = { ownerPk: OWNER, market: marketPk, mint: MINT, vaultAuth, vaultAta, ownerFeeAta };
        const forceWritable = new Set(['market', 'vault', 'owner_fee_ata']);

        const keys = (ixDef.accounts as any[]).map((a) => {
          const pk = mapSweepAccount(a.name, ctx);
          const isSigner = !!a.isSigner || a.name.toLowerCase() === 'owner';
          const isWritable = forceWritable.has(a.name.toLowerCase()) ? true : !!a.isMut;
          return { pubkey: pk, isSigner, isWritable };
        });

        const data = await disc8(ixDef.name);
        const ixs: TransactionInstruction[] = [
          memoIx(`SweepFees:${marketPk.toBase58().slice(0, 8)}`, OWNER),
          ...(needOwner.ix ? [needOwner.ix] : []),
          new TransactionInstruction({ programId: PROGRAM_ID, keys, data }),
        ];

        const { blockhash } = await connection.getLatestBlockhash('processed');
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = OWNER;
        tx.add(...ixs);

        const sig = await wallet.sendTransaction(tx, connection, {
          skipPreflight: false,
          preflightCommitment: 'processed',
          maxRetries: 3,
        });

        const ep = connection.rpcEndpoint.toLowerCase();
        const href = ep.includes('devnet')
          ? `https://solscan.io/tx/${sig}?cluster=devnet`
          : ep.includes('testnet')
          ? `https://solscan.io/tx/${sig}?cluster=testnet`
          : `https://solscan.io/tx/${sig}`;

        push({ variant: 'success', title: 'Fees swept', message: `${sig.slice(0, 8)}…`, href });
      } catch (e: any) {
        const decodedError = decodeAnchorError(e);
        push({ variant: 'error', title: 'Sweep fees', message: decodedError.slice(0, 300) });
      } finally {
        setBusySweepId(null);
      }
    },
    [idl, wallet.publicKey, connection, push]
  );

  // Batch sweep (when filtered to sweepables)
  const onSweepAll = useCallback(async () => {
    if (!wallet.publicKey?.equals(OWNER) || !idl) return;
    const targets = filtered.filter(m => sweepableMap[m.addr.toBase58()]);
    if (!targets.length) return;

    setBusySweepAll(true);
    try {
      const ixDef =
        (idl.instructions ?? []).find((i: any) => i.name.toLowerCase() === 'sweep_fees') ??
        { name: 'sweep_fees', accounts: [
          { name: 'owner', isMut: true, isSigner: true },
          { name: 'market', isMut: true, isSigner: false },
          { name: 'bet_mint', isMut: false, isSigner: false },
          { name: 'vault_authority', isMut: false, isSigner: false },
          { name: 'vault', isMut: true, isSigner: false },
          { name: 'owner_fee_ata', isMut: true, isSigner: false },
          { name: 'token_program', isMut: false, isSigner: false },
          { name: 'associated_token_program', isMut: false, isSigner: false },
          { name: 'system_program', isMut: false, isSigner: false },
          { name: 'rent', isMut: false, isSigner: false },
        ], args: [] };

      const needOwner = await ensureAtaIx(OWNER, OWNER, MINT);
      const data = await disc8(ixDef.name);

      const { blockhash } = await connection.getLatestBlockhash('processed');
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = OWNER;

      if (needOwner.ix) tx.add(needOwner.ix);
      for (const m of targets) {
        const [vaultAuth] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('vault-auth'), m.addr.toBuffer()],
          PROGRAM_ID
        );
        const vaultAta = getAssociatedTokenAddressSync(MINT, vaultAuth, true);
        const ownerFeeAta = getAssociatedTokenAddressSync(MINT, OWNER, false);
        const ctx = { ownerPk: OWNER, market: m.addr, mint: MINT, vaultAuth, vaultAta, ownerFeeAta };
        const forceWritable = new Set(['market', 'vault', 'owner_fee_ata']);
        const keys = (ixDef.accounts as any[]).map((a) => {
          const pk = mapSweepAccount(a.name, ctx);
          const isSigner = !!a.isSigner || a.name.toLowerCase() === 'owner';
          const isWritable = forceWritable.has(a.name.toLowerCase()) ? true : !!a.isMut;
          return { pubkey: pk, isSigner, isWritable };
        });
        tx.add(memoIx(`SweepFees:${m.addr.toBase58().slice(0, 8)}`, OWNER));
        tx.add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
      }

      const sig = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false, preflightCommitment: 'processed', maxRetries: 3,
      });
      const ep = connection.rpcEndpoint.toLowerCase();
      const href = ep.includes('devnet')
        ? `https://solscan.io/tx/${sig}?cluster=devnet`
        : ep.includes('testnet')
        ? `https://solscan.io/tx/${sig}?cluster=testnet`
        : `https://solscan.io/tx/${sig}`;
      push({ variant: 'success', title: `Swept ${targets.length} market(s)`, message: sig.slice(0,8)+'…', href });
    } catch (e: any) {
      const decodedError = decodeAnchorError(e);
      push({ variant: 'error', title: 'Sweep all', message: decodedError.slice(0, 300) });
    } finally {
      setBusySweepAll(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idl, wallet.publicKey, connection, push, /* filtered & sweepableMap used at call-time */]);

  /* ============================== Keyboard shortcuts ============================== */
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'r') refresh();
      if (e.key === 'o') setStatusFilter('open');
      if (e.key === 'l') setStatusFilter('locked');
      if (e.key === 'v') setStatusFilter('resolved');
      if (e.key === 'f' && (wallet.publicKey?.equals(OWNER))) setOnlySweepable(v => !v);
      if (e.key === '?' || e.key === 'h') setShowShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, wallet.publicKey]);

  /* ============================== derived lists & counts ============================== */
  const nowSec = Math.floor(Date.now() / 1000);

  // Apply secondary checkbox filters then general filters
  const baseList = useMemo(() => {
    let list = [...rows];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q) || m.addr.toBase58().toLowerCase().includes(q));
    }

    if (hideEmpty) {
      list = list.filter((m) => (m.yesAtoms ?? 0n) + (m.noAtoms ?? 0n) > 0n);
    }

    // Watchlist checkbox
    if (onlyWatchlist) {
      const watched = new Set(Object.keys(watch));
      if (watched.size) {
        list = list.filter((m) => watched.has(m.addr.toBase58()));
      } else {
        list = [];
      }
    }

    // Recent checkbox
    if (onlyRecent) {
      if (recent.length) {
        const set = new Set(recent.map((r) => r.addr));
        list = list.filter((m) => set.has(m.addr.toBase58()));
        list.sort((a, b) => (recentOrder[a.addr.toBase58()] ?? 9999) - (recentOrder[b.addr.toBase58()] ?? 9999));
      } else {
        list = [];
      }
    }

    if (wallet.publicKey?.equals(OWNER) && onlySweepable) {
      list = list.filter((m) => sweepableMap[m.addr.toBase58()]);
    }
    return list;
  }, [rows, search, hideEmpty, onlyWatchlist, onlyRecent, watch, recent, recentOrder, onlySweepable, sweepableMap, wallet.publicKey]);

  // counts for status chips based on the base list
  const statusCounts = useMemo(() => {
    let open = 0, locked = 0, resolved = 0;
    for (const m of baseList) {
      const st = m.resolved ? 'resolved' : m.cutoff ? (nowSec < m.cutoff ? 'open' : 'locked') : 'locked';
      if (st === 'open') open++; else if (st === 'locked') locked++; else resolved++;
    }
    return { open, locked, resolved };
  }, [baseList, nowSec]);

  // finally apply the selected status + sorting
  const filtered = useMemo(() => {
    let list = baseList.filter((m) => {
      const st = m.resolved ? 'resolved' : m.cutoff ? (nowSec < m.cutoff ? 'open' : 'locked') : 'locked';
      return st === statusFilter;
    });

    if (sortBy === 'cutoffDesc') {
      const val = (m: MarketRow) => (typeof m.cutoff === 'number' ? m.cutoff : -Infinity);
      list.sort((a, b) => val(b) - val(a));
    } else {
      const pool = (m: MarketRow) => Number((m.yesAtoms ?? 0n) + (m.noAtoms ?? 0n));
      list.sort((a, b) => pool(b) - pool(a));
    }
    return list;
  }, [baseList, statusFilter, sortBy, nowSec]);

  // Biggest movers (top 3)
  const movers = useMemo(() => {
    const arr: Array<{ m: MarketRow; mag: number; d: { dYes: number; dNo: number } }> = [];
    for (const m of rows) {
      const dk = deltas[m.addr.toBase58()];
      if (!dk) continue;
      const mag = Math.max(Math.abs(dk.dYes), Math.abs(dk.dNo));
      if (mag === 0) continue;
      arr.push({ m, mag, d: dk });
    }
    return arr.sort((a, b) => b.mag - a.mag).slice(0, 3);
  }, [rows, deltas]);

  // visible slice for infinite scroll
  useEffect(
    () => setVisibleCount(20),
    [search, statusFilter, onlyWatchlist, onlyRecent, hideEmpty, sortBy, onlySweepable]
  );
  const visible = filtered.slice(0, visibleCount);

  /* ============================== helpers ============================== */
  const toggleWatch = (addr: string) => {
    setWatch(prev => {
      const next = { ...prev };
      if (next[addr]) delete next[addr];
      else next[addr] = true;
      localStorage.setItem('ynb-watch', JSON.stringify(next));
      return next;
    });
  };

  const pushRecent = (addr: string, title: string) => {
    setRecent(prev => {
      const next = [{ addr, title }, ...prev.filter(x => x.addr !== addr)].slice(0, 12);
      localStorage.setItem('ynb-recent', JSON.stringify(next));
      return next;
    });
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('open');
    setHideEmpty(false);
    setSortBy('cutoffDesc');
    setOnlySweepable(false);
    setOnlyWatchlist(false);
    setOnlyRecent(false);
    setVisibleCount(20);
  };

  // infinite scroll observer
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(c => (c < filtered.length ? c + 20 : c));
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);

  // Mount effect for client-side only features
  useEffect(() => setMounted(true), []);

/* ============================== Fixed Share Function ============================== */
const handleShare = useCallback(async (addrStr: string, m: MarketRow) => {
  const url = `${location.origin}/market/${addrStr}`;
  setShareTitle(m.title);
  setShareUrl(url);
  setShareImg(null);
  setShareOpen(true);

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    // Set dimensions for a clean market card style
    canvas.width = 420;
    canvas.height = 320;

    // ===== CLEAN WHITE BACKGROUND =====
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ===== WINDOWS 95 STYLE BORDER =====
    // Outer shadow
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    
    // Inner highlight
    ctx.strokeStyle = '#dfdfdf';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

    // ===== TITLE BAR =====
    const titleBarHeight = 28;
    ctx.fillStyle = '#000080'; // Windows 95 blue
    ctx.fillRect(4, 4, canvas.width - 8, titleBarHeight);
    
    // Title text (left aligned)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px "MS Sans Serif", Arial, sans-serif';
    const title = m.title.length > 35 ? m.title.substring(0, 35) + '...' : m.title;
    ctx.fillText(title, 12, 22);

    // Status badge (right aligned)
    const status = m.resolved ? 'RESOLVED' : m.cutoff ? (Math.floor(Date.now()/1000) < m.cutoff ? 'OPEN' : 'LOCKED') : 'UNKNOWN';
    const statusColor = status === 'OPEN' ? '#10b981' : status === 'RESOLVED' ? '#3b82f6' : '#f59e0b';
    ctx.fillStyle = statusColor;
    ctx.font = 'bold 11px "MS Sans Serif", Arial, sans-serif';
    const statusWidth = ctx.measureText(status).width;
    ctx.fillText(status, canvas.width - statusWidth - 12, 22);

    // ===== CONTENT SECTIONS =====
    let currentY = titleBarHeight + 12;

    // Market Address Section
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(8, currentY, canvas.width - 16, 24);
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, currentY, canvas.width - 16, 24);
    
    ctx.fillStyle = '#000000';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(`${addrStr.slice(0, 18)}...${addrStr.slice(-10)}`, 14, currentY + 15);
    
    currentY += 32;

    // ===== ODDS SECTION =====
    // Calculate odds
    const yesAtoms = Number(m.yesAtoms ?? 0n);
    const noAtoms = Number(m.noAtoms ?? 0n);
    const total = yesAtoms + noAtoms;
    const yesPct = total > 0 ? (yesAtoms / total * 100) : 0;
    const noPct = total > 0 ? (noAtoms / total * 100) : 0;
    const pool = trimUi6(atomsToUi6(BigInt(total)));

    // Odds container
    const oddsHeight = 80;
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(8, currentY, canvas.width - 16, oddsHeight);
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, currentY, canvas.width - 16, oddsHeight);

    const oddsContentY = currentY + 15;
    const barWidth = canvas.width - 140; // Leave space for labels and pool info

    // YES Section
    const yesY = oddsContentY;
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 12px "MS Sans Serif", Arial, sans-serif';
    ctx.fillText(`YES`, 20, yesY);
    
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px "MS Sans Serif", Arial, sans-serif';
    ctx.fillText(`${yesPct.toFixed(1)}%`, 70, yesY);

    // YES progress bar
    const yesBarY = yesY + 8;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(20, yesBarY, barWidth, 12);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(20, yesBarY, barWidth * (yesPct / 100), 12);
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, yesBarY, barWidth, 12);

    // NO Section
    const noY = oddsContentY + 35;
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 12px "MS Sans Serif", Arial, sans-serif';
    ctx.fillText(`NO`, 20, noY);
    
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px "MS Sans Serif", Arial, sans-serif';
    ctx.fillText(`${noPct.toFixed(1)}%`, 70, noY);

    // NO progress bar
    const noBarY = noY + 8;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(20, noBarY, barWidth, 12);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(20, noBarY, barWidth * (noPct / 100), 12);
    ctx.strokeStyle = '#808080';
    ctx.strokeRect(20, noBarY, barWidth, 12);

    // Pool information (right side, centered vertically)
    const poolX = barWidth + 50;
    const poolCenterY = currentY + (oddsHeight / 2);
    ctx.fillStyle = '#666666';
    ctx.font = '11px "MS Sans Serif", Arial, sans-serif';
    ctx.fillText(`Total Pool:`, poolX, poolCenterY - 5);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px "MS Sans Serif", Arial, sans-serif';
    ctx.fillText(pool, poolX, poolCenterY + 10);

    currentY += oddsHeight + 8;

    // ===== STATUS/RESOLUTION SECTION =====
    const statusSectionY = currentY;
    const statusHeight = 40;

    if (m.resolved) {
      // Resolution banner
      ctx.fillStyle = m.winner === 'yes' ? '#d1fae5' : '#fee2e2';
      ctx.fillRect(8, statusSectionY, canvas.width - 16, statusHeight);
      ctx.strokeStyle = m.winner === 'yes' ? '#10b981' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(8, statusSectionY, canvas.width - 16, statusHeight);
      
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 14px "MS Sans Serif", Arial, sans-serif';
      const winnerText = `🎉 ${m.winner?.toUpperCase()} WON`;
      const winnerWidth = ctx.measureText(winnerText).width;
      ctx.fillText(winnerText, (canvas.width - winnerWidth) / 2, statusSectionY + 24);
      
      // Multiple if available
      const winPool = m.winner === 'yes' ? yesAtoms : noAtoms;
      const multiple = winPool > 0 ? (total / winPool) : 1;
      if (multiple > 1) {
        ctx.font = '11px "MS Sans Serif", Arial, sans-serif';
        const multipleText = `${multiple.toFixed(2)}× return for winners`;
        const multipleWidth = ctx.measureText(multipleText).width;
        ctx.fillText(multipleText, (canvas.width - multipleWidth) / 2, statusSectionY + 38);
      }
    } else if (m.cutoff) {
      // Countdown information
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(8, statusSectionY, canvas.width - 16, statusHeight);
      ctx.strokeStyle = '#c0c0c0';
      ctx.lineWidth = 1;
      ctx.strokeRect(8, statusSectionY, canvas.width - 16, statusHeight);
      
      const now = Math.floor(Date.now() / 1000);
      const remaining = m.cutoff - now;
      
      if (remaining > 0) {
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        ctx.fillStyle = remaining <= 3600 ? '#ef4444' : '#000000';
        ctx.font = 'bold 13px "MS Sans Serif", Arial, sans-serif';
        const timeText = `⏰ Closes in ${hours}h ${minutes}m`;
        const timeWidth = ctx.measureText(timeText).width;
        ctx.fillText(timeText, (canvas.width - timeWidth) / 2, statusSectionY + 24);

        // Time progress bar (only if there's space)
        if (remaining > 0) {
          const progressBarY = statusSectionY + 30;
          const progress = Math.max(5, (1 - remaining / 86400) * 100);
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(20, progressBarY, canvas.width - 40, 6);
          ctx.fillStyle = remaining <= 3600 ? '#ef4444' : '#10b981';
          ctx.fillRect(20, progressBarY, (canvas.width - 40) * (progress / 100), 6);
        }
      } else {
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 13px "MS Sans Serif", Arial, sans-serif';
        ctx.fillText('🔒 Trading Closed', (canvas.width - 120) / 2, statusSectionY + 24);
      }
    }

    currentY += statusHeight + 8;

    // ===== FOOTER =====
    ctx.fillStyle = '#666666';
    ctx.font = '10px "MS Sans Serif", Arial, sans-serif';
    const footerText = 'sillymarket.fun';
    const footerWidth = ctx.measureText(footerText).width;
    ctx.fillText(footerText, canvas.width - footerWidth - 12, canvas.height - 12);

    // ===== FINAL BORDER =====
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    const dataUrl = canvas.toDataURL('image/png', 1.0);
    setShareImg(dataUrl);

  } catch (error) {
    console.error('Share image generation failed:', error);
  }
}, []);

 /* ============================== Enhanced UI ============================== */
  return (
<div className="desktop p-4 md:p-6 space-y-6 min-h-screen">
      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="frame max-w-md w-full">
            <div className="titlebar flex justify-between items-center">
              <div className="title">Keyboard Shortcuts</div>
              <button className="btn95-ghost" onClick={() => setShowShortcuts(false)}>✕</button>
            </div>
            <div className="frame-body p-4 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span>Focus search</span>
                <kbd className="chip95 px-2 py-1">/</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span>Refresh markets</span>
                <kbd className="chip95 px-2 py-1">r</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span>Show open markets</span>
                <kbd className="chip95 px-2 py-1">o</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span>Show locked markets</span>
                <kbd className="chip95 px-2 py-1">l</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span>Show resolved markets</span>
                <kbd className="chip95 px-2 py-1">v</kbd>
              </div>
              {isOwner && (
                <div className="flex justify-between items-center">
                  <span>Toggle sweepable filter</span>
                  <kbd className="chip95 px-2 py-1">f</kbd>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span>Show this help</span>
                <kbd className="chip95 px-2 py-1">?</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero Section with Metrics */}
      <div className="frame">
        <div className="titlebar">
          <div className="title">MARKET OVERVIEW</div>
        </div>
        <div className="frame-body grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
          <div className="text-center p-3 bg-gray-50 rounded border">
            <div className="text-2xl font-bold text-emerald-600">{rows.length}</div>
            <div className="text-xs text-black mt-1">Total Markets</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded border">
            <div className="text-2xl font-bold text-blue-600">{statusCounts.open}</div>
            <div className="text-xs text-black mt-1">Open Now</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded border">
            <div className="text-2xl font-bold text-amber-600">{statusCounts.locked}</div>
            <div className="text-xs text-black mt-1">Trading Closed</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded border">
            <div className="text-2xl font-bold text-purple-600">{statusCounts.resolved}</div>
            <div className="text-xs text-black mt-1">Resolved</div>
          </div>
        </div>
      </div>

      {/* Status Filter Buttons - Mobile Optimized */}
      <div className="flex flex-wrap gap-2">
        <button 
          className={`btn95 flex items-center gap-2 flex-1 min-w-[140px] ${statusFilter === 'open' ? '!bg-[#000080] !text-white' : ''}`}
          onClick={() => setStatusFilter('open')}
        >
          <span className="text-sm">🎯</span>
          <span className="text-xs md:text-sm">Active ({statusCounts.open})</span>
        </button>
        <button 
          className={`btn95 flex items-center gap-2 flex-1 min-w-[140px] ${statusFilter === 'locked' ? '!bg-[#000080] !text-white' : ''}`}
          onClick={() => setStatusFilter('locked')}
        >
          <span className="text-sm">🔒</span>
          <span className="text-xs md:text-sm">Locked ({statusCounts.locked})</span>
        </button>
        <button 
          className={`btn95 flex items-center gap-2 flex-1 min-w-[140px] ${statusFilter === 'resolved' ? '!bg-[#000080] !text-white' : ''}`}
          onClick={() => setStatusFilter('resolved')}
        >
          <span className="text-sm">✅</span>
          <span className="text-xs md:text-sm">Resolved ({statusCounts.resolved})</span>
        </button>
        <button 
          className={`btn95 flex items-center gap-2 flex-1 min-w-[140px] ${onlyWatchlist ? '!bg-[#000080] !text-white' : ''}`}
          onClick={() => setOnlyWatchlist(!onlyWatchlist)}
        >
          <span className="text-sm">⭐</span>
          <span className="text-xs md:text-sm">{onlyWatchlist ? 'All' : 'Watchlist'}</span>
          {mounted && Object.keys(watch).length > 0 && (
            <span className="ml-1 text-[10px] px-1 rounded bg-yellow-200 text-yellow-800">
              {Object.keys(watch).length}
            </span>
          )}
        </button>
        <button 
          className="btn95 flex items-center gap-2 flex-1 min-w-[140px]"
          onClick={refresh}
          disabled={loading}
        >
          <span className="text-sm">🔄</span>
          <span className="text-xs md:text-sm">{loading ? 'Refreshing...' : 'Refresh'}</span>
        </button>
        <button 
          className="btn95-ghost flex items-center gap-2 fixed bottom-4 right-4 z-40 shadow-lg"
          onClick={() => setShowShortcuts(true)}
          title="Keyboard Shortcuts (?)"
        >
          <span className="text-sm">⌨️</span>
          <span className="hidden sm:inline text-xs">Help</span>
        </button>
      </div>

      <div className="frame">
        <div className="titlebar">
          <div className="title text-sm md:text-base">SILLYMARKET — EXPLORER</div>
          <div className="controls">
            <div className="flex items-center gap-2 text-xs text-black">
              <div className={`w-2 h-2 rounded-full ${
                lastRefreshedAt && (Date.now() - lastRefreshedAt < 30000) ? 'bg-green-500' : 'bg-gray-400'
              }`} />
              <span className="hidden sm:inline">
                {lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString() : 'Never'}
              </span>
            </div>
          </div>
        </div>

        <div className="frame-body space-y-4">
          <div className="flex items-center gap-2" title="Bet mint and decimals">
            <MintBadge mint={MINT} symbol={MINT_SYMBOL} decimals={DECIMALS} />
          </div>

          {/* Enhanced Search with Suggestions */}
          <div className="relative">
            <div className="toolbar95 flex-col md:flex-row md:flex-wrap items-center gap-3 p-3 bg-gray-50 rounded">
              {/* Search with Suggestions */}
              <div className="w-full md:w-auto md:flex-1 relative">
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowSearchSuggestions(true);
                  }}
                  onFocus={() => setShowSearchSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 200)}
                  placeholder="🔍 Search markets or addresses... (/ to focus)"
                  className="input95 w-full pr-10"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    ✕
                  </button>
                )}
              </div>
              
              {/* Simple Checkboxes - Mobile Optimized */}
              <div className="flex items-center gap-3 md:gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-[12px] text-black" title="Show recently viewed markets">
                  <input type="checkbox" checked={onlyRecent} onChange={(e)=>setOnlyRecent(e.target.checked)} />
                  <span className="hidden sm:inline">Recent Markets</span>
                  <span className="sm:hidden">Recent</span>
                  {mounted && recent.length > 0 && (
                    <span className="ml-1 text-[10px] px-1 rounded bg-neutral-200">{recent.length}</span>
                  )}
                </label>

                <label className="flex items-center gap-2 text-[12px] text-black" title="Hide pools with 0 liquidity">
                  <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
                  <span className="hidden sm:inline">Hide Empty</span>
                  <span className="sm:hidden">No Empty</span>
                </label>
              </div>
              
              {/* Sort - Mobile Optimized */}
              <div className="flex items-center gap-2 w-full md:w-auto">
                <span className="text-xs text-black font-medium hidden sm:inline">Sort:</span>
                <span className="text-xs text-black font-medium sm:hidden">Order:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="input95 text-sm"
                  title="Sort order"
                >
                  <option value="cutoffDesc">Closing Time ↓</option>
                  <option value="poolDesc">Largest Pool ↓</option>
                </select>
              </div>
            </div>

            {/* Search Suggestions Dropdown */}
            {showSearchSuggestions && (
              <SearchSuggestions
                search={search}
                rows={rows}
                onSelect={(title) => {
                  setSearch(title);
                  setShowSearchSuggestions(false);
                  searchRef.current?.blur();
                }}
              />
            )}
          </div>

          {/* Owner-only sweepable controls */}
          {wallet.publicKey?.equals(OWNER) && (
            <div className="toolbar95 justify-between bg-amber-50 p-3 rounded">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-[12px] text-black" title="f toggles this">
                  <input
                    type="checkbox"
                    checked={onlySweepable}
                    onChange={(e) => setOnlySweepable(e.target.checked)}
                  />
                  <span className="hidden sm:inline">Only sweepable</span>
                  <span className="sm:hidden">Sweepable</span>
                </label>
                <span className="text-[12px] text-black opacity-70" title="Vault > pool → fees available">
                  {Object.values(sweepableMap).filter(Boolean).length} sweepable detected
                </span>
              </div>
              {onlySweepable && !!filtered.length && (
                <button
                  className="btn95 text-sm"
                  disabled={busySweepAll}
                  onClick={onSweepAll}
                  title="Sweep fees for all listed markets (single transaction)"
                >
                  {busySweepAll ? 'Sweeping…' : 'Sweep All'}
                </button>
              )}
            </div>
          )}

          {/* Biggest Movers strip */}
          {!!movers.length && (
            <div className="frame">
              <div className="titlebar"><div className="title">📈 Biggest Movers (since last fetch)</div></div>
              <div className="frame-body grid grid-cols-1 md:grid-cols-3 gap-2">
                {movers.map(({ m, d }) => {
                  const addrStr = m.addr.toBase58();
                  return (
                    <Link
                      key={addrStr}
                      href={`/market/${addrStr}`}
                      className="sunken95 p-3 bg-white hover:shadow-md transition-shadow cursor-pointer group"
                      title="Open market"
                      onClick={() => pushRecent(addrStr, m.title)}
                    >
                      <div className="truncate font-medium mb-2 text-sm">{m.title}</div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`flex items-center gap-1 ${d.dYes>0?'text-emerald-700':d.dYes<0?'text-rose-700':'text-gray-600'}`}>
                          YES {d.dYes>0?'▲':d.dYes<0?'▼':''} {Math.abs(d.dYes).toFixed(1)}%
                        </span>
                        <span className={`flex items-center gap-1 ${d.dNo>0?'text-rose-700':d.dNo<0?'text-emerald-700':'text-gray-600'}`}>
                          NO {d.dNo>0?'▲':d.dNo<0?'▼':''} {Math.abs(d.dNo).toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-2 text-right">
                        <span className="btn95-ghost text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          View →
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quiet updates banner */}
          {pendingUpdates && (
            <div className="sunken95 p-3 bg-amber-100 text-[12px] text-black flex items-center justify-between rounded border border-amber-300">
              <span className="flex-1">🔄 {pendingUpdates.changed} markets updated · click to apply</span>
              <div className="flex gap-2">
                <button className="btn95 bg-amber-500 text-white text-xs" onClick={applyPending}>Refresh Now</button>
                <button className="btn95-ghost text-xs" onClick={()=>setPendingUpdates(null)}>Dismiss</button>
              </div>
            </div>
          )}

          {err && (
            <div className="sunken95 p-3 text-[13px] text-black bg-white border border-rose-200 bg-rose-50">
              <div className="font-bold text-rose-700 mb-1">Error Loading Markets</div>
              {err}
            </div>
          )}

          {/* Markets grid with enhanced loading states */}
          <ConnectGate bannerText="Connect wallet to view markets and place bets.">
            {loading ? (
              // Enhanced skeleton loading grid
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 market-grid">
                {[...Array(6)].map((_, i) => (
                  <MarketSkeleton key={i} />
                ))}
              </div>
            ) : (!filtered.length) ? (
              // Enhanced empty state
              <div className="text-center py-12 bg-gray-50 rounded border">
                <div className="text-6xl mb-4">🔍</div>
                <h3 className="text-lg font-bold mb-2 text-black">No markets found</h3>
                <p className="text-gray-600 mb-6 max-w-md mx-auto text-sm">
                  {wallet.publicKey?.equals(OWNER) && onlySweepable
                    ? 'No sweepable markets right now. Fees accrue when volume settles post-resolution.'
                    : 'Try adjusting your filters or search terms to find more markets.'}
                </p>
                <button className="btn95" onClick={resetFilters}>
                  Reset All Filters
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 market-grid">
                  {visible.map((m) => {
                    const status =
                      m.resolved ? 'resolved' : m.cutoff ? (Math.floor(Date.now()/1000) < m.cutoff ? 'open' : 'locked') : 'locked';
                    const winner = m.winner === 'yes' ? 'YES' : m.winner === 'no' ? 'NO' : undefined;
                    const isBusy = busySweepId === m.addr.toBase58();
                    const canSweep = !!sweepableMap[m.addr.toBase58()];
                    const addrStr = m.addr.toBase58();
                    const isWatched = !!watch[addrStr];
                    const dk = deltas[addrStr] || { dYes: 0, dNo: 0 };
                    const yes = Number(m.yesAtoms ?? 0n);
                    const no = Number(m.noAtoms ?? 0n);
                    const total = yes + no;
                    const yesPct = total > 0 ? (yes / total * 100) : 0;
                    const noPct = total > 0 ? (no / total * 100) : 0;
                    const pool = trimUi6(atomsToUi6(BigInt(total)));
                    const winPool = m.winner === 'yes' ? yes : m.winner === 'no' ? no : 0;
                    const multiple = m.resolved && winPool > 0 ? (total / winPool) : null;

                    // Progress calculations
                    const now = Math.floor(Date.now()/1000);
                    const remaining = m.cutoff ? m.cutoff - now : undefined;
                    const progress = m.cutoff ? Math.max(5, (1 - (remaining || 0) / 86400) * 100) : 0;

                    return (
                      <div
                        key={addrStr}
                        className="frame hover:shadow-lg transition-shadow cursor-pointer group relative border-2 border-transparent hover:border-blue-200"
                        ref={(el) => (cardRefs.current[addrStr] = el)}
                      >
                        {/* Quick Bet Button on Hover */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-3 right-3 z-10">
                          <Link 
                            href={`/market/${addrStr}`}
                            className="btn95 bg-blue-500 text-white text-xs px-2 py-1 shadow-lg"
                            onClick={() => pushRecent(addrStr, m.title)}
                          >
                            Bet Now
                          </Link>
                        </div>

                        <div className="titlebar flex justify-between items-center pr-12">
                          <div className="title truncate flex-1 text-sm md:text-base" title={m.title}>
                            {m.title}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className={`btn95-ghost px-2 ${isWatched ? 'font-bold text-yellow-500' : ''}`}
                              onClick={(e) => { e.stopPropagation(); toggleWatch(addrStr); }}
                              title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                            >
                              {isWatched ? '★' : '☆'}
                            </button>
                            <StatusIndicator 
                              status={status} 
                              winner={m.winner}
                              size="sm"
                            />
                          </div>
                        </div>

                        {/* Progress bar for time remaining */}
                        {typeof remaining === 'number' && remaining > 0 && (
                          <div className="px-3 pt-2">
                            <div className="flex justify-between text-xs text-black mb-1">
                              <span>Time remaining</span>
                              <span className={remaining <= 3600 ? 'text-rose-600 font-semibold' : ''}>
                                {formatDur(remaining)}
                              </span>
                            </div>
                            <div className="h-2 bg-gray-300 rounded-full overflow-hidden">
                              <div 
                                className={`h-2 rounded-full transition-all duration-1000 ${
                                  remaining <= 3600 ? 'bg-rose-500' : 
                                  remaining <= 7200 ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="frame-body p-3 space-y-3">
                          {/* Enhanced Odds Visualization */}
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className={`font-medium ${flashYes[addrStr] ? 'text-emerald-600 scale-105 transition-transform' : 'text-emerald-700'}`}>
                                YES {yesPct.toFixed(1)}%
                                {dk.dYes !== 0 && (
                                  <span className={`ml-1 text-xs ${dk.dYes > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {dk.dYes > 0 ? '↗' : '↘'}
                                  </span>
                                )}
                              </span>
                              <span className={`font-medium ${flashNo[addrStr] ? 'text-rose-600 scale-105 transition-transform' : 'text-rose-700'}`}>
                                NO {noPct.toFixed(1)}%
                                {dk.dNo !== 0 && (
                                  <span className={`ml-1 text-xs ${dk.dNo > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {dk.dNo > 0 ? '↗' : '↘'}
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-3 bg-emerald-500 float-left transition-all duration-500" 
                                style={{ width: `${yesPct}%` }}
                              />
                              <div 
                                className="h-3 bg-rose-500 float-right transition-all duration-500" 
                                style={{ width: `${noPct}%` }}
                              />
                            </div>
                          </div>

                          {/* Quick Stats */}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="text-center p-2 bg-gray-100 rounded border">
                              <div className="font-bold text-black">{pool}</div>
                              <div className="text-gray-600">Total Pool</div>
                            </div>
                            <div className="text-center p-2 bg-gray-100 rounded border">
                              <div className="font-bold text-black">{m.resolved ? 'Final' : 'Live'}</div>
                              <div className="text-gray-600">Status</div>
                            </div>
                          </div>

                          {/* Address + Actions */}
                          <div className="sunken95 p-2 bg-white text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <Link
                                href={`/market/${addrStr}`}
                                className="truncate font-mono text-black hover:text-blue-600"
                                title="Open market"
                                onClick={() => pushRecent(addrStr, m.title)}
                              >
                                {addrStr.slice(0, 6)}...{addrStr.slice(-6)}
                              </Link>
                              <div className="flex items-center gap-1">
                                <button
                                  className="btn95-ghost px-1 text-[10px]"
                                  onClick={(e) => { e.stopPropagation(); handleShare(addrStr, m); }}
                                  title="Share this market"
                                >
                                  Share
                                </button>
                                <button
                                  className="btn95-ghost px-1 text-[10px]"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await navigator.clipboard.writeText(addrStr);
                                    push({ variant: 'success', message: 'Copied market address' });
                                  }}
                                  title="Copy market address"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Resolved banner with multiple */}
                          {m.resolved && winner && (
                            <div className={`sunken95 p-2 text-[12px] text-black text-center font-medium ${
                              winner === 'YES' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
                            }`} title="Resolution result">
                              <span className={winner === 'YES' ? 'text-emerald-700' : 'text-rose-700'}>
                                🎉 {winner} WON
                              </span>
                              {multiple && multiple > 1 && (
                                <span className="block text-xs text-gray-600 mt-1">{multiple.toFixed(2)}× return for winners</span>
                              )}
                            </div>
                          )}

                          {/* Owner-only sweep */}
                          {wallet.publicKey?.equals(OWNER) && sweepIx && canSweep && (
                            <div className="flex items-center justify-end">
                              <button
                                onClick={(e) => { e.stopPropagation(); onSweepOne(m.addr); }}
                                disabled={!!busySweepId}
                                className="btn95 bg-green-600 text-white text-xs"
                                title="Vault > pool → fees available"
                              >
                                {isBusy ? 'Sweeping…' : '💰 Sweep Fees'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Infinite scroll sentinel */}
                <div ref={loadMoreRef} className="h-10" />

                {/* Bottom loading/status bar */}
                <div className="sunken95 p-3 bg-white text-[12px] text-black flex items-center justify-center rounded">
                  {visibleCount < filtered.length ? '⬇️ Scroll to load more markets...' : '🎯 End of list - no more markets'}
                </div>
              </>
            )}
          </ConnectGate>

          {/* Enhanced Status bar - Mobile Optimized */}
          <div className="sunken95 p-3 bg-white text-[12px] text-black flex flex-col md:flex-row items-center justify-between gap-2 rounded">
            <div className="flex items-center gap-4 flex-wrap justify-center md:justify-start">
              <span className="text-center md:text-left">
                Cluster: <b>{cluster}</b> · Slot: {slot ?? '—'}
              </span>
              <span className="text-center md:text-left">
                Showing <b>{visible.length}</b> / {filtered.length}
                {onlySweepable ? ' (sweepable)' : ''}
                {onlyWatchlist ? ' (watchlist)' : ''}
                {onlyRecent ? ' (recent)' : ''}
              </span>
            </div>
            <div className="flex items-center gap-4 flex-wrap justify-center md:justify-end">
              <span className="text-center md:text-left">
                Last: {lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString() : '—'}
              </span>
              <span className="hidden md:block">
                · shortcuts: <kbd className="chip95 px-1">/</kbd> <kbd className="chip95 px-1">r</kbd> <kbd className="chip95 px-1">o</kbd> <kbd className="chip95 px-1">l</kbd> <kbd className="chip95 px-1">v</kbd> {isOwner && <kbd className="chip95 px-1">f</kbd>} <kbd className="chip95 px-1">?</kbd>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Share Modal */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        shareTitle={shareTitle}
        shareUrl={shareUrl}
        shareImg={shareImg}
        onCopyLink={async () => {
          if (shareUrl) {
            await navigator.clipboard.writeText(shareUrl);
            push({ variant: 'success', message: 'Link copied to clipboard!' });
          }
        }}
      />

      {!wallet.connected && (
        <div className="text-center p-4 bg-blue-50 rounded border border-blue-200">
          <div className="text-sm text-blue-700">
            💡 <strong>Tip:</strong> Connect your wallet to place bets on any market
          </div>
        </div>
      )}
    </div>
  );
}

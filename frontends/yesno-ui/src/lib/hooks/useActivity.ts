// src/lib/hooks/useActivity.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';

export type ActivityRow =
  | { type: 'place'; sig: string; ts: number | null; wallet: string; side: 'YES' | 'NO' | '?'; amount?: string }
  | { type: 'resolve'; sig: string; ts: number | null; wallet: string; outcome: 'YES' | 'NO' | '?' }
  | { type: 'claim'; sig: string; ts: number | null; wallet: string; amount?: string };

type Params = {
  connection: Connection;
  marketPk: PublicKey;
  programId: PublicKey;
  mint: PublicKey;
  isOpen: boolean;
  limit?: number; // default 6
  minRefreshIntervalMs?: number; // don't refetch more often than this (default 120s)
  backoffMsOn429?: number; // default 120s
  enableLogsBadge?: boolean; // default true
};

// --------- tiny helpers ----------
const LS_KEY_PREFIX = 'ynb-act-v2:';
const is429 = (e: any) => {
  const m = String(e?.message || e || '');
  return /429|Too many requests|rate[- ]?limit/i.test(m);
};
const safeNow = () => Date.now();

type CacheShape = {
  ts: number;           // when cached
  sigs: string[];       // window sigs in order (latest first)
  rows: ActivityRow[];  // fully parsed rows for those sigs (subset allowed)
};

function readCache(market: string): CacheShape | null {
  try {
    const raw = sessionStorage.getItem(LS_KEY_PREFIX + market);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // very light sanity
    if (!obj || !Array.isArray(obj.sigs) || !Array.isArray(obj.rows)) return null;
    return obj as CacheShape;
  } catch {
    return null;
  }
}
function writeCache(market: string, data: CacheShape) {
  try {
    sessionStorage.setItem(LS_KEY_PREFIX + market, JSON.stringify(data));
  } catch {}
}

// Extract 'memo' from parsed tx (works for both parsed message + logs fallback)
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

function computeMintDeltas(tx: any, mintStr: string) {
  const pre = (tx?.meta?.preTokenBalances ?? []) as any[];
  const post = (tx?.meta?.postTokenBalances ?? []) as any[];
  const preMap = new Map<string, number>();
  const postMap = new Map<string, number>();
  for (const b of pre) {
    if (b?.mint !== mintStr || !b?.owner) continue;
    const a = Number(b?.uiTokenAmount?.uiAmount ?? Number(b?.uiTokenAmount?.amount ?? 0) / 1e6);
    preMap.set(b.owner, (preMap.get(b.owner) ?? 0) + a);
  }
  for (const b of post) {
    if (b?.mint !== mintStr || !b?.owner) continue;
    const a = Number(b?.uiTokenAmount?.uiAmount ?? Number(b?.uiTokenAmount?.amount ?? 0) / 1e6);
    postMap.set(b.owner, (postMap.get(b.owner) ?? 0) + a);
  }
  const deltas: Array<{ owner: string; delta: number }> = [];
  const owners = new Set<string>([...preMap.keys(), ...postMap.keys()]);
  for (const o of owners) {
    const d = (postMap.get(o) ?? 0) - (preMap.get(o) ?? 0);
    if (Math.abs(d) > 1e-9) deltas.push({ owner: o, delta: d });
  }
  return deltas;
}

// --------- hook ----------
export function useActivity({
  connection,
  marketPk,
  programId,
  mint,
  isOpen,
  limit = 6,
  minRefreshIntervalMs = 120_000,
  backoffMsOn429 = 120_000,
  enableLogsBadge = true,
}: Params) {
  const marketStr = useMemo(() => marketPk.toBase58(), [marketPk]);
  const mintStr = useMemo(() => mint.toBase58(), [mint]);

  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [hasNewFromLogs, setHasNewFromLogs] = useState(false);

  const lastRefetchAtRef = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);
  const logsSubRef = useRef<number | null>(null);
  const logsBadgeCooldownRef = useRef(0);

  // Initialize from cache immediately (no RPC)
  useEffect(() => {
    const c = readCache(marketStr);
    if (c?.rows?.length) {
      setActivity(c.rows);
      setLoadedOnce(true);
    }
  }, [marketStr]);

  const parseOneTxToRow = useCallback(
    (sig: string, parsed: any): ActivityRow | null => {
      const memoText = parseMemoFromParsedTx(parsed) || '';
      const keys = parsed?.transaction?.message?.accountKeys ?? [];
      const firstSigner = keys.find((k: any) => k?.signer)?.pubkey ?? keys[0]?.pubkey ?? '';
      const walletPk = typeof firstSigner === 'string' ? firstSigner : String(firstSigner || '');
      const ts = parsed?.blockTime ?? null;

      const mPlace = memoText.match(/^Place\s+(YES|NO)\s+([0-9.]+)/i);
      if (mPlace) {
        return {
          type: 'place',
          sig,
          ts,
          wallet: walletPk,
          side: mPlace[1].toUpperCase() === 'YES' ? 'YES' : 'NO',
          amount: mPlace[2],
        };
      }
      const mResolve = memoText.match(/^Resolve\s+(YES|NO)/i);
      if (mResolve) {
        return {
          type: 'resolve',
          sig,
          ts,
          wallet: walletPk,
          outcome: mResolve[1].toUpperCase() === 'YES' ? 'YES' : 'NO',
        };
      }
      if (/^Claim\b/i.test(memoText)) {
        const deltas = computeMintDeltas(parsed, mintStr);
        const gain = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)[0];
        const amountUi =
          gain && isFinite(gain.delta) ? (Math.round(gain.delta * 1e6) / 1e6).toString() : undefined;
        const ownerShown = gain?.owner || walletPk;
        return { type: 'claim', sig, ts, wallet: ownerShown, amount: amountUi };
      }
      return null;
    },
    [mintStr]
  );

  const refresh = useCallback(async () => {
    // hard gates
    if (!isOpen) return;
    if (safeNow() < blockedUntil) return;

    // de-dupe & throttle
    const since = safeNow() - lastRefetchAtRef.current;
    if (loadedOnce && since < minRefreshIntervalMs) return;

    if (inflightRef.current) {
      // don't pile on; let current run finish
      return inflightRef.current;
    }

    const run = (async () => {
      setLoading(true);
      try {
        // 1) signatures window (cheap)
        const sigInfos = await connection.getSignaturesForAddress(marketPk, { limit }, 'confirmed');
        const latest = sigInfos.map((s) => s.signature);

        // 2) merge with cache to find missing parsed rows
        const cache = readCache(marketStr) || { ts: 0, sigs: [], rows: [] };
        const need = latest.filter((s) => !cache.rows.find((r) => r.sig === s));

        // 3) only fetch parsed txs for new sigs (single batch call)
        let newRows: ActivityRow[] = [];
        if (need.length) {
          const parsedArr = await connection.getParsedTransactions(need, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          for (let i = 0; i < need.length; i++) {
            const sig = need[i];
            const parsed = parsedArr?.[i];
            if (!parsed) continue;
            const row = parseOneTxToRow(sig, parsed);
            if (row) newRows.push(row);
          }
        }

        // 4) merge cache rows with new rows and reorder by latest
        const mergedMap = new Map<string, ActivityRow>();
        for (const r of cache.rows) mergedMap.set(r.sig, r);
        for (const r of newRows) mergedMap.set(r.sig, r);
        const finalRows = latest.map((s) => mergedMap.get(s)).filter(Boolean) as ActivityRow[];
        finalRows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

        writeCache(marketStr, { ts: safeNow(), sigs: latest, rows: finalRows });

        setActivity(finalRows);
        setLoadedOnce(true);
        setHasNewFromLogs(false); // we just synced
        lastRefetchAtRef.current = safeNow();
      } catch (e: any) {
        if (is429(e)) {
          setBlockedUntil(safeNow() + backoffMsOn429);
        }
        // keep whatever is already on screen; try to surface cache if empty
        if (!activity.length) {
          const cache = readCache(marketStr);
          if (cache?.rows?.length) setActivity(cache.rows);
        }
      } finally {
        setLoading(false);
        inflightRef.current = null;
      }
    })();

    inflightRef.current = run;
    return run;
  }, [
    activity.length,
    backoffMsOn429,
    connection,
    isOpen,
    limit,
    marketPk,
    marketStr,
    minRefreshIntervalMs,
    blockedUntil,
    loadedOnce,
    parseOneTxToRow,
  ]);

  // Logs badge (no fetch). Only when panel is open.
  useEffect(() => {
    if (!enableLogsBadge || !isOpen) {
      if (logsSubRef.current !== null) {
        try { connection.removeOnLogsListener(logsSubRef.current); } catch {}
        logsSubRef.current = null;
      }
      return;
    }
    let disposed = false;

    (async () => {
      try {
        // Subscribe to program logs; on any log, gently show "new activity" badge with a small cooldown.
        const subId = connection.onLogs(programId, (_log) => {
          // prevent badge from spamming every second
          const now = safeNow();
          if (now < logsBadgeCooldownRef.current) return;
          logsBadgeCooldownRef.current = now + 15_000; // 15s cooldown for the badge
          setHasNewFromLogs(true);
        }, 'confirmed');
        if (!disposed) logsSubRef.current = subId;
      } catch {
        // ignore
      }
    })();

    return () => {
      disposed = true;
      if (logsSubRef.current !== null) {
        try { connection.removeOnLogsListener(logsSubRef.current); } catch {}
        logsSubRef.current = null;
      }
    };
  }, [connection, enableLogsBadge, isOpen, programId]);

  // When panel opens, do a single fetch if we have nothing for this session
  useEffect(() => {
    if (!isOpen) return;
    const cache = readCache(marketStr);
    if (!cache || !cache.rows?.length) {
      // no cache -> do one on-demand fetch
      void refresh();
    }
  }, [isOpen, marketStr, refresh]);

  // On unmount: clean logs sub (defense in depth)
  useEffect(() => {
    return () => {
      if (logsSubRef.current !== null) {
        try { connection.removeOnLogsListener(logsSubRef.current); } catch {}
        logsSubRef.current = null;
      }
    };
  }, [connection]);

  // On-demand: fetch amount for a single claim row (cheap fallback if it was missing)
  const fetchAmountForSig = useCallback(
    async (sig: string) => {
      if (safeNow() < blockedUntil) return;

      try {
        const tx = await connection.getParsedTransactions([sig], {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        const parsed = tx?.[0];
        if (!parsed) return;

        const deltas = computeMintDeltas(parsed, mintStr);
        const gain = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)[0];
        const amountUi =
          gain && isFinite(gain.delta) ? (Math.round(gain.delta * 1e6) / 1e6).toString() : undefined;

        // Update in memory + cache
        const next = activity.map((r) => (r.sig === sig && r.type === 'claim' && !r.amount
          ? { ...r, amount: amountUi }
          : r
        ));
        setActivity(next);

        const cache = readCache(marketStr);
        if (cache) {
          const nextRows = cache.rows.map((r) =>
            r.sig === sig && r.type === 'claim' && !('amount' in r ? r.amount : undefined)
              ? ({ ...r, amount: amountUi } as ActivityRow)
              : r
          );
          writeCache(marketStr, { ...cache, rows: nextRows });
        }
      } catch (e: any) {
        if (is429(e)) setBlockedUntil(safeNow() + backoffMsOn429);
        // ignore otherwise
      }
    },
    [activity, backoffMsOn429, blockedUntil, connection, marketStr, mintStr]
  );

  return {
    activity,
    loading,
    loadedOnce,
    blockedUntil,
    hasNewFromLogs,
    refresh,
    fetchAmountForSig,
  };
}


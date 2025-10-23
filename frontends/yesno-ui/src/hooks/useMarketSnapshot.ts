// src/hooks/useMarketSnapshot.ts
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Connection,
  PublicKey,
} from '@solana/web3.js';
import { Idl, BorshCoder } from '@coral-xyz/anchor';

type Strict = {
  yesAtoms?: bigint;
  noAtoms?: bigint;
  cutoff?: number;
  resolved?: boolean;
  winner?: 'yes' | 'no' | null;
  mint?: string;
  decoded?: any;
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
function extractKnownFields(decoded: any): Strict {
  const out: Strict = {};
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
      if (n === 0) out.winner = 'no';
      else if (n === 1) out.winner = 'yes';
      else if (n === 2) out.winner = 'no';
      else if (n === 3) out.winner = 'yes';
    }
  }

  if (
    (out.winner === null || out.winner === undefined) &&
    out.resolved === true &&
    out.yesAtoms !== undefined &&
    out.noAtoms !== undefined
  ) {
    if (out.yesAtoms > out.noAtoms) out.winner = 'yes';
    else if (out.noAtoms > out.yesAtoms) out.winner = 'no';
  }

  const mint = get(/^mint$/);
  if (mint) out.mint = String(mint);
  out.decoded = decoded;
  return out;
}

function decodeFirstMatchFromIDL(coder: BorshCoder, idl: Idl, data: Uint8Array, preferMarket = true) {
  const names = (idl.accounts ?? []).map(a => a.name);
  const ordered = preferMarket
    ? [...names.filter(n => /market/i.test(n)), ...names.filter(n => !/market/i.test(n))]
    : names;
  for (const name of ordered) {
    try {
      const d = coder.accounts.decode(name, data);
      if (d) return { name, decoded: d };
    } catch {}
  }
  return null;
}

export type MarketSnapshot = {
  // raw-ish fields
  strict: Strict | null;
  // derived
  status: 'Open' | 'Locked' | 'Resolved' | 'Unknown';
  yesPct: number;
  noPct: number;
  poolAtoms?: bigint;
  // user position
  userPos: { exists: boolean; side: 'yes' | 'no' | null; stake?: bigint };
  // helpers
  refresh: () => Promise<void>;
};

export function useMarketSnapshot(opts: {
  connection: Connection;
  marketPk: PublicKey;
  walletPk: PublicKey | null;
  idl: Idl | null;
  coder: BorshCoder | null;
}) : MarketSnapshot {
  const { connection, marketPk, walletPk, idl, coder } = opts;

  const [strict, setStrict] = useState<Strict | null>(null);
  const [userPos, setUserPos] = useState<{ exists: boolean; side: 'yes' | 'no' | null; stake?: bigint }>({
    exists: false, side: null, stake: 0n,
  });

  // one-shot + minimal subscriptions
  const refresh = useCallback(async () => {
    if (!idl || !coder) return;

    // --- single batch round-trip ---
    // 1) market account
    const info = await connection.getAccountInfo(marketPk, 'processed');
    // 2) candidate position PDAs (we batch these in one call)
    const cands: PublicKey[] = walletPk ? [
      PublicKey.findProgramAddressSync([Buffer.from('position'), marketPk.toBuffer(), walletPk.toBuffer()], idl.metadata?.address ? new PublicKey(idl.metadata.address) : marketPk)[0], // just to keep same seed shape; programID not needed to "guess"
      PublicKey.findProgramAddressSync([Buffer.from('pos'), marketPk.toBuffer(), walletPk.toBuffer()], idl.metadata?.address ? new PublicKey(idl.metadata.address) : marketPk)[0],
      PublicKey.findProgramAddressSync([Buffer.from('position'), walletPk.toBuffer(), marketPk.toBuffer()], idl.metadata?.address ? new PublicKey(idl.metadata.address) : marketPk)[0],
      PublicKey.findProgramAddressSync([Buffer.from('pos'), walletPk.toBuffer(), marketPk.toBuffer()], idl.metadata?.address ? new PublicKey(idl.metadata.address) : marketPk)[0],
    ] : [];
    const posInfos = cands.length ? await connection.getMultipleAccountsInfo(cands, { commitment: 'processed' as any }) : [];

    // --- decode in-memory, no more RPC ---
    if (info?.data) {
      const m = decodeFirstMatchFromIDL(coder, idl, info.data, true /*preferMarket*/);
      if (m?.decoded) setStrict(extractKnownFields(m.decoded));
    }

    if (walletPk && posInfos?.length) {
      const idx = posInfos.findIndex(i => i?.data);
      if (idx >= 0) {
        // try decode side/stake from any account type with "position" name
        const names = (idl.accounts ?? []).map(a => a.name).filter(n => /position/i.test(n));
        let decoded: any | null = null;
        for (const nm of names) {
          try {
            decoded = coder.accounts.decode(nm, posInfos[idx]!.data);
            if (decoded) break;
          } catch {}
        }
        // derive side/stake
        let side: 'yes' | 'no' | null = null;
        let stake: bigint = 0n;
        if (decoded) {
          for (const k of Object.keys(decoded)) {
            const lk = k.toLowerCase();
            const v = decoded[k];
            if (lk === 'side' || /choice|direction|vote/.test(lk)) {
              if (typeof v === 'string') {
                const s = v.toLowerCase();
                side = s.includes('yes') ? 'yes' : s.includes('no') ? 'no' : null;
              } else if (typeof v === 'number') {
                side = v === 1 ? 'yes' : v === 0 ? 'no' : null;
              } else if (v && typeof v === 'object' && '__kind' in v) {
                const s = String(v.__kind).toLowerCase();
                side = s.includes('yes') ? 'yes' : s.includes('no') ? 'no' : null;
              }
            }
            if (/amount|stake|wager|atoms/.test(lk)) {
              const b = bnLikeToBigint(decoded[k]);
              if (b !== undefined) stake = b;
            }
          }
        }
        setUserPos({ exists: true, side, stake });
      } else {
        setUserPos({ exists: false, side: null, stake: 0n });
      }
    } else {
      setUserPos({ exists: false, side: null, stake: 0n });
    }
  }, [connection, marketPk, walletPk, idl, coder]);

  // initial load
  useEffect(() => { refresh(); }, [refresh]);

  // light subscriptions: market account only (position is optional)
  useEffect(() => {
    if (!idl || !coder) return;
    const sub = connection.onAccountChange(marketPk, async (acc) => {
      try {
        const m = decodeFirstMatchFromIDL(coder, idl, acc.data, true);
        if (m?.decoded) setStrict(extractKnownFields(m.decoded));
      } catch {}
    }, 'processed');
    return () => { try { connection.removeAccountChangeListener(sub); } catch {} };
  }, [connection, marketPk, idl, coder]);

  // derived values
  const { status, yesPct, noPct, poolAtoms } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let status: 'Open' | 'Locked' | 'Resolved' | 'Unknown' = 'Unknown';
    if (strict?.resolved) status = 'Resolved';
    else if (strict?.cutoff !== undefined) status = now < (strict.cutoff ?? 0) ? 'Open' : 'Locked';

    const y = Number(strict?.yesAtoms ?? 0n);
    const n = Number(strict?.noAtoms ?? 0n);
    const t = y + n;
    const yesPct = t > 0 ? (y / t) * 100 : 0;
    const noPct = t > 0 ? (n / t) * 100 : 0;

    const poolAtoms = (strict?.yesAtoms ?? 0n) + (strict?.noAtoms ?? 0n);

    return { status, yesPct, noPct, poolAtoms };
  }, [strict]);

  return {
    strict,
    status,
    yesPct,
    noPct,
    poolAtoms,
    userPos,
    refresh,
  };
}

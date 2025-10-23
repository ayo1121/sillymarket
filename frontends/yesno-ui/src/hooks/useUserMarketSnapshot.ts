'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PublicKey, AccountInfo, Commitment } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { BorshCoder, Idl } from '@coral-xyz/anchor';

import { loadYesNoIDL, getCoderOrNull } from '@/lib/idl';

/* ----------------------------- small utils ------------------------------ */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Safe converter: returns null if x is falsy/invalid instead of throwing
function toPublicKey(x?: PublicKey | string | null): PublicKey | null {
  if (!x) return null;
  if (x instanceof PublicKey) return x;
  try {
    return new PublicKey(x);
  } catch {
    return null;
  }
}

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function getAccountInfoRetry(
  connection: any,
  pk: PublicKey,
  commitment: Commitment = 'processed',
  tries = 4
): Promise<AccountInfo<Buffer> | null> {
  for (let i = 0; i < tries; i++) {
    try {
      return await connection.getAccountInfo(pk, commitment);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(250 * (i + 1));
    }
  }
  return null;
}

/* ----------------------------- types ------------------------------ */

export type UserMarketSnapshot = {
  loading: boolean;
  error: string | null;

  // Market core
  marketPk: PublicKey | null;
  decodedName?: string;
  decoded?: any;
  yesAtoms?: bigint;
  noAtoms?: bigint;
  cutoff?: number;
  resolved?: boolean;
  winner?: 'yes' | 'no' | null;
  mint?: string;

  // User position (if connected)
  userPos?: {
    exists: boolean;
    side: 'yes' | 'no' | null;
    stake: bigint;
  };
};

/* ----------------------------- extractors ------------------------------ */

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

function extractKnownFields(decoded: any) {
  const out: Partial<UserMarketSnapshot> = {};
  if (!decoded) return out;

  const keys = Object.keys(decoded);
  const lower = keys.map((k) => k.toLowerCase());
  const get = (re: RegExp) => {
    const i = lower.findIndex((k) => re.test(k));
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
  } else if (rawWin !== undefined) {
    const bn = bnLikeToBigint(rawWin);
    if (bn !== undefined) {
      const n = Number(bn);
      out.winner = n === 1 || n === 3 ? 'yes' : n === 0 || n === 2 ? 'no' : null;
    } else if (typeof rawWin === 'number') {
      out.winner = rawWin === 1 || rawWin === 3 ? 'yes' : rawWin === 0 || rawWin === 2 ? 'no' : null;
    } else if (rawWin && (rawWin as any).__kind) {
      const k = String((rawWin as any).__kind).toLowerCase();
      out.winner = k.includes('yes') ? 'yes' : k.includes('no') ? 'no' : null;
    }
  }

  const mint = get(/^mint$/);
  if (mint) out.mint = String(mint);

  return out;
}

/* ----------------------------- hook ------------------------------ */

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);

export default function useUserMarketSnapshot(marketKey: string | PublicKey | null | undefined) {
  const { connection } = useConnection();
  const wallet = useWallet();

  const marketPk = useMemo(() => toPublicKey(marketKey), [marketKey]);

  const [idl, setIdl] = useState<Idl | null>(null);
  const [coder, setCoder] = useState<BorshCoder | null>(null);

  const [snap, setSnap] = useState<UserMarketSnapshot>({
    loading: !!marketPk,
    error: null,
    marketPk: marketPk ?? null,
  });

  // load IDL once
  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await loadYesNoIDL().catch(() => null);
      if (!alive) return;
      if (!loaded) {
        setIdl(null);
        setCoder(null);
        return;
      }
      setIdl(loaded);
      setCoder(getCoderOrNull(loaded));
    })();
    return () => {
      alive = false;
    };
  }, []);

  // decode market + subscribe
  useEffect(() => {
    if (!marketPk || !idl || !coder) {
      setSnap((s) => ({ ...s, loading: false, marketPk: marketPk ?? null }));
      return;
    }

    let cancelled = false;

    const decodeOnce = async (commitment: Commitment = 'processed') => {
      try {
        const info = await getAccountInfoRetry(connection, marketPk, commitment);
        if (!info) {
          if (!cancelled) {
            setSnap({
              loading: false,
              error: 'Account not found',
              marketPk,
            });
          }
          return;
        }

        const names = (idl.accounts ?? []).map((a) => a.name);
        const ordered = [
          ...names.filter((n) => /market/i.test(n)),
          ...names.filter((n) => !/market/i.test(n)),
        ];

        let decoded: any | null = null;
        let decodedName: string | undefined;
        for (const name of ordered) {
          try {
            const d = coder!.accounts.decode(name, info.data);
            decoded = d;
            decodedName = name;
            if (/market/i.test(name)) break;
          } catch {}
        }

        const fields = extractKnownFields(decoded);
        if (!cancelled) {
          setSnap({
            loading: false,
            error: null,
            marketPk,
            decodedName,
            decoded,
            yesAtoms: fields.yesAtoms,
            noAtoms: fields.noAtoms,
            cutoff: fields.cutoff,
            resolved: fields.resolved,
            winner: fields.winner as any,
            mint: fields.mint,
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setSnap({
            loading: false,
            error: String(e?.message ?? e),
            marketPk,
          });
        }
      }
    };

    decodeOnce('processed');

    const subId = connection.onAccountChange(marketPk, () => decodeOnce('processed'), 'processed');

    return () => {
      cancelled = true;
      try {
        connection.removeAccountChangeListener(subId);
      } catch {}
    };
  }, [marketPk, idl, coder, connection]);

  // derive user position
  const loadUserPos = useCallback(
    async (bettor: PublicKey) => {
      if (!marketPk || !idl) {
        setSnap((s) => ({ ...s, userPos: undefined }));
        return;
      }
      const cands: PublicKey[] = [
        pda([Buffer.from('position'), marketPk.toBuffer(), bettor.toBuffer()], PROGRAM_ID),
        pda([Buffer.from('pos'), marketPk.toBuffer(), bettor.toBuffer()], PROGRAM_ID),
        pda([Buffer.from('position'), bettor.toBuffer(), marketPk.toBuffer()], PROGRAM_ID),
        pda([Buffer.from('pos'), bettor.toBuffer(), marketPk.toBuffer()], PROGRAM_ID)
      ];

      const infos = await connection.getMultipleAccountsInfo(cands, { commitment: 'processed' });
      const idx = infos.findIndex((i) => i !== null);
      if (idx < 0) {
        setSnap((s) => ({ ...s, userPos: { exists: false, side: null, stake: 0n } }));
        return;
      }

      try {
        const data = infos[idx]!.data;
        const names = (idl.accounts ?? []).map((a) => a.name);
        const posNames = names.filter((n) => /position/i.test(n));
        const coderToUse = coder ?? new BorshCoder(idl);
        let decoded: any | null = null;
        for (const nm of posNames) {
          try {
            decoded = coderToUse.accounts.decode(nm, data);
            if (decoded) break;
          } catch {}
        }

        let side: 'yes' | 'no' | null = null;
        let stake = 0n;

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

        setSnap((s) => ({ ...s, userPos: { exists: true, side, stake } }));
      } catch {
        setSnap((s) => ({ ...s, userPos: { exists: true, side: null, stake: 0n } }));
      }
    },
    [connection, marketPk, idl, coder]
  );

  useEffect(() => {
    if (wallet.publicKey) {
      loadUserPos(wallet.publicKey);
    } else {
      setSnap((s) => ({ ...s, userPos: undefined }));
    }
  }, [wallet.publicKey, loadUserPos]);

  return snap;
}

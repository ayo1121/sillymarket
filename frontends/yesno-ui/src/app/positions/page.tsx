// src/app/positions/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import { useToast } from '@/components/ui/Toast';
import { loadYesNoIDL, getCoderOrNull } from '@/lib/idl';
import { getConnection } from '@/lib/actions/connection';

// centralized constants + UI bits
import { PROGRAM_ID, MINT, DECIMALS, OWNER, MINT_SYMBOL } from '@/lib/constants';
import { MintBadge } from '@/components/ui/MintBadge';
import { ConnectGate } from '@/components/ui/ConnectGate';
import { CopyChip } from '@/components/ui/CopyChip';

/* ───────────────────────────────── Local name cache ───────────────────────────────── */
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

/* ───────────────────────────────── Small UI bits ───────────────────────────────── */
function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M20 12a8 8 0 1 1-2.343-5.657M20 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ───────────────────────────────── Utils ───────────────────────────────── */
type AnyObj = Record<string, any>;

function fmtAtoms(n: bigint, decimals: number) {
  const neg = n < 0n ? '-' : '';
  const x = n < 0n ? -n : n;
  const base = 10n ** BigInt(decimals);
  const w = x / base;
  const f = (x % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return neg + w.toString() + (f ? '.' + f : '');
}
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

/* robust side detection for position accounts */
function getSide(acc: AnyObj): 'yes' | 'no' | null {
  const cands = acc?.side ?? acc?.betSide ?? acc?.choice ?? acc?.outcome ?? acc?.direction;
  if (cands === undefined || cands === null) return null;

  if (typeof cands === 'string') {
    const s = cands.toLowerCase();
    if (s === 'yes') return 'yes';
    if (s === 'no') return 'no';
  }
  try {
    const n = Number((cands as any).toString?.() ?? cands);
    if (n === 1) return 'yes';
    if (n === 0) return 'no';
  } catch {}
  if (typeof cands === 'object') {
    if (cands && (('Yes' in cands) || ('yes' in cands))) return 'yes';
    if (cands && (('No' in cands) || ('no' in cands))) return 'no';
    if (cands && typeof (cands as any).__kind === 'string') {
      const k = (cands as any).__kind.toLowerCase();
      if (k === 'yes') return 'yes';
      if (k === 'no') return 'no';
    }
  }
  return null;
}

/* decode helpers */
function getFieldAsPubkey(acc: AnyObj, ...keys: string[]): PublicKey | null {
  for (const k of keys) {
    const v = acc?.[k];
    if (!v) continue;
    try {
      return new PublicKey(v);
    } catch {}
  }
  return null;
}
function getFieldAsBigint(acc: AnyObj, ...keys: string[]): bigint | null {
  for (const k of keys) {
    const v = acc?.[k];
    if (v === undefined || v === null) continue;
    try {
      return BigInt(v.toString?.() ?? v);
    } catch {}
  }
  return null;
}
function getFieldAsBoolean(acc: AnyObj, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = acc?.[k];
    if (typeof v === 'boolean') return v;
  }
  return null;
}

/* odds + market extract */
function extractKnownFields(decoded: any): {
  yesAtoms?: bigint;
  noAtoms?: bigint;
  cutoff?: number;
  resolved?: boolean;
  winner?: 'yes' | 'no' | null;
  mint?: string;
} {
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
  } else if (rawWin && rawWin.__kind) {
    const w = String(rawWin.__kind).toLowerCase();
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

  if ((out.winner === null || out.winner === undefined) && out.resolved === true && out.yesAtoms !== undefined && out.noAtoms !== undefined) {
    if (out.yesAtoms > out.noAtoms) out.winner = 'yes';
    else if (out.noAtoms > out.yesAtoms) out.winner = 'no';
  }

  const mint = get(/^mint$/);
  if (mint) out.mint = String(mint);

  return out;
}

/* PDA / ATA helpers + memo + explorer */
function pda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
async function ensureAtaIx(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
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
async function dryRun(
  connection: Connection,
  ixs: TransactionInstruction[],
  payer: PublicKey
) {
  const { blockhash } = await connection.getLatestBlockhash('processed');
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  return { tx, sim };
}
function explorerTxUrl(endpoint: string | undefined, sig: string) {
  const lower = (endpoint ?? '').toLowerCase();
  const cluster = lower.includes('devnet') ? 'devnet' : lower.includes('testnet') ? 'testnet' : 'mainnet';
  return cluster === 'mainnet' ? `https://solscan.io/tx/${sig}` : `https://solscan.io/tx/${sig}?cluster=${cluster}`;
}
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: new TextEncoder().encode(text),
  });
}

/* IDL-driven account mapping (claim) */
function resolveAccountByName(
  name: string,
  opts: {
    market: PublicKey;
    bettor: PublicKey;
    bettorAta: PublicKey;
    owner: PublicKey;
    ownerFeeAta: PublicKey;
    mint: PublicKey;
    vaultAuthority: PublicKey;
    vault: PublicKey;
    position: PublicKey;
  }
): PublicKey | null {
  const raw = (name || '').toLowerCase().replace(/\s+/g, '_');

  if (raw === 'market') return opts.market;
  if (raw === 'mint' || raw.endsWith('_mint')) return opts.mint;
  if (raw.includes('vault') && raw.includes('authority')) return opts.vaultAuthority;
  if (raw === 'vault' || (raw.includes('vault') && !raw.includes('authority'))) return opts.vault;
  if (raw === 'position' || raw.endsWith('_position') || raw.includes('pos')) return opts.position;
  if (raw.includes('owner') && raw.includes('ata')) return opts.ownerFeeAta;
  if (raw === 'owner' || raw === 'house' || raw.startsWith('fee')) return opts.owner;
  if (raw.includes('bettor') && raw.includes('ata')) return opts.bettorAta;
  if ((raw.includes('bettor') || raw.includes('user') || raw.includes('player')) && !raw.includes('ata')) return opts.bettor;
  if (raw.includes('associated') && raw.includes('token')) return ASSOCIATED_TOKEN_PROGRAM_ID;
  if (raw.includes('token') && raw.includes('program')) return TOKEN_PROGRAM_ID;
  if (raw.includes('system') && raw.includes('program')) return SystemProgram.programId;
  if (raw === 'rent' || (raw.includes('sysvar') && raw.includes('rent'))) return SYSVAR_RENT_PUBKEY;
  return null;
}
type AccountMetaLite = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
function buildKeysFromIdl(idlIx: any, mapping: (name: string) => PublicKey | null): AccountMetaLite[] {
  const metas: AccountMetaLite[] = [];
  for (const acc of idlIx.accounts as Array<any>) {
    const pk = mapping(acc.name);
    let fallback: PublicKey | null = null;
    const norm = (acc.name as string).toLowerCase().replace(/\s+/g, '_');
    if (norm.includes('token') && norm.includes('program')) fallback = TOKEN_PROGRAM_ID;
    if (norm.includes('associated') && norm.includes('token')) fallback = ASSOCIATED_TOKEN_PROGRAM_ID;
    if (norm.includes('system') && norm.includes('program')) fallback = SystemProgram.programId;
    if (norm === 'rent') fallback = SYSVAR_RENT_PUBKEY;
    const pubkey = pk ?? fallback;
    if (!pubkey) throw new Error(`Unmapped account in IDL: ${acc.name}`);
    const forceWritable = /ata|token|vault|position|fee|market/.test(norm) && !/program/.test(norm);
    metas.push({
      pubkey,
      isSigner: !!acc.isSigner,
      isWritable: !!acc.isMut || forceWritable,
    });
  }
  return metas;
}
function findClaimIx(theIdl: Idl) {
  const list = theIdl.instructions ?? [];
  const score = (n: string) => {
    const s = n.toLowerCase();
    let v = 0;
    if (s.includes('claim')) v += 6;
    if (s.includes('redeem') || s.includes('withdraw') || s.includes('payout')) v += 3;
    if (s.includes('winnings') || s.includes('prize')) v += 1;
    return v;
  };
  return [...list].sort((a, b) => score(b.name) - score(a.name))[0] ?? null;
}

/* ───────────────────────────────── Types ───────────────────────────────── */
type PositionRow = {
  name: string;
  pubkey: PublicKey;
  acc: AnyObj;
  bettor?: PublicKey;
  market?: PublicKey;

  side?: 'yes' | 'no' | null;
  amount?: bigint;

  yesAtoms?: bigint;
  noAtoms?: bigint;
  status?: 'Open' | 'Locked' | 'Resolved' | 'Unknown';
  winner?: 'yes' | 'no' | null;
  yesPct?: number;
  noPct?: number;
  multiplier?: number | null;

  canClaim?: boolean;
  marketName?: string | null;
};

/* ───────────────────────────────── Component ───────────────────────────────── */
export default function PositionsPage() {
  const connection = getConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const { push } = useToast();

  const conn = useMemo<Connection>(() => connection, [connection]);

  const [idl, setIdl] = useState<Idl | null>(null);
  const [coder, setCoder] = useState<BorshCoder | null>(null);
  const [claimIx, setClaimIx] = useState<any | null>(null);

  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // tabs
  const [tab, setTab] = useState<'active' | 'lost'>('active');

  /* Load IDL ONCE and compute claim instruction */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await loadYesNoIDL();
        if (!alive) return;
        if (!loaded) throw new Error('IDL JSON not found (src/idl/yesno_bets.json)');
        setIdl(loaded);
        setCoder(getCoderOrNull(loaded));
        setClaimIx(findClaimIx(loaded));
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load IDL');
      }
    })();
    return () => { alive = false; };
  }, []);

  const scan = useCallback(async () => {
    setErr('');
    if (!publicKey) { setErr('Connect wallet first'); return; }
    if (!idl || !coder) { setErr('IDL still loading'); return; }

    setLoading(true);
    try {
      const accts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: 'processed' });

      const mine: PositionRow[] = [];
      for (const a of accts) {
        // try to decode with all account types from the IDL
        let decoded: AnyObj | null = null;
        let name = '';
        for (const acct of (idl.accounts ?? [])) {
          try {
            const d = coder.accounts.decode(acct.name, a.account.data);
            if (d) { decoded = d as AnyObj; name = acct.name; break; }
          } catch {}
        }
        if (!decoded) continue;

        const bettor = getFieldAsPubkey(decoded, 'bettor', 'owner', 'user') || null;
        if (!bettor || !bettor.equals(publicKey)) continue;

        const market = getFieldAsPubkey(decoded, 'market', 'marketPk') || null;
        const amount = getFieldAsBigint(decoded, 'amount', 'stake', 'wager', 'atoms') ?? null;

        mine.push({
          name,
          pubkey: a.pubkey,
          acc: decoded,
          bettor,
          market,
          side: getSide(decoded),
          amount,
        });
      }

      const out: PositionRow[] = [];
      for (const r of mine) {
        if (!r.market) { out.push(r); continue; }

        const info = await conn.getAccountInfo(r.market, 'processed');
        if (!info) { out.push(r); continue; }

        // decode market account using IDL
        let mDecoded: any = null;
        for (const acct of (idl.accounts ?? [])) {
          try {
            const d = coder.accounts.decode(acct.name, info.data);
            if (d) { mDecoded = d; break; }
          } catch {}
        }
        if (!mDecoded) { out.push(r); continue; }

        const f = extractKnownFields(mDecoded);
        const now = Math.floor(Date.now() / 1000);
        const status: PositionRow['status'] =
          f.resolved === true ? 'Resolved'
          : f.cutoff !== undefined
            ? (now < (f.cutoff ?? 0) ? 'Open' : 'Locked')
            : 'Unknown';

        let yesPct = 0, noPct = 0, mult: number | null = null;
        const y = Number(f.yesAtoms ?? 0n);
        const n = Number(f.noAtoms ?? 0n);
        const t = y + n;
        if (t > 0) {
          yesPct = (y / t) * 100;
          noPct = (n / t) * 100;
          if (r.side === 'yes') mult = y > 0 ? t / y : null;
          else if (r.side === 'no') mult = n > 0 ? t / n : null;
        }

        const oneSided = (y === 0 && n > 0) || (n === 0 && y > 0);
        const sideOppositeWinner = !!(f.winner && r.side && f.winner !== r.side);
        const oneSidedRefundRule = status === 'Resolved' && oneSided && sideOppositeWinner;

        const posBooleanWin = getFieldAsBoolean(r.acc, 'isWinner', 'won', 'didWin', 'claimable', 'redeemable', 'isClaimable') === true;
        const posPositivePayout =
          (getFieldAsBigint(r.acc,'payout','pendingPayout','winnings','claimableAmount','redeemableAmount','owed','reward') ?? 0n) > 0n;
        const posRefundBool = getFieldAsBoolean(r.acc, 'refundable', 'canRefund', 'isRefundable') === true;
        const posRefundAmtPositive = (getFieldAsBigint(r.acc,'refund','refundAmount','refundableAmount') ?? 0n) > 0n;

        const canClaim =
          status === 'Resolved' &&
          (
            (f.winner && r.side && f.winner === r.side) ||
            posBooleanWin || posPositivePayout || posRefundBool || posRefundAmtPositive || oneSidedRefundRule
          );

        const marketName = getSavedMarketName(r.market.toBase58());

        out.push({
          ...r,
          yesAtoms: f.yesAtoms,
          noAtoms: f.noAtoms,
          status,
          winner: f.winner ?? null,
          yesPct,
          noPct,
          multiplier: mult,
          canClaim,
          marketName,
        });
      }

      setRows(out);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [conn, publicKey, idl, coder]);

  useEffect(() => { if (connected) scan(); }, [connected, scan]);

  /* Claim action (uses IDL-driven mapping) */
  const onClaim = useCallback(async (row: PositionRow) => {
    if (!connected || !publicKey) { push({ variant: 'warning', message: 'Connect wallet' }); return; }
    if (!row.market) { push({ variant: 'error', message: 'Missing market for this position' }); return; }
    if (!idl || !coder || !claimIx) { push({ variant: 'error', message: 'IDL still loading' }); return; }

    try {
      const bettor = publicKey;
      const marketPk = row.market;

      const bettorAta = getAssociatedTokenAddressSync(MINT, bettor, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const ownerFeeAta = getAssociatedTokenAddressSync(MINT, OWNER, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const vaultAuthority = pda([Buffer.from('vault-auth'), marketPk.toBuffer()]);

      const needBettor = await ensureAtaIx(conn, bettor, bettor, MINT);
      const needOwner = await ensureAtaIx(conn, bettor, OWNER, MINT);
      const needVault = await ensureAtaIx(conn, bettor, vaultAuthority, MINT);

      const keys = buildKeysFromIdl(
        claimIx,
        (name) =>
          resolveAccountByName(name, {
            market: marketPk,
            bettor,
            bettorAta,
            owner: OWNER,
            ownerFeeAta,
            mint: MINT,
            vaultAuthority,
            vault: needVault.ata,
            position: row.pubkey,
          })
      );

      const data = (coder as BorshCoder).instruction.encode(claimIx.name, {});
      const baseIxs: TransactionInstruction[] = [
        memoIx('Claim', bettor),
        ...(needBettor.ix ? [needBettor.ix] : []),
        ...(needOwner.ix ? [needOwner.ix] : []),
        ...(needVault.ix ? [needVault.ix] : []),
      ];
      const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

      // simulate (fast) then sign+send (skip preflight since we just sim'd)
      const { tx, sim } = await dryRun(conn, [...baseIxs, ix], bettor);
      if (sim.value?.err) {
        const logs = (sim.value?.logs ?? []).join('\n');
        throw new Error(`Simulation failed\n${logs}`);
      }

      const signed = await wallet.signTransaction!(tx);
      const sig = await conn.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'processed',
        maxRetries: 3,
      });

      push({
        variant: 'success',
        title: 'Claimed',
        message: `${sig.slice(0, 8)}…`,
        href: explorerTxUrl((conn as any).rpcEndpoint, sig),
      });

      await scan();
    } catch (e: any) {
      console.error(e);
      push({ variant: 'error', title: 'Claim failed', message: String(e?.message ?? e).slice(0, 300) });
    }
  }, [connected, publicKey, conn, wallet, push, scan, idl, coder, claimIx]);

  /* Derived lists for tabs */
  const activeRows = useMemo(
    () => rows.filter((r) => r.status === 'Open' || r.status === 'Locked' || (r.status === 'Resolved' && r.canClaim)),
    [rows]
  );
  const lostRows = useMemo(() => {
    const list = rows.filter((r) => r.status === 'Resolved' && !r.canClaim);
    return list.sort((a, b) => (a.marketName ?? '').localeCompare(b.marketName ?? ''));
  }, [rows]);

  const renderRow = (r: PositionRow) => {
    const marketAddr = r.market?.toBase58() ?? '';
    const title = r.marketName ?? marketAddr;
    const yesPct = Number.isFinite(r.yesPct!) ? Math.max(0, Math.min(100, r.yesPct!)) : 0;
    const noPct = 100 - yesPct;
    const showClaim = r.canClaim === true;

    return (
      <div key={r.pubkey.toBase58()} className="rounded-xl border border-stroke bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {r.market && (
              <Link
                href={`/market/${r.market.toBase58()}?title=${encodeURIComponent(title)}`}
                className="text-zinc-100 hover:underline font-medium"
                title={title}
              >
                {title}
              </Link>
            )}
            {r.market && <CopyChip value={r.market.toBase58()} />}
          </div>

          {r.market && (
            <Link
              href={`/market/${r.market.toBase58()}?title=${encodeURIComponent(title)}`}
              className="px-3 py-1.5 rounded-lg border border-stroke text-zinc-200 hover:border-white/20"
              target="_blank"
            >
              Open
            </Link>
          )}
        </div>

        {/* Odds mini-bar */}
        <div className="mt-3">
          <div className="h-3 w-full rounded bg-zinc-800 overflow-hidden flex">
            <div style={{ width: `${yesPct}%` }} className="bg-emerald-500" />
            <div style={{ width: `${noPct}%` }} className="bg-rose-500" />
          </div>
          <div className="mt-1 text-[11px] text-zinc-400 flex items-center gap-3">
            <span>YES {yesPct.toFixed(1)}%</span>
            <span>NO {noPct.toFixed(1)}%</span>
            {r.status && <span>• {r.status}</span>}
            {r.status === 'Resolved' && r.winner && <span>• Winner: {r.winner.toUpperCase()}</span>}
          </div>
        </div>

        <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="panel p-3">
            <div className="text-xs text-zinc-400 mb-1">Side</div>
            <div className="text-zinc-100">{r.side ? r.side.toUpperCase() : '—'}</div>
          </div>
          <div className="panel p-3">
            <div className="text-xs text-zinc-400 mb-1">Stake</div>
            <div className="text-zinc-100">
              {r.amount !== null && r.amount !== undefined ? fmtAtoms(r.amount!, DECIMALS) : '—'}
              {r.status !== 'Open' && r.multiplier ? (
                <span className="ml-2 text-xs text-zinc-400">({r.multiplier.toFixed(2)}x)</span>
              ) : null}
            </div>
          </div>
          <div className="panel p-3 flex items-center justify-between">
            <div className="text-xs text-zinc-400">Actions</div>
            <div className="flex items-center gap-2">
              {showClaim && (
                <button
                  onClick={() => onClaim(r)}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Claim
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* UI */
  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Positions</h1>
        <MintBadge mint={MINT} symbol={MINT_SYMBOL} decimals={DECIMALS} />
      </div>

      <ConnectGate bannerText="Connect your wallet to list and claim your positions.">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={scan}
              disabled={!connected || loading}
              title="Refresh"
              aria-label="Refresh"
              className="p-2 rounded-full border border-stroke bg-black/30 hover:bg-white/10 btn-disabled"
            >
              <RefreshIcon className={`h-5 w-5 text-white/85 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {err && <span className="ml-2 text-xs text-rose-400">{err}</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex items-center gap-2">
          <button
            onClick={() => setTab('active')}
            className={`px-3 py-1.5 rounded-lg border ${
              tab === 'active' ? 'border-white/30 bg-white/10' : 'border-stroke bg-black/30 hover:bg-white/10'
            }`}
          >
            Active <span className="opacity-70 text-xs">({activeRows.length})</span>
          </button>
          <button
            onClick={() => setTab('lost')}
            className={`px-3 py-1.5 rounded-lg border ${
              tab === 'lost' ? 'border-white/30 bg-white/10' : 'border-stroke bg-black/30 hover:bg-white/10'
            }`}
          >
            Lost <span className="opacity-70 text-xs">({lostRows.length})</span>
          </button>
        </div>

        {!loading && tab === 'active' && activeRows.length === 0 && (
          <div className="rounded-lg border border-stroke p-4 text-sm text-zinc-300">No active positions.</div>
        )}
        {!loading && tab === 'lost' && lostRows.length === 0 && (
          <div className="rounded-lg border border-stroke p-4 text-sm text-zinc-300">No lost positions.</div>
        )}

        <div className="space-y-4">
          {(tab === 'active' ? activeRows : lostRows).map(renderRow)}
        </div>
      </ConnectGate>
    </div>
  );
}

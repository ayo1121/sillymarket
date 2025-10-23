// src/app/market/[pubkey]/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  AccountMeta,
  SYSVAR_RENT_PUBKEY,
  SendTransactionError,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { BN, Idl, BorshCoder } from '@coral-xyz/anchor';

import { useToast } from '@/components/ui/Toast';
import { loadYesNoIDL, getCoderOrNull } from '@/lib/idl';
import { PROGRAM_ID, MINT, OWNER, DECIMALS, MINT_SYMBOL } from '@/lib/constants';
import { CopyChip } from '@/components/ui/CopyChip';
import { MintBadge } from '@/components/ui/MintBadge';
import { ConnectGate } from '@/components/ui/ConnectGate';

type ActivityRow =
  | { type: 'place'; sig: string; ts: number | null; wallet: string; side: 'YES' | 'NO' | '?'; amount?: string }
  | { type: 'resolve'; sig: string; ts: number | null; wallet: string; outcome: 'YES' | 'NO' | '?' }
  | { type: 'claim'; sig: string; ts: number | null; wallet: string; amount?: string };

function sanitize(msg: string) {
  return (msg || '')
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/api[-_ ]?key=[A-Za-z0-9-_]+/gi, 'api-key=[redacted]');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Enhanced retry function with exponential backoff and 429 handling
async function getAccountInfoRetry(
  connection: any,
  pk: PublicKey,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'processed',
  tries = 6
) {
  for (let i = 0; i < tries; i++) {
    try {
      return await connection.getAccountInfo(pk, commitment);
    } catch (e: any) {
      if (e.message?.includes('429') || e.message?.includes('rate limit') || e.message?.includes('too many requests')) {
        console.log(`Rate limit hit, waiting ${Math.min(1000 * Math.pow(2, i), 10000)}ms`);
        await sleep(Math.min(1000 * Math.pow(2, i), 10000)); // Exponential backoff max 10s
      } else if (i === tries - 1) {
        throw e;
      } else {
        await sleep(500 * (i + 1));
      }
    }
  }
  return null;
}
const safeStringify = (obj: any, space?: number) => {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, space);
};

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, 'utf8'),
  });
}
function pda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

// Enhanced ATA creation with rate limit handling
async function ensureAtaIx(
  connection: any,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID,
  ataProgram = ASSOCIATED_TOKEN_PROGRAM_ID
) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ataProgram);
  let info = null;
  let retries = 3;
  
  for (let i = 0; i < retries; i++) {
    try {
      info = await connection.getAccountInfo(ata, 'processed');
      break;
    } catch (e: any) {
      if (e.message?.includes('429') && i < retries - 1) {
        await sleep(1000 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  
  if (info) return { ata, ix: null as TransactionInstruction | null };
  const ix = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    ata,
    owner,
    mint,
    tokenProgram,
    ataProgram
  );
  return { ata, ix };
}

function toAtoms6(ui: string): bigint {
  const t = ui.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(t)) throw new Error('Invalid number');
  const [i, f = ''] = t.split('.');
  const f6 = (f + '000000').slice(0, 6);
  return BigInt(i) * 1_000_000n + BigInt(f6);
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
function explorerTxUrl(endpoint: string, sig: string) {
  const lower = endpoint?.toLowerCase?.() ?? '';
  const cluster =
    lower.includes('devnet') ? 'devnet' : lower.includes('testnet') ? 'testnet' : 'mainnet';
  return cluster === 'mainnet'
    ? `https://solscan.io/tx/${sig}`
    : `https://solscan.io/tx/${sig}?cluster=${cluster}`;
}

function OddsBar({
  yesPct,
  noPct,
  yesMult,
  noMult,
  showMultipliers,
  isEmpty,
}: {
  yesPct: number;
  noPct: number;
  yesMult?: number | null;
  noMult?: number | null;
  showMultipliers?: boolean;
  isEmpty?: boolean;
}) {
  const yPct = Number.isFinite(yesPct) ? Math.max(0, Math.min(100, yesPct)) : 0;
  const nPct = Number.isFinite(noPct) ? Math.max(0, Math.min(100, noPct)) : 0;
  const oneSided = !isEmpty && (yPct === 0 || yPct === 100 || nPct === 0 || nPct === 100);

  const SLIVER = 8;
  const yVisual = isEmpty
    ? 50
    : oneSided
    ? yPct === 0
      ? SLIVER
      : yPct === 100
      ? 100 - SLIVER
      : yPct
    : yPct;
  const nVisual = 100 - yVisual;

  const fmtMult = (m: number | null | undefined) => {
    if (m == null || !isFinite(m)) return '—x';
    if (m > 9999) return '—x';
    if (m <= 0) return '—';
    return `${m.toFixed(2)}x`;
  };
  const fmtPct = (p: number) => `${p.toFixed(1)}%`;

  return (
    <div className="frame">
      <div className="titlebar">
        <div className="title">📊 Current Odds</div>
      </div>
      <div className="frame-body p-4">
        <div className="w-full">
          <div className="relative h-16 w-full border-2 border-gray-900 bg-gray-300 overflow-hidden flex">
            <div
              style={{ width: `${yVisual}%` }}
              className="relative bg-teal-400 border-r-2 border-gray-900 flex items-center justify-center"
            >
              {isEmpty ? (
                <span className="text-xl font-bold text-gray-600">—</span>
              ) : (
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900">
                    {fmtPct(yPct)}
                  </div>
                  {showMultipliers && (
                    <div className="mt-0.5 text-xs text-gray-900">
                      {fmtMult(yesMult ?? null)}
                    </div>
                  )}
                </div>
              )}
            </div>
            {oneSided && (
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-gray-900 pointer-events-none" />
            )}
            <div
              style={{ width: `${nVisual}%` }}
              className="relative bg-rose-400 flex items-center justify-center"
            >
              {isEmpty ? (
                <span className="text-xl font-bold text-gray-600">—</span>
              ) : (
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900">
                    {fmtPct(nPct)}
                  </div>
                  {showMultipliers && (
                    <div className="mt-0.5 text-xs text-gray-900">
                      {fmtMult(noMult ?? null)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 bg-teal-400 border border-gray-900" />
              YES
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 bg-rose-400 border border-gray-900" />
              NO
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const LS_KEY = 'ynb-market-names';
function getSavedMarketName(addr: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return typeof map?.[addr] === 'string' ? map[addr] : null;
  } catch {
    return null;
  }
}
function decodeMarketTitleFromAccount(decoded: any): string | null {
  if (!decoded) return null;
  const candidates = ['name', 'title', 'question', 'marketName'];
  for (const c of candidates) {
    const v = decoded[c];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

type ParsedAnchorErr = { code?: number; msg?: string; name?: string };
function buildAnchorErrorLookup(idl: Idl | null) {
  const byCode = new Map<number, { name?: string; msg?: string }>();
  const byName = new Map<string, { code?: number; msg?: string }>();
  const errs: any[] = (idl as any)?.errors ?? [];
  for (const e of errs) {
    if (typeof e?.code === 'number') byCode.set(e.code, { name: e?.name, msg: e?.msg });
    if (typeof e?.name === 'string') byName.set(e.name, { code: e?.code, msg: e?.msg });
  }
  return { byCode, byName };
}
function parseAnchorFromLogs(logs?: string[]): ParsedAnchorErr | null {
  if (!logs || !logs.length) return null;
  let code: number | undefined;
  let name: string | undefined;
  let msg: string | undefined;
  for (const l of logs) {
    const m1 = l.match(
      /AnchorError.*?Error Code:\s*([A-Za-z0-9_]+).*?Error Number:\s*(\d+).*?Error Message:\s*(.*)$/
    );
    if (m1) {
      name = m1[1];
      code = Number(m1[2]);
      msg = m1[3].trim();
      break;
    }
    const m3 = l.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (m3) code = parseInt(m3[1], 16);
    const m4 = l.match(/Program log: (?:Error: )(.+)$/);
    if (m4 && !msg) msg = m4[1].trim();
  }
  if (!code && !msg && !name) return null;
  return { code, msg, name };
}
function friendlyFromLogs(idl: Idl | null, logs?: string[], fallback?: string) {
  const parsed = parseAnchorFromLogs(logs);
  const { byCode, byName } = buildAnchorErrorLookup(idl);
  if (parsed?.code !== undefined && byCode.has(parsed.code)) {
    const m = byCode.get(parsed.code)!;
    const label = m.name ? `${m.name} (${parsed.code})` : `Code ${parsed.code}`;
    const text = m.msg ?? parsed.msg ?? fallback ?? 'Transaction failed';
    return `${label}: ${text}`;
  }
  if (parsed?.name && byName.has(parsed.name)) {
    const m = byName.get(parsed.name)!;
    const label = m.code !== undefined ? `${parsed.name} (${m.code})` : parsed.name;
    const text = m.msg ?? parsed.msg ?? fallback ?? 'Transaction failed';
    return `${label}: ${text}`;
  }
  if (parsed?.msg) return parsed.msg;
  return fallback ?? 'Simulation failed';
}

function findPlaceBetInstruction(idl: Idl) {
  const list = idl.instructions ?? [];
  const score = (name: string) => {
    const n = name.toLowerCase();
    let s = 0;
    if (n.includes('place')) s++;
    if (n.includes('bet')) s++;
    if (n === 'place_bet' || n === 'placebet') s += 8;
    return s;
  };
  return [...list].sort((a, b) => score(b.name) - score(a.name))[0] ?? null;
}
function resolveBetArgsShape(idl: Idl, ix: any) {
  const amountArg =
    ix.args.find(
      (a: any) =>
        a.type === 'u64' || a.type?.defined === 'u64' || /amount|stake|atoms/i.test(a.name)
    )?.name ?? 'amount';

  let sideKind: 'enum' | 'u8' = 'u8';
  let sideArgName = 'side';
  let yesVariant = 'Yes';
  let noVariant = 'No';

  const sideArg = ix.args.find((a: any) => /side|choice|direction|vote/i.test(a.name)) ?? ix.args[0];
  if (sideArg) {
    sideArgName = sideArg.name;
    if (typeof sideArg.type === 'object' && 'defined' in sideArg.type) {
      sideKind = 'enum';
      const enumName = sideArg.type.defined;
      const enumDef = (idl.types ?? []).find(
        (t: any) => t.name === enumName && t.type?.kind === 'enum'
      );
      if (enumDef) {
        const vars = enumDef.type.variants;
        const yi = vars.findIndex((v: any) => v.name.toLowerCase() === 'yes');
        const ni = vars.findIndex((v: any) => v.name.toLowerCase() === 'no');
        if (yi >= 0) yesVariant = vars[yi].name;
        if (ni >= 0) noVariant = vars[ni].name;
        if (yi < 0 && vars[0]) yesVariant = vars[0].name;
        if (ni < 0 && vars[1]) noVariant = vars[1].name;
      }
    } else if (sideArg.type === 'u8' || sideArg.type === 'u32') {
      sideKind = 'u8';
    }
  }
  return { amountArg, sideArgName, sideKind, yesVariant, noVariant };
}
function findResolveIx(idl: Idl) {
  const list = idl.instructions ?? [];
  const score = (n: string) => {
    const s = n.toLowerCase();
    let v = 0;
    if (s.includes('resolve')) v += 6;
    if (s.includes('settle') || s.includes('finalize') || s.includes('close')) v += 2;
    if (s.includes('market')) v += 1;
    return v;
  };
  return [...list].sort((a, b) => score(b.name) - score(a.name))[0] ?? null;
}
function outcomeArgShape(idl: Idl, ix: any) {
  const outcomeArg =
    ix.args.find((a: any) => /result|outcome|winner|side|choice/i.test(a.name))?.name ??
    ix.args[0]?.name ??
    'outcome';
  let kind: 'enum' | 'u8' = 'u8';
  let yesVar = 'Yes';
  let noVar = 'No';
  const arg = ix.args.find((a: any) => a.name === outcomeArg);
  if (arg && typeof arg.type === 'object' && 'defined' in arg.type) {
    kind = 'enum';
    const enumName = arg.type.defined;
    const enumDef = (idl.types ?? []).find(
      (t: any) => t.name === enumName && t.type?.kind === 'enum'
    );
    if (enumDef) {
      const vars = enumDef.type.variants;
      const yi = vars.findIndex((v: any) => v.name.toLowerCase() === 'yes');
      const ni = vars.findIndex((v: any) => v.name.toLowerCase() === 'no');
      if (yi >= 0) yesVar = vars[yi].name;
      if (ni >= 0) noVar = vars[ni].name;
      if (yi < 0 && vars[0]) yesVar = vars[0].name;
      if (ni < 0 && vars[1]) noVar = vars[1].name;
    }
  } else if (arg && (arg.type === 'u8' || arg.type === 'u32')) {
    kind = 'u8';
  }
  return { outcomeArg, kind, yesVar, noVar };
}
function findClaimIx(idl: Idl) {
  const list = idl.instructions ?? [];
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
  if ((raw.includes('bettor') || raw.includes('user') || raw.includes('player')) && !raw.includes('ata'))
    return opts.bettor;
  if (raw.includes('associated') && raw.includes('token')) return ASSOCIATED_TOKEN_PROGRAM_ID;
  if (raw.includes('token') && raw.includes('program')) return TOKEN_PROGRAM_ID;
  if (raw.includes('system') && raw.includes('program')) return SystemProgram.programId;
  if (raw === 'rent' || (raw.includes('sysvar') && raw.includes('rent'))) return SYSVAR_RENT_PUBKEY;
  return null;
}
function buildKeysFromIdl(idlIx: any, mapping: (name: string) => PublicKey | null): AccountMeta[] {
  const metas: AccountMeta[] = [];
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

type MarketStrict = {
  decodedName: string;
  decoded: any;
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

// Enhanced field extraction with better winner detection
function extractKnownFields(decoded: any): Partial<MarketStrict> {
  const out: Partial<MarketStrict> = {};
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

  // Enhanced winner extraction
  const rawWin = get(/(winner|result|winning|side|outcome)$/);
  console.log('🔍 Raw winner data:', rawWin, typeof rawWin);
  
  if (typeof rawWin === 'string') {
    const w = rawWin.toLowerCase();
    out.winner = w.includes('yes') ? 'yes' : w.includes('no') ? 'no' : null;
  } else if (rawWin && (rawWin as any).__kind) {
    const w = String((rawWin as any).__kind).toLowerCase();
    out.winner = w.includes('yes') ? 'yes' : w.includes('no') ? 'no' : null;
  } else {
    const bn = bnLikeToBigint(rawWin);
    if (bn !== undefined) {
      const n = Number(bn);
      out.winner = n === 1 ? 'yes' : n === 0 ? 'no' : null;
    } else if (rawWin && typeof rawWin === 'object') {
      // Handle nested winner objects
      if (rawWin.yes !== undefined) out.winner = 'yes';
      else if (rawWin.no !== undefined) out.winner = 'no';
    }
  }

  console.log('🎯 Extracted winner:', out.winner);

  const mint = get(/^mint$/);
  if (mint) out.mint = String(mint);

  return out;
}

export default function MarketPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { push } = useToast();

  const params = useParams<{ pubkey: string }>();
  const search = useSearchParams();
  const pubkeyStr = params?.pubkey as string;
  const marketPk = useMemo(() => new PublicKey(pubkeyStr), [pubkeyStr]);
  const marketStr = marketPk.toBase58();

  const [uiTitle, setUiTitle] = useState<string>(pubkeyStr);

  const [idl, setIdl] = useState<Idl | null>(null);
  const [coder, setCoder] = useState<BorshCoder | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<boolean>(false);

  const [betMeta, setBetMeta] = useState<{
    ix: any;
    amountArg: string;
    sideArgName: string;
    sideKind: 'enum' | 'u8';
    yesVariant: string;
    noVariant: string;
  } | null>(null);

  const [resolveMeta, setResolveMeta] = useState<{
    ix: any;
    outcomeArg: string;
    kind: 'enum' | 'u8';
    yesVar: string;
    noVar: string;
  } | null>(null);

  const [claimMeta, setClaimMeta] = useState<any | null>(null);

  const [strict, setStrict] = useState<MarketStrict | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const [userPos, setUserPos] = useState<{ exists: boolean; side: 'yes' | 'no' | null; stake?: bigint }>(
    { exists: false, side: null, stake: 0n }
  );

  // Enhanced claim state management
  const [isClaiming, setIsClaiming] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(false);

  /* IDL load */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await loadYesNoIDL();
        if (!alive) return;
        if (!loaded) throw new Error('IDL JSON not found (src/idl/yesno_bets.json)');
        const c = getCoderOrNull(loaded);
        setIdl(loaded);
        setCoder(c);

        const betIx = findPlaceBetInstruction(loaded);
        if (betIx) {
          const s = resolveBetArgsShape(loaded, betIx);
          setBetMeta({
            ix: betIx,
            amountArg: s.amountArg,
            sideArgName: s.sideArgName,
            sideKind: s.sideKind,
            yesVariant: s.yesVariant,
            noVariant: s.noVariant,
          });
        }
        const resIx = findResolveIx(loaded);
        if (resIx) {
          const s = outcomeArgShape(loaded, resIx);
          setResolveMeta({
            ix: resIx,
            outcomeArg: s.outcomeArg,
            kind: s.kind,
            yesVar: s.yesVar,
            noVar: s.noVar,
          });
        }
        const claimIx = findClaimIx(loaded);
        if (claimIx) setClaimMeta(claimIx);
      } catch (e: any) {
        if (alive) setErr(sanitize(e?.message ?? 'Failed to load IDL'));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* strict decode + subscribe with rate limit handling */
  useEffect(() => {
    if (!idl || !coder) return;
    let cancelled = false;

    const decode = async () => {
      try {
        setDecodeError(null);
        setRateLimit(false);
        const info = await getAccountInfoRetry(connection, marketPk, 'processed');
        if (!info) {
          setDecodeError('No account found at this address.');
          setStrict(null);
          return;
        }

        const names = (idl.accounts ?? []).map((a) => a.name);
        const ordered = [
          ...names.filter((n) => /market/i.test(n)),
          ...names.filter((n) => !/market/i.test(n)),
        ];

        let decodedName: string | null = null;
        let decoded: any = null;
        for (const name of ordered) {
          try {
            const d = coder!.accounts.decode(name, info.data);
            if (d) {
              decoded = d;
              decodedName = name;
              if (/market/i.test(name)) break;
            }
          } catch {}
        }
        if (!decoded) {
          setDecodeError('This address does not match any account type in the IDL.');
          setStrict(null);
          return;
        }

        const fields = extractKnownFields(decoded);
        const s: MarketStrict = { decodedName: decodedName!, decoded, ...fields };
        if (!cancelled) setStrict(s);
      } catch (e: any) {
        if (e.message?.includes('429')) {
          setRateLimit(true);
          setDecodeError('Rate limit exceeded. Please try again in a moment.');
        } else {
          setDecodeError(sanitize(String(e?.message ?? e)));
        }
        setStrict(null);
      }
    };

    decode();
    const subId = connection.onAccountChange(marketPk, () => {
      if (!rateLimit) {
        decode();
      }
    }, 'processed');
    return () => {
      try {
        connection.removeAccountChangeListener(subId);
      } catch {}
      cancelled = true;
    };
  }, [idl, coder, connection, marketPk, rateLimit]);

  /* Countdown tick */
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  /* Resolve UI title */
  useEffect(() => {
    const fromQuery = search?.get('title');
    if (fromQuery && fromQuery.trim()) {
      setUiTitle(decodeURIComponent(fromQuery));
      return;
    }
    const saved = getSavedMarketName(marketStr);
    if (saved) {
      setUiTitle(saved);
      return;
    }
    const maybe = decodeMarketTitleFromAccount(strict?.decoded);
    if (maybe) setUiTitle(maybe);
    else setUiTitle(pubkeyStr);
  }, [search, marketStr, strict?.decoded, pubkeyStr]);

  /* Derived UI */
  const mintOk = strict?.mint ? new PublicKey(strict.mint).equals(MINT) : true;
  const status =
    strict?.resolved === true
      ? 'Resolved'
      : strict?.cutoff !== undefined
      ? nowSec < strict.cutoff
        ? 'Open'
        : 'Locked'
      : 'Unknown';

  const odds = useMemo(() => {
    if (strict?.yesAtoms === undefined || strict?.noAtoms === undefined) return null;
    const y = Number(strict.yesAtoms);
    const n = Number(strict.noAtoms);
    const t = y + n;
    if (t <= 0) return { yes: 0, no: 0 };
    return { yes: (y / t) * 100, no: (n / t) * 100 };
  }, [strict?.yesAtoms, strict?.noAtoms]);

  const roughMult = useMemo(() => {
    if (strict?.yesAtoms === undefined || strict?.noAtoms === undefined) return null;
    const y = Number(strict.yesAtoms);
    const n = Number(strict.noAtoms);
    const t = y + n;
    const yesMult = y > 0 ? t / y : null;
    const noMult = n > 0 ? t / n : null;
    return { yesMult, noMult };
  }, [strict?.yesAtoms, strict?.noAtoms]);

  const digitalCountdown = useMemo(() => {
    if (!strict?.cutoff) return '— — : — — : — —';
    const delta = strict.cutoff - nowSec;
    if (delta <= 0) return 'Locked';
    const hh = String(Math.floor(delta / 3600)).padStart(2, '0');
    const mm = String(Math.floor((delta % 3600) / 60)).padStart(2, '0');
    const ss = String(delta % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }, [strict?.cutoff, nowSec]);

  const poolUi = useMemo(() => {
    if (strict?.yesAtoms === undefined || strict?.noAtoms === undefined) return '-';
    const total = strict.yesAtoms + strict.noAtoms;
    return trimUi6(atomsToUi6(total));
  }, [strict?.yesAtoms, strict?.noAtoms]);

  const isEmptyMarket =
    strict?.yesAtoms !== undefined &&
    strict?.noAtoms !== undefined &&
    strict.yesAtoms + strict.noAtoms === 0n;

  /* Betting */
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [amount, setAmount] = useState<string>('1');
  const [busyBet, setBusyBet] = useState(false);

  const isOwner = useMemo(
    () => wallet?.publicKey && OWNER && wallet.publicKey.equals(OWNER),
    [wallet?.publicKey]
  );

  /* Resolve (owner only) */
  const [resolveChoice, setResolveChoice] = useState<'yes' | 'no'>('yes');
  const [busyResolve, setBusyResolve] = useState(false);

  /* Enhanced Position PDA helpers with better decoding */
  const pickPositionPda = useCallback(
    async (bettor: PublicKey): Promise<{ addr: PublicKey; exists: boolean; data: Uint8Array | null }> => {
      const cands: PublicKey[] = [
        pda([Buffer.from('position'), marketPk.toBuffer(), bettor.toBuffer()]),
        pda([Buffer.from('pos'), marketPk.toBuffer(), bettor.toBuffer()]),
      ];
      
      let infos;
      try {
        infos = await connection.getMultipleAccountsInfo(cands, { commitment: 'processed' as any });
      } catch (e: any) {
        if (e.message?.includes('429')) {
          await sleep(2000);
          infos = await connection.getMultipleAccountsInfo(cands, { commitment: 'processed' as any });
        } else {
          throw e;
        }
      }
      
      const idx = infos.findIndex((i) => i !== null);
      if (idx >= 0) return { addr: cands[idx], exists: true, data: infos[idx]!.data };
      return { addr: cands[0], exists: false, data: null };
    },
    [connection, marketPk]
  );

  const decodeUserPosition = useCallback(
    (data: Uint8Array | null) => {
      if (!data || !idl) return { exists: false, side: null as 'yes' | 'no' | null, stake: 0n };
      
      try {
        let decoded: any = null;
        try {
          decoded = coder!.accounts.decode('Position', data);
        } catch {
          const names = (idl.accounts ?? []).map((a) => a.name);
          for (const name of names) {
            try {
              decoded = coder!.accounts.decode(name, data);
              if (decoded) {
                console.log('🔍 Decoded position with account type:', name, decoded);
                break;
              }
            } catch (e) {
              // Continue trying other account types
            }
          }
        }
        
        if (!decoded) {
          console.log('❌ No position data decoded');
          return { exists: true, side: null, stake: 0n };
        }

        console.log('📊 Raw decoded position:', decoded);

        let side: 'yes' | 'no' | null = null;
        let stake: bigint = 0n;

        // Enhanced side extraction
        Object.keys(decoded).forEach((key) => {
          const val = decoded[key];
          console.log(`📍 Position field ${key}:`, val, typeof val);
          
          if (key.toLowerCase().includes('side') || key.toLowerCase().includes('choice')) {
            if (typeof val === 'string') {
              const sideStr = val.toLowerCase();
              if (sideStr.includes('yes')) side = 'yes';
              else if (sideStr.includes('no')) side = 'no';
            } else if (typeof val === 'number') {
              side = val === 1 ? 'yes' : 'no';
            } else if (val && typeof val === 'object') {
              // Handle Anchor enums
              if ('__kind' in val) {
                const kind = val.__kind.toLowerCase();
                if (kind.includes('yes')) side = 'yes';
                else if (kind.includes('no')) side = 'no';
              }
              // Handle other object formats
              else if (val.yes !== undefined) side = 'yes';
              else if (val.no !== undefined) side = 'no';
            }
          }
          
          if (key.toLowerCase().includes('stake') || key.toLowerCase().includes('amount')) {
            const b = bnLikeToBigint(val);
            if (b !== undefined) stake = b;
          }
        });

        console.log('✅ Final parsed position:', { side, stake });
        return { exists: true, side, stake };
        
      } catch (error) {
        console.error('❌ Error decoding position:', error);
        return { exists: true, side: null, stake: 0n };
      }
    },
    [idl, coder]
  );

  // Load user's position with retry logic
  useEffect(() => {
    (async () => {
      if (!wallet.publicKey) {
        setUserPos({ exists: false, side: null, stake: 0n });
        return;
      }
      try {
        const { data, exists } = await pickPositionPda(wallet.publicKey);
        const res = decodeUserPosition(data);
        console.log('👤 User position result:', res);
        setUserPos({ exists, side: res.side, stake: res.stake });
      } catch {
        setUserPos({ exists: false, side: null, stake: 0n });
      }
    })();
  }, [wallet.publicKey, marketPk, pickPositionPda, decodeUserPosition]);

  /* Transaction sender with rate limit handling */
  async function sendOne(ixs: TransactionInstruction[], payer: PublicKey) {
    const { blockhash } = await connection.getLatestBlockhash('processed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
    tx.add(...ixs);
    const sig = await wallet.sendTransaction(tx, connection, {
      skipPreflight: false,
      preflightCommitment: 'processed',
      maxRetries: 3,
    });
    return sig;
  }

  const showAnchorError = useCallback(
    async (title: string, errLike: any) => {
      let msg = String(errLike?.message ?? errLike ?? 'Transaction failed');
      try {
        if (errLike instanceof SendTransactionError) {
          const logs = await errLike.getLogs(connection);
          msg = friendlyFromLogs(idl, logs, msg);
        }
      } catch {}
      push({ variant: 'error', title, message: sanitize(msg).slice(0, 300) });
    },
    [connection, idl, push]
  );

  /* Place bet */
  const placeDisabled =
    busyBet ||
    !wallet.connected ||
    !idl ||
    !coder ||
    !betMeta ||
    decodeError !== null ||
    strict === null ||
    (strict?.mint && !mintOk) ||
    status === 'Resolved';

  const onPlaceBet = useCallback(async () => {
    if (status === 'Resolved') return;
    if (!wallet.publicKey) return push({ variant: 'warning', message: 'Connect wallet first.' });
    if (!idl || !coder || !betMeta) return push({ variant: 'error', message: 'IDL still loading.' });
    setBusyBet(true);
    try {
      const bettor = wallet.publicKey;
      const { addr: position } = await pickPositionPda(bettor);

      const needBettor = await ensureAtaIx(connection, bettor, bettor, MINT);
      const needOwner = await ensureAtaIx(connection, bettor, OWNER, MINT);

      const args: any = {};
      args[betMeta.amountArg] = new BN(toAtoms6(amount).toString());
      if (betMeta.sideKind === 'enum') {
        args[betMeta.sideArgName] = side === 'yes' ? { [betMeta.yesVariant]: {} } : { [betMeta.noVariant]: {} };
      } else {
        args[betMeta.sideArgName] = side === 'yes' ? 1 : 0;
      }
      const data = coder!.instruction.encode(betMeta.ix.name, args);

      const vaultAuthority = pda([Buffer.from('vault-auth'), marketPk.toBuffer()]);
      const needVault = await ensureAtaIx(connection, bettor, vaultAuthority, MINT);

      const keys = buildKeysFromIdl(
        betMeta.ix,
        (name) =>
          resolveAccountByName(name, {
            market: marketPk,
            bettor,
            bettorAta: needBettor.ata,
            owner: OWNER,
            ownerFeeAta: needOwner.ata,
            mint: MINT,
            vaultAuthority,
            vault: needVault.ata,
            position,
          })
      );

      const programIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
      const memo = memoIx(`Place ${side.toUpperCase()} ${amount}`, bettor);

      const ixs: TransactionInstruction[] = [
        memo,
        ...(needBettor.ix ? [needBettor.ix] : []),
        ...(needOwner.ix ? [needOwner.ix] : []),
        ...(needVault.ix ? [needVault.ix] : []),
        programIx,
      ];

      const sig = await sendOne(ixs, bettor);
      push({
        variant: 'success',
        title: '✅ Bet Placed!',
        message: `Your ${side} bet of ${amount} ${MINT_SYMBOL} was submitted`,
        href: explorerTxUrl(connection.rpcEndpoint, sig),
      });
    } catch (e: any) {
      await showAnchorError('Place bet', e);
    } finally {
      setBusyBet(false);
    }
  }, [status, wallet, idl, coder, betMeta, connection, marketPk, side, amount, push, pickPositionPda, showAnchorError]);

  /* Resolve */
  const canResolve = isOwner && status === 'Locked' && strict?.resolved !== true && !!resolveMeta;
  const onResolve = useCallback(async () => {
    if (!canResolve || !idl || !coder || !resolveMeta || !wallet.publicKey) return;
    setBusyResolve(true);
    try {
      const payer = wallet.publicKey;

      const args: any = {};
      if (resolveMeta.kind === 'enum') {
        args[resolveMeta.outcomeArg] =
          resolveChoice === 'yes' ? { [resolveMeta.yesVar]: {} } : { [resolveMeta.noVar]: {} };
      } else {
        args[resolveMeta.outcomeArg] = resolveChoice === 'yes' ? 1 : 0;
      }
      const data = coder!.instruction.encode(resolveMeta.ix.name, args);

      const keys = buildKeysFromIdl(resolveMeta.ix, (name) =>
        resolveAccountByName(name, {
          market: marketPk,
          bettor: payer,
          bettorAta: PublicKey.default,
          owner: OWNER,
          ownerFeeAta: PublicKey.default,
          mint: MINT,
          vaultAuthority: pda([Buffer.from('vault-auth'), marketPk.toBuffer()]),
          vault: PublicKey.default,
          position: PublicKey.default,
        })
      );
      const programIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

      const ixs = [memoIx(`Resolve ${resolveChoice.toUpperCase()}`, payer), programIx];
      const sig = await sendOne(ixs, payer);
      push({
        variant: 'success',
        title: '✅ Market Resolved!',
        message: `Market resolved as ${resolveChoice.toUpperCase()}`,
        href: explorerTxUrl(connection.rpcEndpoint, sig),
      });
    } catch (e: any) {
      await showAnchorError('Resolve', e);
    } finally {
      setBusyResolve(false);
    }
  }, [canResolve, idl, coder, resolveMeta, resolveChoice, wallet, connection, marketPk, push, showAnchorError]);

  /* FIXED: Enhanced Claim Functionality */
  const onClaim = useCallback(async () => {
    if (!wallet.publicKey || !idl || !coder || !claimMeta || hasClaimed) return;
    
    setIsClaiming(true);
    try {
      const bettor = wallet.publicKey;
      const { addr: position } = await pickPositionPda(bettor);

      const bettorAta = getAssociatedTokenAddressSync(MINT, bettor, true);
      const ownerFeeAta = getAssociatedTokenAddressSync(MINT, OWNER, true);

      const needBettor = await ensureAtaIx(connection, bettor, bettor, MINT);
      const needOwner = await ensureAtaIx(connection, bettor, OWNER, MINT);

      const vaultAuthority = pda([Buffer.from('vault-auth'), marketPk.toBuffer()]);
      const needVault = await ensureAtaIx(connection, bettor, vaultAuthority, MINT);

      const data = coder!.instruction.encode(claimMeta.name, {});
      const keys = buildKeysFromIdl(
        claimMeta,
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
            position,
          })
      );

      const programIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

      const ixs: TransactionInstruction[] = [
        memoIx('Claim', bettor),
        ...(needBettor.ix ? [needBettor.ix] : []),
        ...(needOwner.ix ? [needOwner.ix] : []),
        ...(needVault.ix ? [needVault.ix] : []),
        programIx,
      ];

      const sig = await sendOne(ixs, bettor);
      
      // Mark as claimed on success
      setHasClaimed(true);
      
      push({
        variant: 'success',
        title: '💰 Winnings Claimed!',
        message: 'Your winnings have been claimed successfully',
        href: explorerTxUrl(connection.rpcEndpoint, sig),
      });
    } catch (e: any) {
      await showAnchorError('Claim', e);
    } finally {
      setIsClaiming(false);
    }
  }, [wallet, idl, coder, claimMeta, connection, marketPk, push, pickPositionPda, showAnchorError, hasClaimed]);

  /* FIXED: SIMPLIFIED claim button logic */
  const canShowClaim = useMemo(() => {
    return (
      wallet.connected && 
      status === 'Resolved' && 
      claimMeta && 
      userPos.exists && 
      !hasClaimed
    );
  }, [wallet.connected, status, claimMeta, userPos.exists, hasClaimed]);

  /* Activity */
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loadingAct, setLoadingAct] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchActivity = useCallback(async () => {
    setLoadingAct(true);
    try {
      const url = `/api/activity?market=${marketStr}&limit=8`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setActivity(j.rows || []);
      }
    } catch (e) {
      console.error('Failed to fetch activity:', e);
    } finally {
      setLoadingAct(false);
    }
  }, [marketStr]);

  useEffect(() => {
    if (expanded) {
      fetchActivity();
    }
  }, [expanded, fetchActivity]);

  function timeAgo(ts: number | null): string {
    if (!ts) return '';
    const delta = Math.max(0, nowSec - ts);
    const mins = Math.floor(delta / 60);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  if (err) {
    return (
      <div className="desktop mx-auto max-w-7xl p-4 md:p-6 min-h-screen">
        <div className="frame">
          <div className="titlebar">
            <div className="title">Error</div>
          </div>
          <div className="frame-body">
            <p>Failed to load: {err}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!idl || !coder) {
    return (
      <div className="desktop mx-auto max-w-7xl p-4 md:p-6 min-h-screen">
        <div className="frame">
          <div className="titlebar">
            <div className="title">Loading…</div>
          </div>
          <div className="frame-body">
            <div className="flex items-center justify-center gap-2 py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
              <span className="text-gray-600">Loading market data…</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="desktop mx-auto max-w-7xl p-4 md:p-6 min-h-screen">
      {/* Rate Limit Warning */}
      {rateLimit && (
        <div className="frame mb-4 border-2 border-amber-500">
          <div className="titlebar bg-amber-500">
            <div className="title">⚠️ Rate Limit Exceeded</div>
          </div>
          <div className="frame-body bg-amber-50">
            <p className="text-amber-800">
              Too many requests. Please wait a moment and refresh the page.
            </p>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div className="frame mb-6">
        <div className="titlebar">
          <div className="title">📊 {uiTitle}</div>
          <div className="controls">
            <button aria-label="Minimize" className="btn95 px-2">_</button>
            <button aria-label="Maximize" className="btn95 px-2">□</button>
            <button aria-label="Close" className="btn95 px-2">×</button>
          </div>
        </div>
        
        <div className="frame-body p-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-xl font-bold text-black mb-2">{uiTitle}</h1>
              <div className="flex flex-wrap gap-2 items-center">
                <CopyChip value={marketStr} />
                <MintBadge mint={MINT} symbol={MINT_SYMBOL} decimals={DECIMALS} />
                <div className={`status-pill95 ${
                  status === 'Open' ? '!bg-emerald-100 !text-emerald-800' :
                  status === 'Locked' ? '!bg-amber-100 !text-amber-800' :
                  '!bg-blue-100 !text-blue-800'
                }`}>
                  {status}
                  {status === 'Resolved' && strict?.winner && ` - ${strict.winner.toUpperCase()} WON`}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-black">{poolUi} {MINT_SYMBOL}</div>
              <div className="text-sm text-gray-600">Total Pool</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Odds & Betting */}
        <div className="lg:col-span-2 space-y-6">
          <OddsBar
            yesPct={odds?.yes ?? 0}
            noPct={odds?.no ?? 0}
            yesMult={roughMult?.yesMult ?? null}
            noMult={roughMult?.noMult ?? null}
            showMultipliers={status !== 'Open'}
            isEmpty={!!isEmptyMarket}
          />

          {/* Enhanced Stats Grid */}
          <div className="frame">
            <div className="titlebar">
              <div className="title">📈 Market Statistics</div>
            </div>
            <div className="frame-body">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-white border-2 border-gray-400">
                  <div className="text-2xl font-bold text-black font-mono">{digitalCountdown}</div>
                  <div className="text-xs text-gray-600 mt-1">TIME LEFT</div>
                </div>
                <div className="text-center p-3 bg-white border-2 border-gray-400">
                  <div className="text-2xl font-bold text-black">{poolUi}</div>
                  <div className="text-xs text-gray-600 mt-1">TOTAL POOL</div>
                </div>
                <div className="text-center p-3 bg-white border-2 border-gray-400">
                  <div className="text-2xl font-bold text-emerald-600">
                    {strict?.yesAtoms !== undefined ? trimUi6(atomsToUi6(strict.yesAtoms)) : '0'}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">YES POOL</div>
                </div>
                <div className="text-center p-3 bg-white border-2 border-gray-400">
                  <div className="text-2xl font-bold text-rose-600">
                    {strict?.noAtoms !== undefined ? trimUi6(atomsToUi6(strict.noAtoms)) : '0'}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">NO POOL</div>
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced Betting Interface */}
          <ConnectGate bannerText="Connect your wallet to place bets and claim winnings">
            <div className="space-y-6">
              {/* Place Bet */}
              {status !== 'Resolved' && (
                <div className="frame">
                  <div className="titlebar">
                    <div className="title">🎯 Place Your Bet</div>
                  </div>
                  <div className="frame-body space-y-4">
                    {/* Side selection */}
                    <div>
                      <label className="block text-sm font-bold text-black mb-2">Choose side:</label>
                      <div className="flex gap-2">
                        <button
                          className={`btn95 flex-1 text-lg py-3 ${
                            side === 'yes' 
                              ? '!bg-emerald-500 !text-white border-2 border-emerald-700' 
                              : 'hover:bg-emerald-50'
                          }`}
                          onClick={() => setSide('yes')}
                        >
                          ✅ YES
                        </button>
                        <button
                          className={`btn95 flex-1 text-lg py-3 ${
                            side === 'no' 
                              ? '!bg-rose-500 !text-white border-2 border-rose-700' 
                              : 'hover:bg-rose-50'
                          }`}
                          onClick={() => setSide('no')}
                        >
                          ❌ NO
                        </button>
                      </div>
                    </div>

                    {/* Amount selection */}
                    <div>
                      <label className="block text-sm font-bold text-black mb-2">Bet amount ({MINT_SYMBOL}):</label>
                      <div className="flex gap-2 mb-3 flex-wrap">
                        {['0.1', '0.5', '1', '5', '10', '50'].map((quickAmount) => (
                          <button
                            key={quickAmount}
                            className={`btn95-ghost px-3 py-1 ${
                              amount === quickAmount ? '!bg-blue-500 !text-white' : ''
                            }`}
                            onClick={() => setAmount(quickAmount)}
                          >
                            {quickAmount}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        className="input95 w-full text-lg text-center"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Enter custom amount"
                      />
                    </div>

                    {/* Potential payout */}
                    {amount && !isNaN(parseFloat(amount)) && (
                      <div className="p-3 bg-blue-50 border-2 border-blue-200 text-center">
                        <div className="text-sm text-gray-600">Potential payout:</div>
                        <div className="text-lg font-bold text-black">
                          {side === 'yes' && roughMult?.yesMult 
                            ? `${(parseFloat(amount) * roughMult.yesMult).toFixed(2)} ${MINT_SYMBOL}`
                            : side === 'no' && roughMult?.noMult
                            ? `${(parseFloat(amount) * roughMult.noMult).toFixed(2)} ${MINT_SYMBOL}`
                            : 'Enter amount'
                          }
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {side === 'yes' ? `at ${roughMult?.yesMult?.toFixed(2)}x` : `at ${roughMult?.noMult?.toFixed(2)}x`} odds
                        </div>
                      </div>
                    )}

                    <button
                      className="btn95 w-full !bg-green-500 !text-white text-lg py-3 font-bold hover:!bg-green-600 disabled:!bg-gray-400"
                      onClick={onPlaceBet}
                      disabled={placeDisabled}
                    >
                      {busyBet ? '🔄 Placing Bet...' : `🎲 PLACE ${side.toUpperCase()} BET`}
                    </button>
                  </div>
                </div>
              )}

              {/* Resolve */}
              {isOwner && status === 'Locked' && strict?.resolved !== true && resolveMeta && (
                <div className="frame">
                  <div className="titlebar">
                    <div className="title">🔓 Resolve Market (Owner Only)</div>
                  </div>
                  <div className="frame-body space-y-3">
                    <div className="flex gap-2">
                      <button
                        className={`btn95 flex-1 ${resolveChoice === 'yes' ? '!bg-teal-100' : ''}`}
                        onClick={() => setResolveChoice('yes')}
                      >
                        RESOLVE YES
                      </button>
                      <button
                        className={`btn95 flex-1 ${resolveChoice === 'no' ? '!bg-rose-100' : ''}`}
                        onClick={() => setResolveChoice('no')}
                      >
                        RESOLVE NO
                      </button>
                    </div>
                    <button
                      className="btn95 w-full !bg-yellow-300"
                      onClick={onResolve}
                      disabled={busyResolve}
                    >
                      {busyResolve ? 'Resolving…' : 'CONFIRM RESOLUTION'}
                    </button>
                  </div>
                </div>
              )}

              {/* FIXED: Claim Section - Shows when basic conditions are met */}
              {canShowClaim && (
                <div className="frame">
                  <div className="titlebar">
                    <div className="title">💰 Claim Winnings</div>
                  </div>
                  <div className="frame-body">
                    <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded">
                      <div className="font-bold text-green-800">🎉 Claim Available!</div>
                      <div className="text-sm text-green-600">
                        You have a position in this resolved market. Click claim to check for winnings.
                        {userPos.side && strict?.winner && (
                          <div className="mt-1">
                            Your position: <strong>{userPos.side.toUpperCase()}</strong> | 
                            Winner: <strong>{strict.winner.toUpperCase()}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn95 w-full !bg-green-500 !text-white text-lg py-3 font-bold hover:!bg-green-600 disabled:!bg-gray-400"
                      onClick={onClaim}
                      disabled={isClaiming}
                    >
                      {isClaiming ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Claiming...
                        </div>
                      ) : (
                        '💰 CLAIM WINNINGS'
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Claim Success Message */}
              {hasClaimed && (
                <div className="frame">
                  <div className="titlebar">
                    <div className="title">✅ Claim Complete</div>
                  </div>
                  <div className="frame-body">
                    <div className="p-4 bg-green-50 border border-green-200 rounded text-center">
                      <div className="text-2xl mb-2">🎉</div>
                      <div className="font-bold text-green-800 text-lg">Winnings Claimed!</div>
                      <div className="text-sm text-green-600 mt-1">
                        Your winnings have been successfully transferred to your wallet.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ConnectGate>
        </div>

        {/* Right Column - User Info & Activity */}
        <div className="space-y-6">
          {/* Enhanced User Position Display */}
          {wallet.connected && userPos.exists && (
            <div className="frame">
              <div className="titlebar">
                <div className="title">👤 Your Position</div>
              </div>
              <div className="frame-body">
                <div className={`p-4 border-2 ${
                  userPos.side === 'yes' ? 'border-emerald-200 bg-emerald-50' : 
                  userPos.side === 'no' ? 'border-rose-200 bg-rose-50' :
                  'border-gray-200 bg-gray-50'
                } rounded`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${
                        userPos.side === 'yes' ? 'bg-emerald-500' : 
                        userPos.side === 'no' ? 'bg-rose-500' :
                        'bg-gray-400'
                      }`} />
                      <div>
                        <div className="font-bold text-black text-lg">
                          {userPos.side ? `${userPos.side.toUpperCase()} Position` : 'Unknown Position'}
                        </div>
                        <div className="text-sm text-gray-600">
                          Stake: {trimUi6(atomsToUi6(userPos.stake))} {MINT_SYMBOL}
                        </div>
                      </div>
                    </div>
                    {status === 'Resolved' && userPos.side && (
                      <div className={`px-3 py-1 rounded-full text-sm font-bold ${
                        strict?.winner && userPos.side.toLowerCase() === strict.winner.toLowerCase()
                          ? 'bg-green-500 text-white' 
                          : 'bg-gray-400 text-gray-700'
                      }`}>
                        {strict?.winner && userPos.side.toLowerCase() === strict.winner.toLowerCase() 
                          ? '🎉 Winner!' 
                          : '💸 Lost'
                        }
                      </div>
                    )}
                  </div>
                  {hasClaimed && (
                    <div className="mt-2 p-2 bg-green-100 border border-green-300 rounded text-center">
                      <div className="text-green-700 text-sm font-semibold">✅ Claimed</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Enhanced Activity Feed */}
          <div className="frame">
            <div className="titlebar">
              <div className="title">📋 Recent Activity</div>
              <div className="flex items-center gap-2">
                <button 
                  className="btn95-ghost text-xs"
                  onClick={fetchActivity}
                  disabled={loadingAct}
                >
                  {loadingAct ? '🔄' : '↻'}
                </button>
              </div>
            </div>
            <div className="frame-body">
              {loadingAct ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
                  <span className="text-sm text-gray-600">Loading activity...</span>
                </div>
              ) : activity.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">📊</div>
                  <div>No activity yet</div>
                  <div className="text-sm mt-1">Be the first to place a bet!</div>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {activity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white border border-gray-300">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          a.type === 'place' ? 'bg-blue-500' :
                          a.type === 'resolve' ? 'bg-purple-500' : 'bg-green-500'
                        }`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs bg-gray-100 px-1 rounded">
                              {a.wallet.slice(0, 4)}...{a.wallet.slice(-4)}
                            </span>
                            <span className="text-sm text-black">
                              {a.type === 'place' && `Bet ${a.side} ${a.amount || ''}`}
                              {a.type === 'resolve' && `Resolved ${a.outcome}`}
                              {a.type === 'claim' && 'Claimed winnings'}
                            </span>
                          </div>
                          {a.ts && (
                            <div className="text-xs text-gray-500 mt-1">
                              {timeAgo(a.ts)}
                            </div>
                          )}
                        </div>
                      </div>
                      <a
                        href={explorerTxUrl(connection.rpcEndpoint, a.sig)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn95-ghost text-xs"
                        title="View on explorer"
                      >
                        🔍
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Errors */}
          {decodeError && (
            <div className="frame">
              <div className="titlebar">
                <div className="title">⚠️ Error</div>
              </div>
              <div className="frame-body">
                <p className="text-red-600 text-sm">{decodeError}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

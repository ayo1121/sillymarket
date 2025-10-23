// src/app/create/page.tsx
'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  Keypair,
  SendTransactionError,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { getConnection } from '@/lib/actions/connection';

// ⬇️ centralized constants + small UI helpers
import { PROGRAM_ID, MINT, OWNER, MINT_SYMBOL, DECIMALS } from '@/lib/constants';
import { MintBadge } from '@/components/ui/MintBadge';
import { ConnectGate } from '@/components/ui/ConnectGate';

/* ───────────────────────── helpers (binary + memo + url) ───────────────────────── */
const te = new TextEncoder();

function u64le(n: bigint) {
  const b = new ArrayBuffer(8);
  const dv = new DataView(b);
  dv.setBigUint64(0, n, true);
  return new Uint8Array(b);
}
function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
/** Anchor discriminator: sha256("global:<name>")[0..8) */
async function anchorDiscriminator(name: string) {
  const msg = te.encode(`global:${name}`);
  const hash = await crypto.subtle.digest('SHA-256', msg);
  return new Uint8Array(hash).slice(0, 8);
}
function explorerTxUrl(endpoint: string, sig: string) {
  // NOTE: we never render the RPC endpoint itself in the UI
  const lower = endpoint?.toLowerCase?.() ?? '';
  const cluster =
    lower.includes('devnet') ? 'devnet' : lower.includes('testnet') ? 'testnet' : 'mainnet';
  return cluster === 'mainnet'
    ? `https://solscan.io/tx/${sig}`
    : `https://solscan.io/tx/${sig}?cluster=${cluster}`;
}
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: new TextEncoder().encode(text),
  });
}

/* Scrub any chance of the RPC URL or API keys appearing in surfaced errors */
function sanitize(msg: string): string {
  return (msg || '')
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/api[-_ ]?key=[A-Za-z0-9-_]+/gi, 'api-key=[redacted]');
}

/* ───────────────────────── name cache (for UI) ───────────────────────── */
const LS_KEY = 'ynb-market-names';
function saveMarketName(addr: string, title: string) {
  try {
    const t = title.trim().slice(0, 120);
    if (!t) return;
    const m = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    m[addr] = t;
    localStorage.setItem(LS_KEY, JSON.stringify(m));
    window.dispatchEvent(
      new CustomEvent('ynb-market-name-set', { detail: { market: addr, title: t } })
    );
  } catch {}
}

/* ───────────────────────── Component ───────────────────────── */
export default function CreateMarketPage() {
  const connection = getConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const router = useRouter();
  const { push } = useToast();

  const [name, setName] = useState('New Market');
  const [cutoffMins, setCutoffMins] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // owner check comes from centralized OWNER PublicKey
  const isOwner = useMemo(() => {
    return publicKey ? publicKey.equals(OWNER) : false;
  }, [publicKey]);

  const onCreate = useCallback(async () => {
    if (busy) return;

    setError(null);
    setShareUrl(null);

    if (!connected || !publicKey) {
      setError('Connect your owner wallet first.');
      return;
    }
    if (!isOwner) {
      setError('Only the owner wallet can create markets.');
      return;
    }
    const mins = Number(cutoffMins);
    if (!Number.isFinite(mins) || mins <= 0) {
      setError('Cutoff minutes must be > 0');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a market name.');
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const cutoffTs = BigInt(now + Math.floor(mins * 60));

    // Program-owned market account
    const marketKp = Keypair.generate();

    // PDAs your program expects
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('vault-auth'), marketKp.publicKey.toBuffer()],
      PROGRAM_ID
    );
    // Program expects the ATA (vault) for the vaultAuthority PDA
    const vaultAta = getAssociatedTokenAddressSync(MINT, vaultAuthority, true);

    try {
      setBusy(true);

      // Anchor global ix data
      const disc = await anchorDiscriminator('create_market');
      const data = concatBytes(disc, u64le(cutoffTs));

      // Account order MUST match program definition (IDL)
      const keys = [
        { pubkey: publicKey, isSigner: true, isWritable: true }, // owner (payer)
        { pubkey: marketKp.publicKey, isSigner: true, isWritable: true }, // market (init)
        { pubkey: MINT, isSigner: false, isWritable: false }, // bet_mint
        { pubkey: vaultAuthority, isSigner: false, isWritable: false }, // vault_authority (PDA)
        { pubkey: vaultAta, isSigner: false, isWritable: true }, // vault (ATA)
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ];

      const ixProgram = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      const tx = new Transaction();
      tx.feePayer = publicKey;
      tx.recentBlockhash = blockhash;
      tx.add(memoIx(`CreateMarket:${trimmedName.slice(0, 40)}`, publicKey));
      tx.add(ixProgram);
      tx.partialSign(marketKp);

      if (!wallet.signTransaction)
        throw new Error('Wallet does not support transaction signing.');
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      push({
        variant: 'default',
        title: 'Submitted',
        message: 'Your transaction has been submitted.',
        href: explorerTxUrl((connection as any).rpcEndpoint, sig),
      });

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      const marketAddr = marketKp.publicKey.toBase58();
      saveMarketName(marketAddr, trimmedName);
      const url = `${window.location.origin}/market/${marketAddr}?title=${encodeURIComponent(
        trimmedName
      )}`;
      setShareUrl(url);

      push({
        variant: 'success',
        title: 'Market created',
        message: sig.slice(0, 8) + '…',
        href: explorerTxUrl((connection as any).rpcEndpoint, sig),
      });

      router.push(`/market/${marketAddr}?title=${encodeURIComponent(trimmedName)}`);
    } catch (e: any) {
      let msg = e?.message || String(e);
      try {
        if (e && typeof e === 'object' && 'getLogs' in e && typeof e.getLogs === 'function') {
          const logs = await (e as SendTransactionError).getLogs(getConnection());
          if (logs?.length) msg += `\n\nLogs:\n${logs.join('\n')}`;
        }
      } catch {}
      msg = sanitize(msg);
      setError(msg);
      push({ variant: 'error', title: 'Create failed', message: msg.slice(0, 400) });
    } finally {
      setBusy(false);
    }
  }, [busy, connected, publicKey, isOwner, cutoffMins, name, connection, wallet, router, push]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">
        Create Market <span className="text-sm opacity-60">(owner only)</span>
      </h1>

      <div className="rounded-lg border border-stroke bg-surface p-5 space-y-4">
        {/* Header info with MintBadge */}
        <div className="text-sm opacity-75 space-y-1">
          <div>
            Program: <span className="font-mono">{PROGRAM_ID.toBase58()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Mint:</span>
            <MintBadge mint={MINT} symbol={MINT_SYMBOL} decimals={DECIMALS} />
          </div>
          {/* Intentionally do NOT render the RPC endpoint to avoid leaking keys/URLs */}
          <div>
            Connection: <span className="font-mono">OK</span> ✅
          </div>
        </div>

        {/* Gate the form when wallet isn't connected */}
        <ConnectGate bannerText="Connect the owner wallet to create markets.">
          {!connected ? (
            <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 p-3">
              Connect your wallet to continue.
            </div>
          ) : !isOwner ? (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 text-red-200 p-3">
              Only the owner wallet can create markets.
            </div>
          ) : null}

          <label className="block mt-2">
            <div className="mb-1 text-sm opacity-80">Name</div>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Market title (UI only)"
              maxLength={120}
            />
          </label>

          <label className="block">
            <div className="mb-1 text-sm opacity-80">Cutoff (minutes from now)</div>
            <input
              className="input"
              value={cutoffMins}
              onChange={(e) => setCutoffMins(e.target.value)}
              inputMode="numeric"
              placeholder="10"
            />
          </label>

          <button
            onClick={onCreate}
            disabled={!connected || !isOwner || busy}
            className={`mt-2 px-4 py-2 rounded-md text-white ${
              !connected || !isOwner || busy
                ? 'bg-purple-800/50 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {busy ? 'Creating…' : 'Create Market'}
          </button>

          {error && (
            <div className="mt-3 rounded-md bg-red-600/10 border border-red-600/30 text-red-200 px-3 py-2 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {shareUrl && (
            <div className="mt-3 rounded-md bg-green-600/10 border border-green-600/30 text-green-200 px-3 py-2">
              <div className="font-medium">Shareable link</div>
              <div className="font-mono break-all text-xs mt-1">{shareUrl}</div>
            </div>
          )}
        </ConnectGate>
      </div>
    </div>
  );
}

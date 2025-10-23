// src/lib/constants.ts

import { PublicKey } from '@solana/web3.js';

/** Build-time captured env map (static keys so Next can inline). */
const ENV = {
  NEXT_PUBLIC_CLUSTER: process.env.NEXT_PUBLIC_CLUSTER,                 // 'devnet' | 'testnet' | 'mainnet' (optional)
  NEXT_PUBLIC_PROGRAM_ID: process.env.NEXT_PUBLIC_PROGRAM_ID,
  NEXT_PUBLIC_MINT: process.env.NEXT_PUBLIC_MINT,
  NEXT_PUBLIC_MINT_SYMBOL: process.env.NEXT_PUBLIC_MINT_SYMBOL,         // optional
  NEXT_PUBLIC_OWNER: process.env.NEXT_PUBLIC_OWNER,
  NEXT_PUBLIC_DECIMALS: process.env.NEXT_PUBLIC_DECIMALS,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,         // optional
  NEXT_PUBLIC_POSITION_SEED: process.env.NEXT_PUBLIC_POSITION_SEED,     // optional
  NEXT_PUBLIC_VAULT_AUTH_SEED: process.env.NEXT_PUBLIC_VAULT_AUTH_SEED, // optional
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,                 // optional (fallback to default)
} as const;

/** Validate required value (after inlining, in any runtime). */
function requireVal(name: keyof typeof ENV): string {
  const v = ENV[name];
  if (!v || !v.toString().trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v.toString().trim();
}

/** Soft read with default. */
function getVal<T extends keyof typeof ENV>(name: T, fallback?: string): string | undefined {
  const v = ENV[name];
  return (v ?? fallback)?.toString().trim();
}

/** Parsed + exported constants */
export const CLUSTER = (getVal('NEXT_PUBLIC_CLUSTER', 'mainnet') || 'mainnet') as
  | 'devnet' | 'testnet' | 'mainnet';

export const PROGRAM_ID_STR = requireVal('NEXT_PUBLIC_PROGRAM_ID');
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

export const MINT_STR = requireVal('NEXT_PUBLIC_MINT');
export const MINT = new PublicKey(MINT_STR);

export const MINT_SYMBOL = getVal('NEXT_PUBLIC_MINT_SYMBOL') || 'TOKEN';

export const OWNER_STR = requireVal('NEXT_PUBLIC_OWNER');
export const OWNER = new PublicKey(OWNER_STR);

export const DECIMALS = Number(requireVal('NEXT_PUBLIC_DECIMALS'));

export const SITE_ORIGIN = getVal('NEXT_PUBLIC_SITE_ORIGIN') || '';
export const POSITION_SEED = getVal('NEXT_PUBLIC_POSITION_SEED') || 'position';
export const VAULT_AUTH_SEED = getVal('NEXT_PUBLIC_VAULT_AUTH_SEED') || 'vault-auth';
export const RPC_URL = getVal('NEXT_PUBLIC_RPC_URL'); // optional

/** Helper: explorer URL */
export function explorerTxUrl(sig: string): string {
  const cluster = CLUSTER === 'mainnet' ? '' : `?cluster=${CLUSTER}`;
  return `https://solscan.io/tx/${sig}${cluster}`;
}

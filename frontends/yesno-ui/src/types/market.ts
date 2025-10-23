// src/types/market.ts
export type Outcome = 'yes' | 'no';

export interface Market {
  pubkey: string;            // base58 address
  title?: string;
  yesAtoms?: bigint;
  noAtoms?: bigint;
  cutoff?: number;           // unix seconds
  resolved?: boolean;
  winner?: Outcome | null;
  mint?: string;             // base58
}

export interface Position {
  pubkey: string;            // base58
  market: string;            // base58
  bettor: string;            // base58
  side?: Outcome | null;
  amount?: bigint;
  canClaim?: boolean;
  marketName?: string | null;
}

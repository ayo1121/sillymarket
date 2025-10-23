// src/lib/program/builders.ts
// Full edited version — resolves IDL names like `sysvar_rent_pubkey` reliably.

import type { Connection, PublicKey, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import {
  SystemProgram,
  ComputeBudgetProgram,
  PublicKey as PK,
  TransactionInstruction as TxIx,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import { BorshCoder, type Idl, utils as anchorUtils } from "@coral-xyz/anchor";
import programIdl from "@/idl/yesno_bets.json";

/** ------------------------------------------------------------------------
 *  CONSTANTS / ENV
 *  --------------------------------------------------------------------- */

const PROGRAM_ID = new PK(process.env.NEXT_PUBLIC_PROGRAM_ID!);
const BET_MINT = safePk(process.env.NEXT_PUBLIC_MINT, "NEXT_PUBLIC_MINT (BET_MINT)");
const OWNER = safePk(process.env.NEXT_PUBLIC_OWNER, "NEXT_PUBLIC_OWNER", true);

// ✅ Hardcode Rent sysvar to avoid any import/casing issues
const RENT_SYSVAR = new PK("SysvarRent111111111111111111111111111111111");

const VAULT_AUTH_SEED = (process.env.NEXT_PUBLIC_VAULT_AUTH_SEED || "vault_authority").trim();
const POSITION_SEED = (process.env.NEXT_PUBLIC_POSITION_SEED || "position").trim();

/**
 * Aliases for IDL account names. The **key must match what appears in your IDL**.
 * Values are acceptable synonyms you may provide in the `accounts` object.
 * We include many variants for Rent/sysvar to cover all cases.
 */
const NAME_ALIASES: Record<string, string[]> = {
  // Common program/sysvar IDs
  "systemProgram": ["systemProgram", "system", "sys", "system_program"],
  "rent": ["rent", "sysvarRent", "sysvar_rent", "sysvar_rent_pubkey", "sysvarRentPubkey", "sysvarRentPubKey"],
  "tokenProgram": ["tokenProgram", "tokenProgramId", "splToken", "spl"],
  "associatedTokenProgram": ["associatedTokenProgram", "associatedToken", "ataProgram"],

  // Frequently used logical accounts
  "payer": ["payer", "authority", "user", "signer"],
  "resolver": ["resolver", "authority", "owner"],
  "authority": ["authority", "owner", "admin"],
  "claimer": ["claimer", "payer", "user"],
  "market": ["market", "marketAccount"],
  "vault": ["vault", "feeVault", "treasury", "vaultAccount"],
  "vaultAuthority": ["vaultAuthority", "treasuryAuthority", "feeAuthority"],
  "position": ["position", "userPosition", "betPosition"],
  "mint": ["mint", "betMint", "tokenMint"],
  "payerToken": ["payerToken", "userAta", "userToken"],
  "vaultToken": ["vaultToken", "vaultAta", "treasuryAta"],

  // ✅ Explicitly cover the exact IDL key you're seeing:
  "sysvar_rent_pubkey": ["rent", "sysvarRent", "sysvar_rent_pubkey", "sysvarRentPubkey", "sysvarRentPubKey"],
};

/** ------------------------------------------------------------------------
 *  IDL helpers
 *  --------------------------------------------------------------------- */

type IxAccountDef = { name: string; isMut: boolean; isSigner: boolean; pda?: any };
type IdlIx = { name: string; accounts: IxAccountDef[]; args: any[] };

function getIdl(): Idl {
  return programIdl as unknown as Idl;
}
function getCoder(): BorshCoder {
  return new BorshCoder(getIdl());
}
function findIdlIx(ixName: string): IdlIx {
  const idl = getIdl();
  const found = (idl.instructions as any[]).find(
    (ix) => ix.name?.toLowerCase?.() === ixName.toLowerCase()
  );
  if (!found) {
    const list = (idl.instructions as any[]).map((ix) => ix.name).join(", ");
    throw new Error(`[IDL] Instruction "${ixName}" not found. Available: ${list}`);
  }
  return found as IdlIx;
}
function safePk(v: string | undefined, field: string, optional = false): PK {
  const s = (v || "").trim();
  if (!s) {
    if (optional) return PK.default;
    throw new Error(`[env] Missing ${field} in your environment`);
  }
  try { return new PK(s); } catch { throw new Error(`[env] ${field} is not a valid public key: ${s}`); }
}

/** ------------------------------------------------------------------------
 *  Account resolution guardrails
 *  --------------------------------------------------------------------- */

type MaybePk = PublicKey | undefined;
type AccountDict = Record<string, PublicKey>;

function toCamel(s: string) { return s.replace(/[-_](\w)/g, (_, c) => c.toUpperCase()); }
function toSnake(s: string) { return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`); }

function resolveByAlias(provided: Partial<AccountDict>, idlName: string): MaybePk {
  if (provided[idlName]) return provided[idlName];
  const aliases = NAME_ALIASES[idlName] || [];
  for (const alt of aliases) if (provided[alt]) return provided[alt];
  const variants = [idlName, toCamel(idlName), toSnake(idlName)];
  for (const v of variants) if (provided[v]) return provided[v];
  return undefined;
}

function mustGet(provided: Partial<AccountDict>, idlName: string, scope: string): PublicKey {
  const got = resolveByAlias(provided, idlName);
  if (!got) {
    const hints = [idlName, ...(NAME_ALIASES[idlName] || []), toCamel(idlName), toSnake(idlName)].filter(Boolean);
    throw new Error(
      `[IDL mapping] Missing account "${idlName}" while building ${scope}. ` +
      `Try providing one of: ${hints.join(", ")}`
    );
  }
  return got;
}

function toMetas(idlIx: IdlIx, provided: Partial<AccountDict>, scope: string): AccountMeta[] {
  return idlIx.accounts.map((acc) => ({
    pubkey: mustGet(provided, acc.name, scope),
    isSigner: acc.isSigner,
    isWritable: acc.isMut,
  }));
}

/** ------------------------------------------------------------------------
 *  PDAs / ATAs
 *  --------------------------------------------------------------------- */

const textEnc = new TextEncoder();
function findVaultAuthorityPda(): [PK, number] {
  return PK.findProgramAddressSync([textEnc.encode(VAULT_AUTH_SEED)], PROGRAM_ID);
}
function findPositionPda(bettor: PublicKey, market: PublicKey): [PK, number] {
  return PK.findProgramAddressSync([textEnc.encode(POSITION_SEED), market.toBuffer(), bettor.toBuffer()], PROGRAM_ID);
}
function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

/** ------------------------------------------------------------------------
 *  Generic IDL-backed instruction builder
 *  --------------------------------------------------------------------- */
async function buildIx(
  ixName: string,
  args: Record<string, any>,
  accountsProvided: Partial<AccountDict>,
  remaining: AccountMeta[] = []
): Promise<TransactionInstruction> {
  const coder = getCoder();
  const idlIx = findIdlIx(ixName);

  let data: Buffer;
  try {
    data = coder.instruction.encode(ixName, args);
  } catch (e: any) {
    const dbg = JSON.stringify(args);
    throw new Error(`[IDL args] Failed to encode args for "${ixName}": ${e?.message}\nargs=${dbg}`);
  }

  const metas = toMetas(idlIx, accountsProvided, `instruction "${ixName}"`);
  const keys: AccountMeta[] = [...metas, ...remaining];

  return new TxIx({
    programId: PROGRAM_ID,
    keys,
    data,
  });
}

/** ------------------------------------------------------------------------
 *  Public builders
 *  --------------------------------------------------------------------- */

// Place bet
export async function buildPlaceBetIx(
  _connection: Connection,
  params: {
    payer: PublicKey;
    market: PublicKey;
    side: "yes" | "no";
    amountBaseUnits: string;
    overrides?: Partial<AccountDict>;
    priorityFeeMicroLamports?: number;
  }
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  if (params.priorityFeeMicroLamports && params.priorityFeeMicroLamports > 0) {
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(params.priorityFeeMicroLamports) }));
  }

  const payer = params.payer;
  const market = params.market;
  const [position] = findPositionPda(payer, market);
  const [vaultAuthority] = findVaultAuthorityPda();

  const payerToken = ata(payer, BET_MINT);
  const vaultToken = ata(vaultAuthority, BET_MINT);

  // Ensure ATAs exist (idempotent)
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, payerToken, payer, BET_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, vaultToken, vaultAuthority, BET_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));

  // ✅ Provide synonyms directly so any IDL spelling resolves
  const base: Partial<AccountDict> = {
    systemProgram: SystemProgram.programId,
    rent: RENT_SYSVAR,
    sysvarRent: RENT_SYSVAR,
    sysvar_rent: RENT_SYSVAR,
    sysvar_rent_pubkey: RENT_SYSVAR,
    sysvarRentPubkey: RENT_SYSVAR,
    sysvarRentPubKey: RENT_SYSVAR,

    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,

    payer,
    market,
    position,
    vaultAuthority,
    mint: BET_MINT,
    payerToken,
    vaultToken,
  };

  const accounts: Partial<AccountDict> = {
    ...base,
    ...(params.overrides || {}),
  };

  const ix = await buildIx(
    "placeBet",
    { side: params.side, amount: new anchorUtils.BN(params.amountBaseUnits) },
    accounts
  );

  ixs.push(ix);
  return ixs;
}

// Resolve market
export async function buildResolveMarketIx(
  _connection: Connection,
  params: {
    resolver: PublicKey;
    market: PublicKey;
    outcome: "yes" | "no";
    overrides?: Partial<AccountDict>;
    priorityFeeMicroLamports?: number;
  }
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  if (params.priorityFeeMicroLamports && params.priorityFeeMicroLamports > 0) {
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(params.priorityFeeMicroLamports) }));
  }

  const resolver = params.resolver;
  const market = params.market;
  const [vaultAuthority] = findVaultAuthorityPda();
  const vaultToken = ata(vaultAuthority, BET_MINT);

  const base: Partial<AccountDict> = {
    systemProgram: SystemProgram.programId,
    rent: RENT_SYSVAR,
    sysvarRent: RENT_SYSVAR,
    sysvar_rent: RENT_SYSVAR,
    sysvar_rent_pubkey: RENT_SYSVAR,
    sysvarRentPubkey: RENT_SYSVAR,
    sysvarRentPubKey: RENT_SYSVAR,

    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,

    resolver,
    market,
    vaultAuthority,
    mint: BET_MINT,
    vaultToken,
  };

  const accounts: Partial<AccountDict> = { ...base, ...(params.overrides || {}) };

  const ix = await buildIx("resolveMarket", { outcome: params.outcome }, accounts);
  ixs.push(ix);
  return ixs;
}

// Claim winnings
export async function buildClaimWinningsIx(
  _connection: Connection,
  params: {
    claimer: PublicKey;
    market: PublicKey;
    overrides?: Partial<AccountDict>;
    priorityFeeMicroLamports?: number;
  }
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  if (params.priorityFeeMicroLamports && params.priorityFeeMicroLamports > 0) {
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(params.priorityFeeMicroLamports) }));
  }

  const claimer = params.claimer;
  const market = params.market;
  const [position] = findPositionPda(claimer, market);
  const [vaultAuthority] = findVaultAuthorityPda();

  const claimerToken = ata(claimer, BET_MINT);
  const vaultToken = ata(vaultAuthority, BET_MINT);

  // Ensure claimer ATA exists (idempotent)
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(claimer, claimerToken, claimer, BET_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));

  const base: Partial<AccountDict> = {
    systemProgram: SystemProgram.programId,
    rent: RENT_SYSVAR,
    sysvarRent: RENT_SYSVAR,
    sysvar_rent: RENT_SYSVAR,
    sysvar_rent_pubkey: RENT_SYSVAR,
    sysvarRentPubkey: RENT_SYSVAR,
    sysvarRentPubKey: RENT_SYSVAR,

    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,

    claimer,
    market,
    position,
    vaultAuthority,
    mint: BET_MINT,
    claimerToken,
    vaultToken,
  };

  const accounts: Partial<AccountDict> = { ...base, ...(params.overrides || {}) };

  const ix = await buildIx("claimWinnings", {}, accounts);
  ixs.push(ix);
  return ixs;
}

// Sweep fees
export async function buildSweepFeesIx(
  _connection: Connection,
  params: {
    authority: PublicKey;
    market?: PublicKey;
    overrides?: Partial<AccountDict>;
    priorityFeeMicroLamports?: number;
  }
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  if (params.priorityFeeMicroLamports && params.priorityFeeMicroLamports > 0) {
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(params.priorityFeeMicroLamports) }));
  }

  const authority = params.authority;
  const [vaultAuthority] = findVaultAuthorityPda();
  const vaultToken = ata(vaultAuthority, BET_MINT);
  const authorityToken = ata(authority, BET_MINT);

  // Ensure receiver ATA exists
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(authority, authorityToken, authority, BET_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));

  const base: Partial<AccountDict> = {
    systemProgram: SystemProgram.programId,
    rent: RENT_SYSVAR,
    sysvarRent: RENT_SYSVAR,
    sysvar_rent: RENT_SYSVAR,
    sysvar_rent_pubkey: RENT_SYSVAR,
    sysvarRentPubkey: RENT_SYSVAR,
    sysvarRentPubKey: RENT_SYSVAR,

    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,

    authority,
    vaultAuthority,
    mint: BET_MINT,
    vaultToken,
    payerToken: authorityToken,

    ...(params.market ? { market: params.market } : {}),
  };

  const accounts: Partial<AccountDict> = { ...base, ...(params.overrides || {}) };

  const ix = await buildIx("sweepFees", {}, accounts);
  ixs.push(ix);
  return ixs;
}

/** ------------------------------------------------------------------------
 *  EOF helpers/notes
 *  --------------------------------------------------------------------- */
// If your IDL instruction names differ (e.g., "place_bet"), update the strings
// passed to buildIx(...) above or tell me and I'll align them 1:1.


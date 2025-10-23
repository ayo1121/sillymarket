// src/lib/anchorDebug.ts
import { BN, Program, AnchorError, utils as anchorUtils } from "@coral-xyz/anchor";
import {
  PublicKey, Connection, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

type IdlLike = { errors?: Array<{ code: number; msg: string; name: string }> };

export function u64le(n: bigint) {
  // portable LE encoder (no writeBigUInt64LE dependency)
  const buf = new Uint8Array(8);
  let x = n;
  for (let i = 0; i < 8; i++) { buf[i] = Number(x & 0xffn); x >>= 8n; }
  return Buffer.from(buf);
}

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
export const MINT = new PublicKey(process.env.NEXT_PUBLIC_MINT!);
export const OWNER = new PublicKey(process.env.NEXT_PUBLIC_OWNER!);

export function deriveVaultAuthority(marketPk: PublicKey) {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-auth"), marketPk.toBuffer()],
    PROGRAM_ID
  );
  return { pda, bump };
}

export function derivePositionCandidates(bettor: PublicKey, market: PublicKey) {
  const seeds = [
    ["pos", bettor, market],
    ["pos", market, bettor],
    ["position", bettor, market],
    ["position", market, bettor],
  ] as const;

  return seeds.map(([tag, a, b]) => {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(tag), a.toBuffer(), b.toBuffer()],
      PROGRAM_ID
    );
    return { pda, bump, tag };
  });
}

export function getAta(owner: PublicKey, mint = MINT) {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function logAccounts(label: string, rec: Record<string, PublicKey | string | number | undefined>) {
  // eslint-disable-next-line no-console
  console.groupCollapsed(`🔎 ${label}`);
  Object.entries(rec).forEach(([k, v]) => console.log(`${k}:`, String(v)));
  console.groupEnd();
}

export function decodeAnchorErrorFromLogs(idl: IdlLike | undefined, logs: string[]) {
  // Try official AnchorError parser first
  try {
    const e = AnchorError.parse(logs);
    const custom = e.error.errorCode?.code; // name from IDL if present
    const code = e.error.errorCode?.number;
    const msg = e.error.errorMessage;
    return { kind: "anchor", code, custom, msg, logs };
  } catch (_) {
    // Fallback: match custom errors from IDL by code number present in logs
    if (!idl?.errors) return null;
    const numMatch = logs.join("\n").match(/custom program error: 0x([0-9a-f]+)/i);
    if (numMatch) {
      const num = parseInt(numMatch[1], 16);
      const found = idl.errors.find(e => e.code === num);
      if (found) return { kind: "custom", code: num, custom: found.name, msg: found.msg, logs };
      return { kind: "custom", code: num, custom: undefined, msg: undefined, logs };
    }
    return null;
  }
}

export function highlightLikelyRoot(logs: string[]) {
  // Map frequent Anchor constraint failures → likely bad account
  const joined = logs.join("\n");
  const hints: string[] = [];

  if (/constraint seeds/i.test(joined)) {
    hints.push("❌ ConstraintSeeds: a PDA didn’t match seeds/bump. Check vault_authority or position PDA seeds.");
  }
  if (/has_one violation.*mint/i.test(joined) || /has_one.*mint/i.test(joined)) {
    hints.push("❌ has_one(mint): Market account’s `mint` doesn’t equal the MINT env. Verify market.mint & your MINT env.");
  }
  if (/has_one.*owner/i.test(joined)) {
    hints.push("❌ has_one(owner): Market’s `owner` must equal NEXT_PUBLIC_OWNER.");
  }
  if (/owner does not match/i.test(joined)) {
    hints.push("❌ OwnerMismatch: You passed an account owned by the wrong program (often token or associated token).");
  }
  if (/account not initialized/i.test(joined)) {
    hints.push("❌ AccountNotInitialized: Missing ATA (bettor or vault or owner_fee). Ensure you create ATAs before call.");
  }
  if (/invalid account data/i.test(joined)) {
    hints.push("❌ InvalidAccountData: You passed the wrong account (e.g., bettor_ata vs vault ATA swapped).");
  }
  if (/0x1/i.test(joined) && /custom program error/i.test(joined)) {
    hints.push("ℹ️ Some programs use 0x1 for 'MathOverflow' or generic errors—recheck u64 amount & decimals.");
  }

  return hints;
}

export async function dryRunOrSend(
  connection: Connection,
  ixs: TransactionInstruction[],
  payer: PublicKey,
  computeUnits = 1_000_000 // generous for debugging
) {
  // Build v0 tx with extra CU budget
  const cuIx = anchorUtils.computeBudget.program.address
    ? anchorUtils.computeBudget.setComputeUnitLimit({ units: computeUnits })
    : null;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: cuIx ? [cuIx, ...ixs] : ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  // We don't sign here—caller should sign & send through wallet
  // But we can still simulate with replaceRecentBlockhash
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  return { tx, sim };
}

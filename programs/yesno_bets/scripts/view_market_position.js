/* eslint-disable no-console */
"use strict";

/**
 * View a market + your position + token balances.
 *
 * Env/Flags:
 *   --prog / PROG_ID          : program id (required)
 *   --market / MARKET         : market pubkey (required)
 *   --mint / MINT             : bet SPL mint (required)
 *   --bettor / BETTOR         : bettor pubkey (defaults to ANCHOR_WALLET pubkey)
 *   --decimals / DECIMALS     : mint decimals; auto-fetch if not provided
 *   ANCHOR_PROVIDER_URL / RPC_URL : RPC (default devnet)
 *   ANCHOR_WALLET             : path to keypair (used only to infer bettor if --bettor not set)
 */

const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const anchor = require("@coral-xyz/anchor");

// ---------- helpers ----------
const expandTilde = (p) =>
  p && p.startsWith("~") ? path.join(process.env.HOME, p.slice(1)) : p;

function loadKeypairMaybe(jsonPath) {
  try {
    const raw = fs.readFileSync(expandTilde(jsonPath), "utf8");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

function readIDL() {
  const idlPath = path.join(__dirname, "..", "target", "idl", "yesno_bets.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}

function findAccountName(idl, needle) {
  const n = String(needle).toLowerCase();
  const hit = (idl.accounts || []).find((a) => a.name.toLowerCase() === n);
  if (hit) return hit.name;
  // fallback: contains “market” / “position”
  const byContains = (idl.accounts || []).find((a) => a.name.toLowerCase().includes(n));
  if (byContains) return byContains.name;
  return null;
}

function fmtVal(v) {
  if (!v && v !== 0) return v;
  if (typeof v === "object") {
    if (typeof v.toBase58 === "function") return v.toBase58();
    if (v._bn || (typeof v.toString === "function" && /^\d+$/.test(v.toString())))
      return v.toString();
    // Anchor enums often look like { yes: {} } or { no: {} }
    const keys = Object.keys(v);
    if (keys.length === 1 && typeof v[keys[0]] === "object")
      return keys[0];
  }
  return v;
}

function printRecord(title, obj) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  Object.entries(obj).forEach(([k, v]) => {
    console.log(`${k}: ${fmtVal(v)}`);
  });
}

async function tryDecodeAccount(connection, coder, accountName, pubkey) {
  const ai = await connection.getAccountInfo(pubkey);
  if (!ai) return null;
  try {
    return coder.decode(accountName, ai.data);
  } catch {
    return null;
  }
}

async function fetchMintDecimals(connection, mintPk) {
  try {
    const info = await connection.getParsedAccountInfo(mintPk);
    const dec = info?.value?.data?.parsed?.info?.decimals;
    if (typeof dec === "number") return dec;
  } catch {}
  return null;
}

function ui(amtBn, decimals) {
  const s = (typeof amtBn === "string") ? amtBn : amtBn?.toString?.() ?? "0";
  if (!decimals || decimals <= 0) return s;
  const pad = decimals;
  const neg = s.startsWith("-");
  const raw = neg ? s.slice(1) : s;
  const whole = raw.length > pad ? raw.slice(0, -pad) : "0";
  const frac  = raw.padStart(pad, "0").slice(-pad);
  const out = `${whole}.${frac}`.replace(/\.?0+$/, (m) => m.startsWith(".") ? "" : m);
  return neg ? `-${out}` : out;
}

// ---------- main ----------
(async () => {
  const argv = minimist(process.argv.slice(2));
  const rpc =
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.RPC_URL ||
    "https://api.devnet.solana.com";

  const programId = new PublicKey(argv.prog || process.env.PROG_ID);
  const market = new PublicKey(argv.market || process.env.MARKET);
  const mint = new PublicKey(argv.mint || process.env.MINT);

  // bettor
  let bettorPk;
  if (argv.bettor || process.env.BETTOR) {
    bettorPk = new PublicKey(argv.bettor || process.env.BETTOR);
  } else if (process.env.ANCHOR_WALLET) {
    const kp = loadKeypairMaybe(process.env.ANCHOR_WALLET);
    if (!kp) throw new Error("Could not read ANCHOR_WALLET to infer bettor");
    bettorPk = kp.publicKey;
  } else {
    throw new Error("Provide --bettor or set ANCHOR_WALLET to infer it.");
  }

  const connection = new Connection(rpc, { commitment: "confirmed" });
  const idl = readIDL();
  const coder = new anchor.BorshAccountsCoder(idl);

  // Find account names from IDL
  const marketAcctName = findAccountName(idl, "market") || "market";
  const positionAcctName = findAccountName(idl, "position") || "position";

  // --- Market decode
  const marketData = await tryDecodeAccount(connection, coder, marketAcctName, market);
  if (!marketData) {
    console.error("❌ Could not decode market account with name:", marketAcctName);
    process.exit(1);
  }

  // --- PDAs + ATAs
  const [vaultAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-auth"), market.toBuffer()],
    programId
  );
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuth, true);
  const bettorAta = getAssociatedTokenAddressSync(mint, bettorPk, false);

  // --- Position decode (try common seeds/orders)
  const candidates = [
    PublicKey.findProgramAddressSync(
      [Buffer.from("pos"), bettorPk.toBuffer(), market.toBuffer()],
      programId
    )[0],
    PublicKey.findProgramAddressSync(
      [Buffer.from("pos"), market.toBuffer(), bettorPk.toBuffer()],
      programId
    )[0],
    // alt seed label sometimes: "position"
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), bettorPk.toBuffer(), market.toBuffer()],
      programId
    )[0],
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), bettorPk.toBuffer()],
      programId
    )[0],
  ];

  let positionPk = null;
  let positionData = null;
  for (const p of candidates) {
    // try decode
    const d = await tryDecodeAccount(connection, coder, positionAcctName, p);
    if (d) {
      positionPk = p;
      positionData = d;
      break;
    }
  }

  // --- Mint decimals
  let decimals =
    argv.decimals != null
      ? Number(argv.decimals)
      : process.env.DECIMALS != null
      ? Number(process.env.DECIMALS)
      : null;
  if (decimals == null) {
    decimals = await fetchMintDecimals(connection, mint);
  }
  if (decimals == null) decimals = 0;

  // --- Token balances
  async function safeTokenBalance(ataPk) {
    try {
      const bal = await connection.getTokenAccountBalance(ataPk);
      return bal?.value?.uiAmountString ?? "0";
    } catch {
      return "0";
    }
  }
  const vaultUi = await safeTokenBalance(vaultAta);
  const bettorUi = await safeTokenBalance(bettorAta);

  // --- Pretty derived fields (best-effort)
  const cutoffSec =
    marketData.cutoff ?? marketData.betCutoff ?? marketData.cutoffTs ?? null;
  const cutoffNum =
    cutoffSec && typeof cutoffSec.toString === "function"
      ? Number(cutoffSec.toString())
      : Number(cutoffSec || 0);
  const cutoffIso = cutoffNum ? new Date(cutoffNum * 1000).toISOString() : "n/a";

  const resolvedRaw =
    marketData.resolved ??
    marketData.status ??
    marketData.outcome ??
    marketData.result ??
    null;
  const resolved = fmtVal(resolvedRaw);

  const totalYes =
    marketData.total_yes ??
    marketData.totalYes ??
    marketData.yesTotal ??
    marketData.totalYesAmount ??
    null;
  const totalNo =
    marketData.total_no ??
    marketData.totalNo ??
    marketData.noTotal ??
    marketData.totalNoAmount ??
    null;

  const marketPretty = {
    pubkey: market,
    bet_mint: marketData.bet_mint ?? marketData.mint ?? marketData.betMint,
    owner: marketData.owner,
    vault_authority: marketData.vault_authority ?? marketData.vaultAuthority,
    vault: marketData.vault,
    fee_bps: marketData.fee_bps ?? marketData.feeBps,
    cutoff_unix: cutoffNum || "n/a",
    cutoff_iso: cutoffIso,
    resolved: resolved ?? "unresolved",
    total_yes_atoms: totalYes ? totalYes.toString() : "n/a",
    total_yes_ui: totalYes ? ui(totalYes, decimals) : "n/a",
    total_no_atoms: totalNo ? totalNo.toString() : "n/a",
    total_no_ui: totalNo ? ui(totalNo, decimals) : "n/a",
  };

  const positionPretty = positionData
    ? {
        pubkey: positionPk,
        bettor: positionData.bettor ?? positionData.owner ?? bettorPk,
        market: positionData.market ?? market,
        side:
          fmtVal(positionData.side) ||
          fmtVal(positionData.outcome) ||
          fmtVal(positionData.position),
        staked_atoms:
          (positionData.staked ?? positionData.amount ?? positionData.size)?.toString?.() ??
          "n/a",
        staked_ui: ui(
          (positionData.staked ?? positionData.amount ?? positionData.size) || "0",
          decimals
        ),
        claimed: String(
          (positionData.claimed ?? positionData.paid ?? positionData.settled) || false
        ),
      }
    : { info: "No position PDA found with common seeds for this bettor/market." };

  // --- Output
  console.log("=== view_market_position ===");
  console.log("RPC        :", rpc);
  console.log("Program    :", programId.toBase58());
  console.log("Market     :", market.toBase58());
  console.log("Mint       :", mint.toBase58());
  console.log("Bettor     :", bettorPk.toBase58());
  console.log("VaultAuth  :", vaultAuth.toBase58());
  console.log("Vault ATA  :", vaultAta.toBase58());
  console.log("Bettor ATA :", bettorAta.toBase58());
  console.log("Decimals   :", decimals);

  printRecord("Market", marketPretty);
  printRecord("Position", positionPretty);
  printRecord("Balances", {
    vault_ui: vaultUi,
    bettor_ui: bettorUi,
  });

  // If market resolved and position exists, show a rough expected payout (best-effort):
  if (resolved === "yes" || resolved === "no") {
    const side =
      fmtVal(positionData?.side) ||
      fmtVal(positionData?.outcome) ||
      fmtVal(positionData?.position);
    if (side && positionData?.staked && totalYes && totalNo) {
      const staked = BigInt(positionData.staked.toString());
      const y = BigInt(totalYes.toString());
      const n = BigInt(totalNo.toString());
      const pot = y + n;
      let payoutAtoms = 0n;
      if (resolved === side) {
        const pool = resolved === "yes" ? y : n;
        // proportional share (no fees assumed here; this is just a view)
        payoutAtoms = pool === 0n ? 0n : (staked * pot) / pool;
      }
      console.log("\nPayout (rough, no fees):", ui(payoutAtoms.toString(), decimals), "(ui)");
    }
  }
})().catch((e) => {
  console.error("❌ Error:", e.message || e);
  process.exit(1);
});

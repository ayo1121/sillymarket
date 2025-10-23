// scripts/create_market_quick2.js
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const { createHash } = require("crypto");
const BN = require("bn.js");

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

// ===== helpers =====
function expandTilde(p) {
  return p && p.startsWith("~") ? path.join(process.env.HOME, p.slice(1)) : p;
}
function loadKeypair(jsonPath) {
  const raw = fs.readFileSync(expandTilde(jsonPath), "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}
function disc8(name) {
  // Anchor discriminator = sha256("global:<name>")[0..7]
  return createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}
function i64le(n) {
  // BN -> 8 bytes little-endian (signed)
  return new BN(n).toArrayLike(Buffer, "le", 8);
}

// PDAs
const VAULT_AUTH_SEED = Buffer.from("vault-auth");

(async () => {
  const argv = minimist(process.argv.slice(2));

  const rpc =
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.RPC_URL ||
    "https://api.devnet.solana.com";

  const kpPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME, ".config/solana/id.json");

  const mintStr = argv.mint || process.env.MINT;
  const progStr = argv.prog || process.env.PROG_ID;
  const cutoffSecs = Number(argv["cutoff-seconds"] ?? process.env.CUTOFF ?? 600);

  if (!mintStr) throw new Error("Missing --mint (or MINT env)");
  if (!progStr) throw new Error("Missing --prog (or PROG_ID env)");
  if (!Number.isFinite(cutoffSecs) || cutoffSecs <= 0)
    throw new Error("cutoff seconds must be > 0");

  const owner = loadKeypair(kpPath);
  const connection = new Connection(rpc, { commitment: "confirmed" });

  const programId = new PublicKey(progStr);
  const mint = new PublicKey(mintStr);

  // new market account (created by program via system_program create_account)
  const marketKp = Keypair.generate();

  // PDAs/ATAs
  const [vaultAuth, _bump] = PublicKey.findProgramAddressSync(
    [VAULT_AUTH_SEED, marketKp.publicKey.toBuffer()],
    programId
  );
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultAuth, true);

  const now = Math.floor(Date.now() / 1000);
  const cutoffTs = now + cutoffSecs;

  console.log("=== create_market_quick2 (raw) ===");
  console.log("RPC            :", rpc);
  console.log("Owner (signer) :", owner.publicKey.toBase58());
  console.log("Program ID     :", programId.toBase58());
  console.log("Mint           :", mint.toBase58());
  console.log("Market         :", marketKp.publicKey.toBase58());
  console.log("Vault Auth     :", vaultAuth.toBase58());
  console.log("Vault ATA      :", vaultAta.toBase58());
  console.log(
    "Cutoff (secs)  :",
    cutoffSecs,
    "=>",
    new Date((now + cutoffSecs) * 1000).toISOString()
  );

  // ===== build raw Anchor instruction data =====
  const data = Buffer.concat([
    disc8("create_market"), // 8 bytes discriminator
    i64le(cutoffTs),        // arg: cutoff i64
  ]);

  // ===== accounts (exact IDL order) =====
  const keys = [
    // 'owner'
    { pubkey: owner.publicKey, isSigner: true, isWritable: true },
    // 'market'
    { pubkey: marketKp.publicKey, isSigner: true, isWritable: true },
    // 'bet_mint'
    { pubkey: mint, isSigner: false, isWritable: false },
    // 'vault_authority'
    { pubkey: vaultAuth, isSigner: false, isWritable: false },
    // 'vault'
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    // 'system_program'
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // 'token_program'
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    // 'associated_token_program'
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    // 'rent'
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const ix = {
    programId,
    keys,
    data,
  };

  const tx = new Transaction().add(ix);
  tx.feePayer = owner.publicKey;

  try {
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [owner, marketKp],
      { commitment: "confirmed" }
    );
    console.log("Tx Signature   :", sig);
    console.log("✅ Market created.");
  } catch (e) {
    console.error("❌ Error:", e.message || e);
    if (e.logs) console.error("Logs:\n" + e.logs.join("\n"));
    process.exit(1);
  }
})();

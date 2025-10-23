/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const {
  Connection, Keypair, PublicKey, SystemProgram,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const anchor = require("@coral-xyz/anchor");

// ---- helpers ----
const expandTilde = (p) => (p && p.startsWith("~") ? path.join(process.env.HOME, p.slice(1)) : p);
const loadKP = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expandTilde(p), "utf8"))));
const readIDL = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", "yesno_bets.json"), "utf8"));

const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");
const findIx = (idl, name) => idl.instructions.find(i => i.name.toLowerCase() === name.toLowerCase());
const findAcctBy = (idl, needle) => (idl.accounts || []).find(a => a.name.toLowerCase().includes(needle))?.name;

function encodeOutcome(idl, val) {
  const t = idl.types?.find(t => t.name === "Outcome")?.type;
  const v = String(val).toLowerCase();
  if (t?.kind === "enum") {
    if (t.variants.find(x => x.name === "yes") && v === "yes") return { yes: {} };
    if (t.variants.find(x => x.name === "no")  && v === "no")  return { no: {} };
    if (t.variants.find(x => x.name === "void") && v === "void") return { void: {} };
  }
  // numeric fallback
  if (v === "no") return 0;
  if (v === "yes") return 1;
  if (v === "void") return 2;
  throw new Error(`Unsupported outcome value: ${val}`);
}

(async () => {
  const argv = minimist(process.argv.slice(2));
  const rpc =
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.RPC_URL ||
    "https://api.devnet.solana.com";

  const programId = new PublicKey(argv.prog || process.env.PROG_ID);
  const marketPk  = new PublicKey(argv.market || process.env.MARKET);
  const mintPk    = new PublicKey(argv.mint || process.env.MINT);
  const outcome   = argv.outcome || process.env.OUTCOME; // "yes" | "no" | "void"
  if (!outcome) throw new Error("Provide --outcome yes|no|void");

  // sign as OWNER (must match OWNER constant in program)
  const walletPath = process.env.ANCHOR_WALLET || "~/.config/solana/id.json";
  const owner = loadKP(walletPath);

  const connection = new Connection(rpc, { commitment: "confirmed" });
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = readIDL();
  const program = new anchor.Program(idl, programId, provider);

  const marketAccountName =
    findAcctBy(idl, "market") || "market";

  // PDAs/ATAs
  const [vaultAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-auth"), marketPk.toBuffer()],
    program.programId
  );
  const vaultATA = getAssociatedTokenAddressSync(mintPk, vaultAuth, true);
  const ownerFeeATA = getAssociatedTokenAddressSync(mintPk, owner.publicKey, false);

  // Build account map based on IDL order
  const ix = findIx(idl, "resolve_market");
  if (!ix) throw new Error("resolve_market not found in IDL");

  const accounts = {};
  for (const a of ix.accounts) {
    const n = a.name.toLowerCase();
    if (n === "owner") accounts[a.name] = owner.publicKey;
    else if (n === "market") accounts[a.name] = marketPk;
    else if (["bet_mint", "betmint", "mint"].includes(n)) accounts[a.name] = mintPk;
    else if (n === "vault_authority" || n === "vaultauthority") accounts[a.name] = vaultAuth;
    else if (n === "vault") accounts[a.name] = vaultATA;
    else if (n === "owner_fee_ata" || n === "ownerfeeata") accounts[a.name] = ownerFeeATA;
    else if (n === "token_program" || n === "tokenprogram") accounts[a.name] = TOKEN_PROGRAM_ID;
    else if (n === "associated_token_program" || n === "associatedtokenprogram") accounts[a.name] = ASSOCIATED_TOKEN_PROGRAM_ID;
    else if (n === "system_program" || n === "systemprogram") accounts[a.name] = SystemProgram.programId;
    else if (n === "rent") accounts[a.name] = SYSVAR_RENT_PUBKEY;
    else throw new Error(`Don't know how to fill account '${a.name}' for resolve_market`);
  }

  // Args
  const args = [];
  if (ix.args?.length) {
    // first arg usually Outcome
    args.push(encodeOutcome(idl, outcome));
  }

  console.log("=== resolve_market_quick ===");
  console.log("RPC        :", rpc);
  console.log("Program    :", program.programId.toBase58());
  console.log("Owner      :", owner.publicKey.toBase58());
  console.log("Market     :", marketPk.toBase58());
  console.log("Mint       :", mintPk.toBase58());
  console.log("Outcome    :", outcome);
  console.log("VaultAuth  :", vaultAuth.toBase58());
  console.log("Vault ATA  :", vaultATA.toBase58());
  console.log("OwnerFeeATA:", ownerFeeATA.toBase58());

  const sig = await program.methods
    .resolveMarket(...args)
    .accounts(accounts)
    .rpc();

  console.log("✅ Resolved. Tx:", sig);
})().catch((e) => {
  console.error("❌ Error:", e.message || e);
  process.exit(1);
});

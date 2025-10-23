/* scripts/sweep_fees_quick.js */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const anchor = require("@coral-xyz/anchor");
const {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const expandTilde = (p) => (p && p.startsWith("~") ? path.join(process.env.HOME, p.slice(1)) : p);
const loadKP = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expandTilde(p), "utf8"))));
const toPk = (x, label) => { try { return new PublicKey(x); } catch { throw new Error(`Bad pubkey for ${label}: ${x}`); } };
const readLocalIDL = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", "yesno_bets.json"), "utf8"));
const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
const disc = (name) => require("crypto").createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

function mapAccount(nameRaw, ctx) {
  const n = nameRaw.toLowerCase().replace(/\s+/g, "");
  if (n === "owner") return ctx.ownerPk;
  if (n === "market") return ctx.market;
  if (["bet_mint","betmint","mint"].includes(n)) return ctx.mint;
  if (["vault_authority","vaultauthority"].includes(n)) return ctx.vaultAuth;
  if (n === "vault") return ctx.vaultAta;
  if (["owner_fee_ata","ownerfeeata"].includes(n)) return ctx.ownerFeeAta;
  if (["token_program","tokenprogram"].includes(n)) return TOKEN_PROGRAM_ID;
  if (["associated_token_program","associatedtokenprogram"].includes(n)) return ASSOCIATED_TOKEN_PROGRAM_ID;
  if (["system_program","systemprogram"].includes(n)) return SystemProgram.programId;
  if (n === "rent") return SYSVAR_RENT;
  throw new Error(`Don't know how to provide account '${nameRaw}' for sweep_fees`);
}

(async () => {
  const argv = minimist(process.argv.slice(2));
  const rpc = process.env.ANCHOR_PROVIDER_URL || process.env.RPC_URL || "https://api.devnet.solana.com";
  const programId = toPk(argv.prog || process.env.PROG_ID, "PROG_ID");
  const market   = toPk(argv.market || process.env.MARKET, "MARKET");
  const mint     = toPk(argv.mint || process.env.MINT, "MINT");
  const walletPath = argv.wallet || process.env.ANCHOR_WALLET || "~/.config/solana/id.json"; // OWNER

  const owner = loadKP(walletPath);
  const connection = new Connection(rpc, { commitment: "confirmed" });
  const provider   = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {});
  let idl = null;
  try { idl = await anchor.Program.fetchIdl(programId, provider); } catch {}
  if (!idl) idl = readLocalIDL();

  const ixDef = (idl.instructions || []).find(i => i.name.toLowerCase() === "sweep_fees") || {
    name: "sweep_fees",
    accounts: [
      { name: "owner", isMut: true, isSigner: true },
      { name: "market", isMut: true, isSigner: false },
      { name: "bet_mint", isMut: false, isSigner: false },
      { name: "vault_authority", isMut: false, isSigner: false },
      { name: "vault", isMut: true, isSigner: false },
      { name: "owner_fee_ata", isMut: true, isSigner: false },
      { name: "token_program", isMut: false, isSigner: false },
      { name: "associated_token_program", isMut: false, isSigner: false },
      { name: "system_program", isMut: false, isSigner: false },
      { name: "rent", isMut: false, isSigner: false },
    ],
    args: [],
  };

  const [vaultAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-auth"), market.toBuffer()],
    programId
  );
  const vaultAta    = getAssociatedTokenAddressSync(mint, vaultAuth, true);
  const ownerFeeAta = getAssociatedTokenAddressSync(mint, owner.publicKey, false);

  console.log("=== sweep_fees_quick ===");
  console.log("RPC        :", rpc);
  console.log("Program    :", programId.toBase58());
  console.log("Owner      :", owner.publicKey.toBase58());
  console.log("Market     :", market.toBase58());
  console.log("Mint       :", mint.toBase58());
  console.log("VaultAuth  :", vaultAuth.toBase58());
  console.log("Vault ATA  :", vaultAta.toBase58());
  console.log("OwnerFeeATA:", ownerFeeAta.toBase58());

  const forceWritable = new Set(["market","vault","owner_fee_ata"]);
  const ctx = { ownerPk: owner.publicKey, market, mint, vaultAuth, vaultAta, ownerFeeAta };

  const keys = ixDef.accounts.map((a) => {
    const pk = mapAccount(a.name, ctx);
    const isSigner = !!a.isSigner || a.name.toLowerCase() === "owner";
    const isWritable = forceWritable.has(a.name.toLowerCase()) ? true : !!a.isMut;
    return { pubkey: pk, isSigner, isWritable };
  });

  const preIxs = [];
  const info = await connection.getAccountInfo(ownerFeeAta);
  if (!info) {
    preIxs.push(createAssociatedTokenAccountInstruction(
      owner.publicKey, ownerFeeAta, owner.publicKey, mint,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    ));
  }

  const data = Buffer.from(disc(ixDef.name));
  const tx = new Transaction().add(...preIxs, { programId, keys, data });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner.publicKey;
  tx.sign(owner);

  const sim = await connection.simulateTransaction(tx, [owner]);
  if (sim.value.err) {
    console.error("-- simulate failed", sim.value.err, sim.value.logs || []);
    throw new Error("simulation failed");
  }

  const sig = await sendAndConfirmTransaction(connection, tx, [owner], { commitment: "confirmed" });
  console.log("✅ Fees swept. Tx:", sig);
})().catch((e) => {
  console.error("❌ Error:", e.message || e);
  process.exit(1);
});

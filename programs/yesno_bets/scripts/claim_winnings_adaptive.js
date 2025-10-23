/* scripts/claim_winnings_adaptive.js */
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

// ---------- helpers ----------
const expandTilde = (p) => (p && p.startsWith("~") ? path.join(process.env.HOME, p.slice(1)) : p);
const loadKP = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expandTilde(p), "utf8"))));
const toPk = (x, label) => { try { return new PublicKey(x); } catch { throw new Error(`Bad pubkey for ${label}: ${x}`); } };
const readLocalIDL = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", "yesno_bets.json"), "utf8"));
const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
const sha256 = (s) => require("crypto").createHash("sha256").update(s).digest();
const ixDisc = (name) => sha256(`global:${name}`).subarray(0, 8);
const acctDisc = (name) => sha256(`account:${name}`).subarray(0, 8);

// map any IDL account names to the concrete keys we compute
function mapAccount(nameRaw, ctx) {
  const n = nameRaw.toLowerCase().replace(/\s+/g, "");
  if (["bettor","signer","payer"].includes(n)) return ctx.bettorPk;
  if (n === "market") return ctx.market;
  if (["bet_mint","betmint","mint"].includes(n)) return ctx.mint;
  if (["vault_authority","vaultauthority"].includes(n)) return ctx.vaultAuth;
  if (n === "vault") return ctx.vaultAta;
  if (["bettor_ata","bettortoken","bettortokenaccount"].includes(n)) return ctx.bettorAta;
  if (["token_program","tokenprogram"].includes(n)) return TOKEN_PROGRAM_ID;
  if (["associated_token_program","associatedtokenprogram"].includes(n)) return ASSOCIATED_TOKEN_PROGRAM_ID;
  if (["system_program","systemprogram"].includes(n)) return SystemProgram.programId;
  if (n === "rent") return SYSVAR_RENT;
  if (n === "position") return ctx.position;
  throw new Error(`Don't know how to provide account '${nameRaw}' for claim_winnings`);
}

// read two pubkeys from raw account data after the 8-byte discriminator
function readTwoPubkeys(data) {
  if (!data || data.length < 8 + 32 + 32) return null;
  const a = new PublicKey(data.subarray(8, 8 + 32));
  const b = new PublicKey(data.subarray(8 + 32, 8 + 64));
  return [a, b];
}

async function pdaExistsAndIsPosition(connection, pk) {
  const info = await connection.getAccountInfo(pk);
  if (!info || !info.data || info.data.length < 8) return false;
  const disc = acctDisc("Position");
  return info.data.subarray(0, 8).equals(disc);
}

async function discoverPositionAccount({ connection, programId, bettorPk, market }) {
  // First, try a quick memcmp scan with bettor at offset 8 (first field)
  const tryOffsets = [
    { firstIs: "bettor", offset: 8, expect: bettorPk },
    { firstIs: "market", offset: 8, expect: market },
  ];

  for (const t of tryOffsets) {
    const accs = await connection.getProgramAccounts(programId, {
      // Only filter by the first 8(discriminator) + first key
      filters: [{ memcmp: { offset: 8, bytes: t.expect.toBase58() } }],
      commitment: "confirmed",
    });

    for (const a of accs) {
      const data = a.account.data;
      if (!data || data.length < 8 + 64) continue;
      // Must be a Position account by discriminator
      if (!data.subarray(0, 8).equals(acctDisc("Position"))) continue;

      const [first, second] = readTwoPubkeys(data) || [];
      if (!first || !second) continue;

      // Check both orders
      const isMatchA = first.equals(bettorPk) && second.equals(market);
      const isMatchB = first.equals(market)   && second.equals(bettorPk);
      if (isMatchA || isMatchB) {
        return new PublicKey(a.pubkey);
      }
    }
  }
  return null;
}

(async () => {
  const argv = minimist(process.argv.slice(2));
  const rpc = process.env.ANCHOR_PROVIDER_URL || process.env.RPC_URL || "https://api.devnet.solana.com";
  const programId = toPk(argv.prog || process.env.PROG_ID, "PROG_ID");
  const market   = toPk(argv.market || process.env.MARKET, "MARKET");
  const mint     = toPk(argv.mint || process.env.MINT, "MINT");

  // Bettor signer (defaults to ANCHOR_WALLET)
  const walletPath = argv.wallet || process.env.ANCHOR_WALLET || "./bettor.json";
  const bettor = loadKP(walletPath);
  const bettorExplicit = argv.bettor || process.env.BETTOR; // optional override for PDA/scan only
  const bettorPk = bettorExplicit ? toPk(bettorExplicit, "BETTOR") : bettor.publicKey;

  const connection = new Connection(rpc, { commitment: "confirmed" });
  const provider   = new anchor.AnchorProvider(connection, new anchor.Wallet(bettor), {});
  let idl = null;
  try { idl = await anchor.Program.fetchIdl(programId, provider); } catch {}
  if (!idl) idl = readLocalIDL();

  // Instruction def (args: none)
  const ixDef = (idl.instructions || []).find(i => i.name.toLowerCase() === "claim_winnings") || {
    name: "claim_winnings",
    accounts: [
      { name: "bettor", isMut: true, isSigner: true },
      { name: "market", isMut: true, isSigner: false },
      { name: "bet_mint", isMut: false, isSigner: false },
      { name: "vault_authority", isMut: false, isSigner: false },
      { name: "vault", isMut: true, isSigner: false },
      { name: "bettor_ata", isMut: true, isSigner: false },
      { name: "position", isMut: true, isSigner: false },
      { name: "token_program", isMut: false, isSigner: false },
      { name: "associated_token_program", isMut: false, isSigner: false },
      { name: "system_program", isMut: false, isSigner: false },
      { name: "rent", isMut: false, isSigner: false },
    ],
    args: [],
  };

  // PDAs/ATAs
  const [vaultAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-auth"), market.toBuffer()],
    programId
  );
  const vaultAta   = getAssociatedTokenAddressSync(mint, vaultAuth, true);
  const bettorAta  = getAssociatedTokenAddressSync(mint, bettorPk, false);

  // two common PDA orders used during betting
  const seedStr = process.env.POSITION_SEED || "pos";
  const orders = (process.env.POSITION_SEED_ORDER || "bettor-market,market-bettor")
    .split(",").map(s => s.trim());

  console.log("=== claim_winnings_adaptive ===");
  console.log("RPC        :", rpc);
  console.log("Program    :", programId.toBase58());
  console.log("Bettor     :", bettorPk.toBase58(), "(signer:", bettor.publicKey.toBase58() + ")");
  console.log("Market     :", market.toBase58());
  console.log("Mint       :", mint.toBase58());
  console.log("VaultAuth  :", vaultAuth.toBase58());
  console.log("Vault ATA  :", vaultAta.toBase58());
  console.log("Bettor ATA :", bettorAta.toBase58());
  console.log("PDA seed   :", seedStr, "orders:", orders.join(" | "));

  // Ensure bettor ATA exists
  const preIxs = [];
  const infoAta = await connection.getAccountInfo(bettorAta);
  if (!infoAta) {
    preIxs.push(createAssociatedTokenAccountInstruction(
      bettor.publicKey, bettorAta, bettorPk, mint,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    ));
  }

  // Prepare instruction data (no args)
  const data = Buffer.from(ixDisc(ixDef.name));
  const forceWritable = new Set(["market","vault","bettor_ata","position"]);

  // Try candidate positions by seed first
  const candidates = [];
  for (const ord of orders) {
    let pk;
    if (ord === "bettor-market") {
      [pk] = PublicKey.findProgramAddressSync(
        [Buffer.from(seedStr), bettorPk.toBuffer(), market.toBuffer()],
        programId
      );
    } else if (ord === "market-bettor") {
      [pk] = PublicKey.findProgramAddressSync(
        [Buffer.from(seedStr), market.toBuffer(), bettorPk.toBuffer()],
        programId
      );
    }
    if (pk) candidates.push({ why: `pda:${ord}`, pk });
  }

  // Add discovered account (scan) as fallback
  const discovered = await discoverPositionAccount({ connection, programId, bettorPk, market });
  if (discovered) candidates.push({ why: "scan", pk: discovered });

  // Attempt in order
  for (const c of candidates) {
    // Require that it really is a Position account
    const isPos = await pdaExistsAndIsPosition(connection, c.pk);
    if (!isPos) {
      console.error(`-- skip ${c.why} (${c.pk.toBase58()}) -> not an initialized Position`);
      continue;
    }

    const ctx = { bettorPk, market, mint, vaultAuth, vaultAta, bettorAta, position: c.pk };
    const keys = ixDef.accounts.map((a) => {
      const pk = mapAccount(a.name, ctx);
      const isSigner = !!a.isSigner || a.name.toLowerCase() === "bettor";
      const isWritable = forceWritable.has(a.name.toLowerCase()) ? true : !!a.isMut;
      return { pubkey: pk, isSigner, isWritable };
    });

    try {
      const tx = new Transaction().add(...preIxs, { programId, keys, data });
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = bettor.publicKey;
      tx.sign(bettor);

      const sim = await connection.simulateTransaction(tx, [bettor]);
      if (sim.value.err) {
        console.error(`-- simulate[${c.why}] failed`, sim.value.err, sim.value.logs || []);
        // If this one fails, try next candidate
        continue;
      }

      const sig = await sendAndConfirmTransaction(connection, tx, [bettor], { commitment: "confirmed" });
      console.log(`✅ Claimed winnings/refund using ${c.why} position ${c.pk.toBase58()}. Tx:`, sig);
      process.exit(0);
    } catch (e) {
      console.error(`-- attempt with ${c.why} (${c.pk.toBase58()}) failed:`, e.message);
    }
  }

  throw new Error("Could not find a valid Position account for this bettor + market. Make sure you claimed on the market where the bet was placed.");
})().catch((e) => {
  console.error("❌ Error:", e.message || e);
  process.exit(1);
});

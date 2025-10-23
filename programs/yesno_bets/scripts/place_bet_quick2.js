// scripts/place_bet_quick2.js
const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const {
  PublicKey, Keypair, Connection, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY,
} = anchor.web3;
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} = require("@solana/spl-token");

function die(m){ console.error("❌ " + m); process.exit(1); }
function asPk(x,label){ try { return new PublicKey(String(x)); } catch { die(`Bad pubkey for ${label}`); } }
function deriveAta(owner, mint){
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}
function parseAmountToRaw(amountStr, decimals){
  const [i,f=""]=String(amountStr).trim().split(".");
  const frac=(f+"0".repeat(decimals)).slice(0,decimals);
  return BigInt(i) * (10n**BigInt(decimals)) + BigInt(frac);
}

(async () => {
  // -------- env --------
  const RPC = process.env.ANCHOR_PROVIDER_URL || process.env.RPC_URL || "https://api.devnet.solana.com";
  const WALLET = process.env.ANCHOR_WALLET || die("Set ANCHOR_WALLET to bettor keypair json (e.g. ./bettor.json)");
  const PROG_ID = asPk(process.env.PROG_ID, "PROG_ID");
  const MARKET  = asPk(process.env.MARKET, "MARKET");
  const MINT    = asPk(process.env.MINT, "MINT");

  // OWNER **must equal** the hardcoded OWNER in your lib.rs
  const OWNER   = asPk(process.env.OWNER, "OWNER");

  const SIDE = String(process.env.SIDE||"yes").toLowerCase().startsWith("y"); // true => yes
  const DECIMALS = parseInt(process.env.DECIMALS || "6", 10);
  const amountRaw = process.env.AMOUNT_RAW
    ? BigInt(process.env.AMOUNT_RAW)
    : parseAmountToRaw(String(process.env.AMOUNT || "1"), DECIMALS);

  // -------- setup --------
  const conn = new Connection(RPC, "confirmed");
  const bettor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET,"utf8"))));

  // addresses
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-auth"), MARKET.toBuffer()], PROG_ID
  );
  const bettorAta = deriveAta(bettor.publicKey, MINT);
  const vaultAta  = deriveAta(vaultAuthority, MINT);
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), MARKET.toBuffer(), bettor.publicKey.toBuffer()], PROG_ID
  );
  const ownerFeeAta = deriveAta(OWNER, MINT);

  // ensure bettor ATA exists
  const preIxs = [];
  if (!(await conn.getAccountInfo(bettorAta))) {
    preIxs.push(createAssociatedTokenAccountInstruction(
      bettor.publicKey, bettorAta, bettor.publicKey, MINT
    ));
  }

  // load full IDL
  const idl = JSON.parse(fs.readFileSync("target/idl/yesno_bets.json","utf8"));
  const coder = new anchor.BorshCoder(idl);

  // find the place_bet instruction in IDL (camel or snake)
  const ixDef = (idl.instructions || []).find(x => x.name === "place_bet" || x.name === "placeBet");
  if (!ixDef) die("place_bet/placeBet not found in IDL");

  // build args in IDL order; try multiple enum encodings until coder accepts
  const baseArgs = {};
  let outcomeArgName = null;
  for (const a of ixDef.args) {
    const n = a.name.toLowerCase();
    if (n.includes("amount")) {
      baseArgs[a.name] = new anchor.BN(amountRaw.toString());
    } else if (n.includes("outcome") || n.includes("side")) {
      outcomeArgName = a.name;
    } else {
      die("Unrecognized arg in IDL: " + a.name);
    }
  }
  if (!outcomeArgName) die("Could not locate outcome/side argument in IDL");

  const outcomeCandidates = [
    SIDE ? { Yes: {} } : { No: {} },       // TitleCase (matches your IDL variants)
    SIDE ? { yes: {} } : { no: {} },       // lowercase
    SIDE ? true : false,                   // bool
    new anchor.BN(SIDE ? 1 : 2),           // u8: Yes=1, No=2 (your enum #[repr(u8)])
    new anchor.BN(SIDE ? 1 : 0),           // u8: Yes=1, No=0 (fallback)
  ];

  let data = null;
  let lastErr = null;
  for (const cand of outcomeCandidates) {
    try {
      const args = Object.assign({}, baseArgs, { [outcomeArgName]: cand });
      data = coder.instruction.encode(ixDef.name, args);
      break;
    } catch (e) { lastErr = e; }
  }
  if (!data) die("unable to encode enum outcome (last error: " + (lastErr?.message || lastErr) + ")");

  // map accounts from IDL names → actual pubkeys
  function mapAcct(name){
    const n = name.toLowerCase();
    if (n==="bettor"||n==="user"||n==="payer") return { pk: bettor.publicKey, s:true,  w:true  };
    if (n==="market")                           return { pk: MARKET,          s:false, w:true  };
    if (n==="betmint"||n==="bet_mint"||n==="mint")
                                               return { pk: MINT,            s:false, w:false };
    if (n==="bettorata"||n==="userata"||n==="bettor_ata"||n==="user_ata")
                                               return { pk: bettorAta,       s:false, w:true  };
    if (n==="vaultauthority"||n==="vault_authority")
                                               return { pk: vaultAuthority,  s:false, w:false };
    if (n==="vault")                            return { pk: vaultAta,        s:false, w:true  };
    if (n==="owner")                            return { pk: OWNER,           s:false, w:false };
    if (n==="ownerfeeata"||n==="owner_fee_ata") return { pk: ownerFeeAta,     s:false, w:true  };
    if (n==="position")                         return { pk: position,        s:false, w:true  };
    if (n==="systemprogram"||n==="system_program")
                                               return { pk: SystemProgram.programId, s:false, w:false };
    if (n==="tokenprogram"||n==="token_program")
                                               return { pk: TOKEN_PROGRAM_ID, s:false, w:false };
    if (n==="associatedtokenprogram"||n==="associated_token_program")
                                               return { pk: ASSOCIATED_TOKEN_PROGRAM_ID, s:false, w:false };
    if (n==="rent")                             return { pk: SYSVAR_RENT_PUBKEY, s:false, w:false };
    die("Unmapped account from IDL: " + name);
  }
  const keys = ixDef.accounts.map(a => {
    const { pk, s, w } = mapAcct(a.name);
    return { pubkey: pk, isSigner: s, isWritable: w };
  });

  // send tx
  const ix = new TransactionInstruction({ programId: PROG_ID, keys, data });
  const tx = new Transaction().add(...preIxs, ix);
  const sig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [bettor], { commitment: "confirmed" });

  console.log("✅ place_bet tx:", sig);
  console.log("bettor:", bettor.publicKey.toBase58());
  console.log("market:", MARKET.toBase58());
  console.log("mint  :", MINT.toBase58());
  console.log("side  :", SIDE ? "YES" : "NO");
  console.log("amount raw:", amountRaw.toString());
})().catch(e => { console.error("❌ Error:", e?.message || e); if (e?.transactionLogs) console.error("Logs:\n"+e.transactionLogs.join("\n")); process.exit(1); });

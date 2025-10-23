// claim winnings (raw)
const fs = require("fs");
const crypto = require("crypto");
const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } = require("@solana/spl-token");

function mustPubkey(v, label){ try {return new PublicKey(String(v).trim())} catch { console.error(`❌ ${label} invalid:`, v); process.exit(1); } }
function findAta(owner, mint){ return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0]; }

(async () => {
  try {
    const RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
    const kpPath = process.env.ANCHOR_WALLET;
    const PROG_ID = mustPubkey(process.env.PROG_ID, "PROG_ID");
    const MARKET  = mustPubkey(process.env.MARKET , "MARKET");
    const MINT    = mustPubkey(process.env.MINT   , "MINT");
    if (!kpPath || !fs.existsSync(kpPath)) { console.error("❌ Set ANCHOR_WALLET to winner keypair json"); process.exit(1); }

    const bettor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath,"utf8"))));
    const conn = new Connection(RPC, "confirmed");

    const bettorAta = findAta(bettor.publicKey, MINT);
    const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault-auth"), MARKET.toBuffer()], PROG_ID);
    const vault = findAta(vaultAuthority, MINT);
    const [position] = PublicKey.findProgramAddressSync([Buffer.from("position"), MARKET.toBuffer(), bettor.publicKey.toBuffer()], PROG_ID);

    const disc = crypto.createHash("sha256").update("global:claim_winnings").digest().subarray(0,8);
    const data = disc;

    const pre = [];
    if (!await conn.getAccountInfo(bettorAta)) {
      pre.push(createAssociatedTokenAccountInstruction(bettor.publicKey, bettorAta, bettor.publicKey, MINT));
    }
    if (!await conn.getAccountInfo(vault)) {
      console.error("❌ Vault ATA missing; market was not initialized correctly.");
      process.exit(1);
    }

    const keys = [
      { pubkey: bettor.publicKey, isSigner:true,  isWritable:true },
      { pubkey: MARKET,          isSigner:false, isWritable:true },
      { pubkey: MINT,            isSigner:false, isWritable:false },
      { pubkey: bettorAta,       isSigner:false, isWritable:true },
      { pubkey: vaultAuthority,  isSigner:false, isWritable:false },
      { pubkey: vault,           isSigner:false, isWritable:true },
      { pubkey: position,        isSigner:false, isWritable:true },
      { pubkey: SystemProgram.programId, isSigner:false, isWritable:false },
      { pubkey: TOKEN_PROGRAM_ID,        isSigner:false, isWritable:false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner:false, isWritable:false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner:false, isWritable:false },
    ];

    const ix = new TransactionInstruction({ programId: PROG_ID, keys, data });
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...pre, ix), [bettor], { commitment:"confirmed" });
    console.log("✅ claim_winnings tx:", sig);
  } catch (e) {
    console.error("❌ Error:", e.message || e);
    if (e.logs) console.error("Logs:\n"+e.logs.join("\n"));
    process.exit(1);
  }
})();

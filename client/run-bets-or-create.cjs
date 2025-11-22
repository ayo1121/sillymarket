const fs = require("fs");
const { createHash } = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const STATE_ACTIVE = 1;

function u32le(n){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; }
function i64le(n){ const b=Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }

function hashQA(q, answers){
  const enc = new TextEncoder();
  const parts = [];
  parts.push(Buffer.from("yesno_markets_v1"));
  parts.push(u32le(Buffer.byteLength(q))); parts.push(Buffer.from(enc.encode(q)));
  parts.push(u32le(answers.length));
  for(const a of answers){
    parts.push(u32le(Buffer.byteLength(a)));
    parts.push(Buffer.from(enc.encode(a)));
  }
  return createHash("sha256").update(Buffer.concat(parts)).digest();
}

function marketPda(creator, cutoff, qhash, programId){
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), i64le(cutoff), qhash],
    programId
  )[0];
}

function posPda(market, user, programId){
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), market.toBuffer(), user.toBuffer()],
    programId
  )[0];
}

async function airdropOrFund(conn, wallet, toPk, lamports){
  try {
    const sig = await conn.requestAirdrop(toPk, lamports);
    await conn.confirmTransaction(sig, "confirmed");
    return;
  } catch(e){
    console.warn("Airdrop failed, funding from wallet:", e?.message || e);
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: toPk, lamports })
    );
    const signer = wallet.payer ?? wallet;
    const sig2 = await conn.sendTransaction(tx, [signer]);
    await conn.confirmTransaction(sig2, "confirmed");
  }
}

(async () => {
  try {
    const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
    const CONFIG = new PublicKey(process.env.CONFIG);
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json","utf8"));
    if (!idl.address) { idl.address = PROGRAM_ID.toBase58(); }
    const program = new anchor.Program(idl, provider);
    const wallet = provider.wallet;

    const adminSeed = createHash("sha256").update("bets-flow-admin").update(CONFIG.toBuffer()).digest();
    const admin = Keypair.fromSeed(adminSeed.subarray(0, 32));

    const cfgAcct = await program.account.config.fetch(CONFIG);
    if (!cfgAcct.authority.equals(admin.publicKey)) {
      console.log("Syncing config authority to admin", admin.publicKey.toBase58());
      await program.methods.setAuthority(admin.publicKey)
        .accounts({ authority: wallet.publicKey, config: CONFIG })
        .rpc();
    }

    const adminBal = await provider.connection.getBalance(admin.publicKey);
    if (adminBal < 0.02 * LAMPORTS_PER_SOL) {
      console.log("Funding admin signer:", admin.publicKey.toBase58());
      await airdropOrFund(provider.connection, wallet, admin.publicKey, 0.05 * LAMPORTS_PER_SOL);
    }

    const allMine = await program.account.market.all([
      { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } }
    ]);

    const now = Math.floor(Date.now()/1000);
    let chosen = allMine
      .map(x => ({ pubkey: x.publicKey, data: x.account }))
      .filter(x => x.data.state === STATE_ACTIVE && Number(x.data.cutoffTs) > now + 30)
      .sort((a,b) => Number(b.data.createdTs) - Number(a.data.createdTs))[0];

    if (!chosen){
      const cutoff = now + 900;
      const question = "Bets flow test: will script complete?";
      const answers = ["Yes","No"];
      const qhash = hashQA(question, answers);
      const market = marketPda(wallet.publicKey, cutoff, qhash, PROGRAM_ID);

      await program.methods.createMarket(
        new anchor.BN(cutoff),
        Array.from(qhash),
        question,
        answers,
        "https://example.com/img.png"
      ).accounts({
        creator: wallet.publicKey,
        config: CONFIG,
        platformFeeWallet: wallet.publicKey,
        market,
        systemProgram: SystemProgram.programId
      }).rpc();

      const m = await program.account.market.fetch(market);
      chosen = { pubkey: market, data: m };
      console.log("Created market:", market.toBase58());
    } else {
      console.log("Using existing active market:", chosen.pubkey.toBase58());
    }

    const MARKET = chosen.pubkey;
    const mAcc = chosen.data;

    const posA = posPda(MARKET, wallet.publicKey, PROGRAM_ID);
    const userB = Keypair.generate();
    const posB = posPda(MARKET, userB.publicKey, PROGRAM_ID);

    const balB = await provider.connection.getBalance(userB.publicKey);
    if (balB < 0.2 * LAMPORTS_PER_SOL) {
      console.log("Funding userB:", userB.publicKey.toBase58());
      await airdropOrFund(provider.connection, wallet, userB.publicKey, 1 * LAMPORTS_PER_SOL);
    }

    await program.methods.placeBet(0, new anchor.BN(0.05 * LAMPORTS_PER_SOL))
      .accounts({ market: MARKET, user: wallet.publicKey, position: posA, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("UserA bet placed:", posA.toBase58());

    await program.methods.placeBet(1, new anchor.BN(0.02 * LAMPORTS_PER_SOL))
      .accounts({ market: MARKET, user: userB.publicKey, position: posB, systemProgram: SystemProgram.programId })
      .signers([userB]).rpc();
    console.log("UserB bet placed:", posB.toBase58());

    await program.methods.resolve(0).accounts({
      config: CONFIG,
      market: MARKET,
      signer: admin.publicKey,
      platformFeeWallet: mAcc.platformFeeWallet,
      creatorWallet: mAcc.creator,
      systemProgram: SystemProgram.programId
    }).signers([admin]).rpc();
    console.log("Resolved winner=0");

    await program.methods.claimWinnings()
      .accounts({ market: MARKET, user: wallet.publicKey, position: posA, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("UserA claimed");

    await program.methods.closePosition()
      .accounts({ user: wallet.publicKey, position: posA })
      .rpc();
    console.log("UserA position closed");

    const mFinal = await program.account.market.fetch(MARKET);
    console.log("Final remaining pool:", mFinal.resolvedTotalPoolRemaining.toString());
  } catch (err) {
    console.error("run-bets-or-create error", err?.stack || err);
    process.exit(1);
  }
})();

const { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair, Transaction } = require("@solana/web3.js");
const { getProgram, hashQA, marketPda, posPda } = require("../lib/common.cjs");

// Env
const {
  PROGRAM_ID, CONFIG, FEE,
  Q, ANS, IMG,           // question, answers comma-separated, image
  CUT,                   // seconds until cutoff, min 300
  SOL_A, O_A,           // bettor A: size in SOL, outcome index
  SOL_B, O_B,           // bettor B: size in SOL, outcome index
  OUTCOME_WIN,          // winner index or -2 for VOID
  WANT_ADMIN            // "1" => resolve pre-cutoff using current wallet as config authority
} = process.env;

if (!PROGRAM_ID || !CONFIG || !FEE) throw new Error("Set PROGRAM_ID, CONFIG, FEE");

const cut = Math.max(Number(CUT ?? 320), 300);
const qa = {
  question: Q ?? "advanced flow test",
  answers: (ANS ?? "Yes,No").split(",").map(s => s.trim()).filter(Boolean).slice(0,5),
  image: IMG ?? "https://example.com/img.png",
};
if (qa.answers.length < 2) throw new Error("Need at least 2 answers");

const solA = Number(SOL_A ?? 0.05);
const solB = Number(SOL_B ?? 0.02);
const outA = Number(O_A ?? 0);      // default A on index 0
const outB = Number(O_B ?? 1);      // default B on index 1
const winner = Number(OUTCOME_WIN ?? 0); // -2 for VOID allowed if admin

async function airdropOrFund(conn, payer, toPk, lamports){
  try {
    const sig = await conn.requestAirdrop(toPk, lamports);
    await conn.confirmTransaction(sig, "confirmed");
  } catch {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: toPk, lamports }));
    const sig2 = await conn.sendTransaction(tx, [payer.payer ?? payer]);
    await conn.confirmTransaction(sig2, "confirmed");
  }
}

(async () => {
  const { program, provider, anchor } = getProgram(PROGRAM_ID);
  const me = provider.wallet.publicKey;
  const programId = new PublicKey(PROGRAM_ID);
  const cfgPk = new PublicKey(CONFIG);
  const feePk = new PublicKey(FEE);
  const tempAdmin = WANT_ADMIN === "1" ? Keypair.generate() : null;

  const now = Math.floor(Date.now()/1000);
  const cutoff = now + cut;

  // Create market
  const qh = hashQA(qa.question, qa.answers);
  const mPk = marketPda(me, cutoff, qh, programId);
  await program.methods.createMarket(new anchor.BN(cutoff), Array.from(qh), qa.question, qa.answers, qa.image)
    .accounts({ creator: me, config: cfgPk, platformFeeWallet: feePk, market: mPk, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("market:", mPk.toBase58());

  // Place bet A (current wallet)
  const posA = posPda(mPk, me, programId);
  await program.methods.placeBet(outA, new anchor.BN(Math.floor(solA * LAMPORTS_PER_SOL)))
    .accounts({ market: mPk, user: me, position: posA, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("bet A:", posA.toBase58(), "out", outA, "sol", solA);

  // Place bet B (fresh key)
  const kb = Keypair.generate();
  await airdropOrFund(provider.connection, provider.wallet, kb.publicKey, Math.ceil(0.3 * LAMPORTS_PER_SOL));
  const posB = posPda(mPk, kb.publicKey, programId);
  await program.methods.placeBet(outB, new anchor.BN(Math.floor(solB * LAMPORTS_PER_SOL)))
    .accounts({ market: mPk, user: kb.publicKey, position: posB, systemProgram: SystemProgram.programId })
    .signers([kb]).rpc();
  console.log("bet B:", posB.toBase58(), "out", outB, "sol", solB);

  // Resolve
  if (tempAdmin) {
    await program.methods.setAuthority(tempAdmin.publicKey)
      .accounts({ authority: me, config: cfgPk })
      .rpc();
    console.log("temporary admin:", tempAdmin.publicKey.toBase58());
  }

  const mAcc = await program.account.market.fetch(mPk);
  const resolverSigner = tempAdmin ? tempAdmin.publicKey : me;
  const resolverSigners = tempAdmin ? [tempAdmin] : [];

  if (tempAdmin) {
    await program.methods.resolve(winner).accounts({
      config: cfgPk, market: mPk, signer: resolverSigner,
      platformFeeWallet: mAcc.platformFeeWallet, creatorWallet: mAcc.creator,
      systemProgram: SystemProgram.programId
    }).signers(resolverSigners).rpc();
    console.log("resolved pre-cutoff as admin:", winner);
  } else {
    const wait = Math.max(0, cutoff - Math.floor(Date.now()/1000) + 1);
    console.log("waiting seconds:", wait);
    await new Promise(r => setTimeout(r, wait * 1000));
    await program.methods.resolve(winner).accounts({
      config: cfgPk, market: mPk, signer: me,
      platformFeeWallet: mAcc.platformFeeWallet, creatorWallet: mAcc.creator,
      systemProgram: SystemProgram.programId
    }).rpc();
    console.log("resolved after cutoff:", winner);
  }

  if (tempAdmin) {
    await program.methods.setAuthority(me)
      .accounts({ authority: tempAdmin.publicKey, config: cfgPk })
      .signers([tempAdmin])
      .rpc();
    console.log("authority restored");
  }

  // Claims
  const claimA = async () => {
    await program.methods.claimWinnings()
      .accounts({ market: mPk, user: me, position: posA, systemProgram: SystemProgram.programId })
      .rpc();
    await program.methods.closePosition().accounts({ user: me, position: posA }).rpc();
    console.log("claimed/closed A");
  };
  const claimB = async () => {
    await program.methods.claimWinnings()
      .accounts({ market: mPk, user: kb.publicKey, position: posB, systemProgram: SystemProgram.programId })
      .signers([kb]).rpc();
    await program.methods.closePosition().accounts({ user: kb.publicKey, position: posB }).signers([kb]).rpc();
    console.log("claimed/closed B");
  };

  const mFinal = await program.account.market.fetch(mPk);
  if (mFinal.winningIndex === -2) { // VOID
    await claimA(); await claimB();
  } else if (outA === mFinal.winningIndex) {
    await claimA();
  } else if (outB === mFinal.winningIndex) {
    await claimB();
  } else {
    console.log("no claims matched; winner:", mFinal.winningIndex);
  }

  const mEnd = await program.account.market.fetch(mPk);
  console.log("remaining:", mEnd.resolvedTotalPoolRemaining.toString());
})();

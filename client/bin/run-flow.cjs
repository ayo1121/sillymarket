const BN = require("bn.js");
const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { getProgram, hashQA, marketPda, posPda } = require("../lib/common.cjs");

const {
  PROGRAM_ID, CONFIG, FEE, CUT, SOL_A, OUTCOME_WIN, WANT_ADMIN
} = process.env;
if (!PROGRAM_ID || !CONFIG || !FEE) throw new Error("Set PROGRAM_ID, CONFIG, FEE");

const cut = Number(CUT ?? 320);                 // must be >= 300 by on-chain check
const solA = Number(SOL_A ?? 0.05);
const winner = Number(OUTCOME_WIN ?? 0);
const wantAdmin = WANT_ADMIN === "1";

(async () => {
  const { program, provider, anchor } = getProgram(PROGRAM_ID);
  const me = provider.wallet.publicKey;
  const cfgPk = new PublicKey(CONFIG);
  const feePk = new PublicKey(FEE);
  const now = Math.floor(Date.now()/1000);
  const cutoff = now + cut;
  const adminKey = wantAdmin ? anchor.web3.Keypair.generate() : null;

  // Create market
  const q = "one-shot flow test";
  const answers = ["Yes","No"];
  const qh = hashQA(q, answers);
  const mPk = marketPda(me, cutoff, qh, new PublicKey(PROGRAM_ID));
  await program.methods.createMarket(new BN(cutoff), Array.from(qh), q, answers, "https://example.com/img.png")
    .accounts({ creator: me, config: cfgPk, platformFeeWallet: feePk, market: mPk, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("market:", mPk.toBase58());

  // Bet A
  const posA = posPda(mPk, me, new PublicKey(PROGRAM_ID));
  await program.methods.placeBet(0, new BN(Math.floor(solA * LAMPORTS_PER_SOL)))
    .accounts({ market: mPk, user: me, position: posA, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("bet A pos:", posA.toBase58());

  // Resolve
  if (wantAdmin) {
    await program.methods.setAuthority(adminKey.publicKey).accounts({
      authority: me,
      config: cfgPk
    }).rpc();
    console.log("temporary admin set:", adminKey.publicKey.toBase58());
    // Pre-cutoff resolve using current signer as config authority
    await program.methods.resolve(winner).accounts({
      config: cfgPk,
      market: mPk,
      signer: adminKey.publicKey,
      platformFeeWallet: feePk,
      creatorWallet: me,
      systemProgram: SystemProgram.programId
    }).signers([adminKey]).rpc();
    console.log("resolved pre-cutoff as admin:", winner);
    await program.methods.setAuthority(me).accounts({
      authority: adminKey.publicKey,
      config: cfgPk
    }).signers([adminKey]).rpc();
    console.log("authority restored to:", me.toBase58());
  } else {
    const wait = Math.max(0, cutoff - Math.floor(Date.now()/1000) + 1);
    console.log("waiting seconds:", wait);
    await new Promise(r => setTimeout(r, wait * 1000));
    await program.methods.resolve(winner).accounts({
      config: cfgPk,
      market: mPk,
      signer: me,
      platformFeeWallet: feePk,
      creatorWallet: me,
      systemProgram: SystemProgram.programId
    }).rpc();
    console.log("resolved after cutoff:", winner);
  }

  // Claim and close
  await program.methods.claimWinnings()
    .accounts({ market: mPk, user: me, position: posA, systemProgram: SystemProgram.programId })
    .rpc();
  await program.methods.closePosition().accounts({ user: me, position: posA }).rpc();
  console.log("claimed and closed:", posA.toBase58());
})();

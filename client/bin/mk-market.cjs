const { getProgram, hashQA, marketPda, SystemProgram, PublicKey } = require("../lib/common.cjs");
const { PROGRAM_ID, CONFIG, FEE, Q, ANS, IMG } = process.env;
if (!PROGRAM_ID || !CONFIG || !FEE) throw new Error("Set PROGRAM_ID, CONFIG, FEE");
const { program, provider, anchor } = getProgram(PROGRAM_ID);
const creator = provider.wallet.publicKey;
const offset = Number(process.env.CUT || 900);
const cutoff = Math.floor(Date.now()/1000) + offset;
const question = Q || "Will it work?";
const answers = (ANS || "Yes,No").split(",");
const qhash = hashQA(question, answers);
const market = marketPda(creator, cutoff, qhash, new PublicKey(PROGRAM_ID));
(async () => {
  await program.methods.createMarket(new anchor.BN(cutoff), Array.from(qhash), question, answers, IMG || "https://example.com/img.png")
    .accounts({ creator, config: new PublicKey(CONFIG), platformFeeWallet: new PublicKey(FEE), market, systemProgram: SystemProgram.programId }).rpc();
  console.log(market.toBase58());
})();

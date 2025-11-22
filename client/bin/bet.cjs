const { getProgram, posPda, SystemProgram, PublicKey } = require("../lib/common.cjs");
const { PROGRAM_ID, MARKET, O, SOL } = process.env;
if (!PROGRAM_ID || !MARKET) throw new Error("Set PROGRAM_ID, MARKET");
const { program, provider, anchor } = getProgram(PROGRAM_ID);
const marketPk = new PublicKey(MARKET);
const outcome = Number(O || 0);
const lamports = Math.floor(Number(SOL || 0.05) * 1_000_000_000);
const position = posPda(marketPk, provider.wallet.publicKey, new PublicKey(PROGRAM_ID));
(async () => {
  await program.methods.placeBet(outcome, new anchor.BN(lamports))
    .accounts({ market: marketPk, user: provider.wallet.publicKey, position, systemProgram: SystemProgram.programId }).rpc();
  console.log(position.toBase58());
})();

const { getProgram, posPda, SystemProgram, PublicKey } = require("../lib/common.cjs");
const { PROGRAM_ID, MARKET } = process.env;
if (!PROGRAM_ID || !MARKET) throw new Error("Set PROGRAM_ID, MARKET");
const { program, provider } = getProgram(PROGRAM_ID);
const marketPk = new PublicKey(MARKET);
const pos = posPda(marketPk, provider.wallet.publicKey, new PublicKey(PROGRAM_ID));
(async () => {
  await program.methods.claimWinnings().accounts({ market: marketPk, user: provider.wallet.publicKey, position: pos, systemProgram: SystemProgram.programId }).rpc();
  console.log("claimed", pos.toBase58());
})();

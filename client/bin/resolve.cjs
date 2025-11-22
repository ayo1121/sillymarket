const { getProgram, SystemProgram, PublicKey } = require("../lib/common.cjs");
const { PROGRAM_ID, CONFIG, MARKET, WIN, FEE, CREATOR } = process.env;
if (!PROGRAM_ID || !CONFIG || !MARKET || !FEE || !CREATOR) throw new Error("Set PROGRAM_ID, CONFIG, MARKET, FEE, CREATOR");
const { program, provider } = getProgram(PROGRAM_ID);
(async () => {
  await program.methods.resolve(Number(WIN || 0)).accounts({
    config: new PublicKey(CONFIG),
    market: new PublicKey(MARKET),
    signer: provider.wallet.publicKey,
    platformFeeWallet: new PublicKey(FEE),
    creatorWallet: new PublicKey(CREATOR),
    systemProgram: SystemProgram.programId
  }).rpc();
  console.log("resolved", WIN || 0);
})();

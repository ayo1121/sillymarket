const { PublicKey } = require("@solana/web3.js");
const { getProgram } = require("../lib/common.cjs");

const { PROGRAM_ID, CONFIG, NEW_AUTH } = process.env;
if (!PROGRAM_ID || !CONFIG || !NEW_AUTH) throw new Error("Set PROGRAM_ID, CONFIG, NEW_AUTH");
const { program, provider } = getProgram(PROGRAM_ID);

(async () => {
  await program.methods.setAuthority(new PublicKey(NEW_AUTH)).accounts({
    authority: provider.wallet.publicKey,
    config: new PublicKey(CONFIG),
  }).rpc();
  console.log("authority set to", NEW_AUTH);
})();

const bs58 = require("bs58");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const { getProgram } = require("../lib/common.cjs");
const PROGRAM_ID = process.env.PROGRAM_ID || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb";
const WIN = Number(process.env.WIN ?? 0); // use -2 to VOID
(async () => {
  if (!process.env.CONFIG) throw new Error("Set CONFIG");
  const { program, provider } = getProgram(PROGRAM_ID);
  const me = provider.wallet.publicKey.toBase58();
  const now = Math.floor(Date.now()/1000);
  const OFFSET_CREATOR = 8, OFFSET_STATE = 88;
  const actives = await program.account.market.all([
    { memcmp: { offset: OFFSET_CREATOR, bytes: bs58.encode(provider.wallet.publicKey.toBuffer()) } },
    { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Uint8Array.of(1)) } }
  ]);
  for (const it of actives) {
    const m = it.account;
    if (Number(m.cutoffTs) > now) continue;
    try {
      await program.methods.resolve(WIN).accounts({
        config: new PublicKey(process.env.CONFIG),
        market: it.publicKey,
        signer: provider.wallet.publicKey,
        platformFeeWallet: m.platformFeeWallet,
        creatorWallet: m.creator,
        systemProgram: SystemProgram.programId
      }).rpc();
      console.log("resolved", it.publicKey.toBase58(), "win", WIN);
    } catch(e) {
      console.log("skip", it.publicKey.toBase58(), e.message || e);
    }
  }
})();

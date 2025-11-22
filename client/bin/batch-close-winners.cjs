const bs58 = require("bs58");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const { getProgram, posPda } = require("../lib/common.cjs");
const PROGRAM_ID = process.env.PROGRAM_ID || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb";
const WIN_VOID = -2, STATE_RESOLVED = 2;
(async () => {
  const { program, provider } = getProgram(PROGRAM_ID);
  const me = provider.wallet.publicKey;
  const OFFSET_CREATOR = 8, OFFSET_STATE = 88;
  const resolved = await program.account.market.all([
    { memcmp: { offset: OFFSET_CREATOR, bytes: bs58.encode(me.toBuffer()) } },
    { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Uint8Array.of(STATE_RESOLVED)) } }
  ]);
  for (const it of resolved) {
    const m = it.account;
    const pos = posPda(it.publicKey, me, new PublicKey(PROGRAM_ID));
    const p = await program.account.position.fetchNullable(pos);
    if (!p || p.claimed !== false) continue;
    const ok = (m.winningIndex === WIN_VOID) || (p.outcomeIndex === m.winningIndex);
    if (!ok) continue;
    try {
      await program.methods.claimWinnings().accounts({ market: it.publicKey, user: me, position: pos, systemProgram: SystemProgram.programId }).rpc();
      await program.methods.closePosition().accounts({ user: me, position: pos }).rpc();
      console.log("claimed+closed", it.publicKey.toBase58());
    } catch(e) {
      console.log("skip", it.publicKey.toBase58(), e.message || e);
    }
  }
})();

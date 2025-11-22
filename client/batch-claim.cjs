const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const bs58 = require("bs58");
const { PublicKey, SystemProgram } = require("@solana/web3.js");

const OFFSET_CREATOR = 8;
const OFFSET_STATE = 88;
const STATE_RESOLVED = 2;
const WIN_VOID = -2;

function posPda(market, user, programId){
  return PublicKey.findProgramAddressSync([Buffer.from("pos"), market.toBuffer(), user.toBuffer()], programId)[0];
}

(async () => {
  try {
    const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
    if (!idl.address) { idl.address = PROGRAM_ID.toBase58(); }
    const program = new anchor.Program(idl, provider);
    const user = provider.wallet.publicKey;

    const mine = await program.account.market.all([
      { memcmp: { offset: OFFSET_CREATOR, bytes: user.toBase58() } },
      { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Buffer.from([STATE_RESOLVED])) } }
    ]);

    for (const it of mine) {
      const m = it.account;
      const pos = posPda(it.publicKey, user, PROGRAM_ID);
      const p = await program.account.position.fetchNullable(pos);
      if (!p || p.claimed) { continue; }
      const ok = (m.winningIndex === WIN_VOID) || (p.outcomeIndex === m.winningIndex);
      if (!ok) { continue; }
      try {
        await program.methods.claimWinnings().accounts({
          market: it.publicKey,
          user,
          position: pos,
          systemProgram: SystemProgram.programId
        }).rpc();
        console.log("Claimed:", it.publicKey.toBase58(), "pos:", pos.toBase58());
      } catch (e) {
        console.log("Skip:", it.publicKey.toBase58(), e.message || e);
      }
    }
  } catch (err) {
    console.error("batch-claim error", err?.stack || err);
    process.exit(1);
  }
})();

const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const bs58 = require("bs58");
const { PublicKey, SystemProgram } = require("@solana/web3.js");

const OFFSET_CREATOR = 8;
const OFFSET_STATE = 88;
const STATE_ACTIVE = 1;
const AUTO_VOID_GRACE_SECS = 7 * 24 * 60 * 60;

(async () => {
  try {
    const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
    if (!idl.address) { idl.address = PROGRAM_ID.toBase58(); }
    const program = new anchor.Program(idl, provider);
    const me = provider.wallet.publicKey.toBase58();
    const now = Math.floor(Date.now() / 1000);

    const active = await program.account.market.all([
      { memcmp: { offset: OFFSET_CREATOR, bytes: me } },
      { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Buffer.from([STATE_ACTIVE])) } }
    ]);

    for (const a of active) {
      const m = a.account;
      if (Number(m.cutoffTs) + AUTO_VOID_GRACE_SECS <= now) {
        try {
          await program.methods.voidExpired().accounts({
            market: a.publicKey,
            systemProgram: SystemProgram.programId
          }).rpc();
          console.log("Voided:", a.publicKey.toBase58());
        } catch (e) {
          console.log("Skip:", a.publicKey.toBase58(), e.message || e);
        }
      }
    }
  } catch (err) {
    console.error("void-expired error", err?.stack || err);
    process.exit(1);
  }
})();

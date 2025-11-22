const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const bs58 = require("bs58");
const { PublicKey } = require("@solana/web3.js");

const OFFSET_CREATOR = 8;
const OFFSET_STATE = 88;
const STATE_ACTIVE = 1;
const STATE_RESOLVED = 2;

(async () => {
  try {
    const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
    if (!idl.address) { idl.address = PROGRAM_ID.toBase58(); }
    const program = new anchor.Program(idl, provider);
    const me = provider.wallet.publicKey.toBase58();

    const active = await program.account.market.all([
      { memcmp: { offset: OFFSET_CREATOR, bytes: me } },
      { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Buffer.from([STATE_ACTIVE])) } }
    ]);
    const resolved = await program.account.market.all([
      { memcmp: { offset: OFFSET_CREATOR, bytes: me } },
      { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Buffer.from([STATE_RESOLVED])) } }
    ]);

    console.log("Active markets:", active.length);
    for (const a of active) {
      console.log("-", a.publicKey.toBase58(), "cutoff:", a.account.cutoffTs.toString(), "created:", a.account.createdTs.toString());
    }
    console.log("Resolved markets:", resolved.length);
    for (const r of resolved.slice(0, 10)) {
      console.log("-", r.publicKey.toBase58(), "winner:", r.account.winningIndex, "remaining:", r.account.resolvedTotalPoolRemaining.toString());
    }
  } catch (err) {
    console.error("list-markets error", err?.stack || err);
    process.exit(1);
  }
})();

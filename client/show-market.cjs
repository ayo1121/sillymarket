const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");

(async () => {
  try {
    if (!process.env.MARKET) throw new Error("Set MARKET=<pubkey>");
    const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
    const MARKET = new PublicKey(process.env.MARKET);
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
    if (!idl.address) { idl.address = PROGRAM_ID.toBase58(); }
    const program = new anchor.Program(idl, provider);

    const m = await program.account.market.fetch(MARKET);
    const oc = Number(m.outcomesCount);
    const pools = Array.from(m.pools.slice(0, oc), (x) => x.toString());
    console.log("Market:", MARKET.toBase58());
    console.log(" state:", m.state, "cutoff:", m.cutoffTs.toString(), "created:", m.createdTs.toString());
    console.log(" outcomes:", oc, "winner:", m.winningIndex);
    console.log(" pools:", pools);
    console.log(" total_pool:", m.totalPool.toString(), "fees_accrued_total:", m.feesAccruedTotal.toString());
    console.log(" resolved_total_pool:", m.resolvedTotalPool.toString(), "remaining:", m.resolvedTotalPoolRemaining.toString());
    console.log(" platform_fee_wallet:", m.platformFeeWallet.toBase58(), "creator:", m.creator.toBase58());
  } catch (err) {
    console.error("show-market error", err?.stack || err);
    process.exit(1);
  }
})();

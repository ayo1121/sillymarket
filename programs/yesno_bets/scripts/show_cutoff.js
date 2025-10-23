const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { PublicKey, Connection } = anchor.web3;

(async () => {
  const [prog, market] = [process.env.PROG_ID, process.env.MARKET];
  if (!prog || !market) throw new Error("Set PROG_ID and MARKET");
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const idl = JSON.parse(fs.readFileSync("target/idl/yesno_bets.json", "utf8"));
  const program = new anchor.Program(idl, new PublicKey(prog), { connection: conn });
  const m = await program.account.market.fetch(new PublicKey(market));
  const bn = (m.cutoffTs ?? m.cutoff_ts);
  const n = (bn?.toNumber) ? bn.toNumber() : Number(bn);
  console.log(JSON.stringify({
    market,
    cutoff_ts: n,
    iso: new Date(n * 1000).toISOString(),
    resolved: m.resolved,
    winning: m.winningOutcome ?? m.winning_outcome
  }, null, 2));
})();

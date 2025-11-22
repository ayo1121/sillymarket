const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");
(async () => {
  const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json","utf8"));
  if (!idl.address) {
    idl.address = PROGRAM_ID.toBase58();
  }
  const program = new anchor.Program(idl, provider);
  if (process.env.CONFIG) {
    const cfgPk = new PublicKey(process.env.CONFIG);
    const cfg = await program.account.config.fetch(cfgPk);
    console.log("Config fee_wallet:", cfg.feeWallet.toBase58());
    console.log("Config authority :", cfg.authority.toBase58());
  }
  if (process.env.MARKET) {
    const mPk = new PublicKey(process.env.MARKET);
    const m = await program.account.market.fetch(mPk);
    console.log("Market platform_fee_wallet:", m.platformFeeWallet.toBase58());
    console.log("Market creator            :", m.creator.toBase58());
    console.log("Market state              :", m.state);
  }
})();

const fs = require("fs");
const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");
(async () => {
  const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
  const CONFIG = new PublicKey(process.env.CONFIG);
  const NEW_FEE_WALLET = new PublicKey(process.env.NEW_FEE_WALLET);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json","utf8"));
  if (!idl.address) {
    idl.address = PROGRAM_ID.toBase58();
  }
  const program = new anchor.Program(idl, provider);
  await program.methods.setFeeWallet(NEW_FEE_WALLET).accounts({
    authority: provider.wallet.publicKey,
    config: CONFIG,
    newFeeWallet: NEW_FEE_WALLET
  }).rpc();
  const cfg = await program.account.config.fetch(CONFIG);
  console.log("Updated fee_wallet ->", cfg.feeWallet.toBase58());
})();

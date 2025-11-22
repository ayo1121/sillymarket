// client/inspect-fee.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

(async () => {
  const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("IDL not on-chain");

  // New order: (idl, provider, programId). Cast to any to skip TS account name checks.
  const program: any = new anchor.Program(idl, provider, PROGRAM_ID);

  if (process.env.CONFIG) {
    const cfgPk = new PublicKey(process.env.CONFIG!);
    const cfg = await program.account.config.fetch(cfgPk);
    console.log("Config:", cfgPk.toBase58());
    console.log(" - fee_wallet:", cfg.feeWallet.toBase58());
    console.log(" - authority :", cfg.authority.toBase58());
  }

  if (process.env.MARKET) {
    const mPk = new PublicKey(process.env.MARKET!);
    const m = await program.account.market.fetch(mPk);
    console.log("Market:", mPk.toBase58());
    console.log(" - platform_fee_wallet:", m.platformFeeWallet.toBase58());
    console.log(" - creator            :", m.creator.toBase58());
    console.log(" - state              :", m.state);
  }
})();

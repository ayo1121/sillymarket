const fs = require("fs");
const bs58 = require("bs58");
const { PublicKey } = require("@solana/web3.js");
const { getProgram } = require("../lib/common.cjs");

const PROGRAM_ID = process.env.PROGRAM_ID || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb";
(async () => {
  const { program, provider } = getProgram(PROGRAM_ID);
  const me = provider.wallet.publicKey.toBase58();
  const OFFSET_CREATOR = 8, OFFSET_STATE = 88;
  const active = await program.account.market.all([
    { memcmp: { offset: OFFSET_CREATOR, bytes: bs58.encode(provider.wallet.publicKey.toBuffer()) } },
    { memcmp: { offset: OFFSET_STATE, bytes: bs58.encode(Uint8Array.of(1)) } }
  ]);
  for (const x of active) {
    const m = x.account;
    const oc = Number(m.outcomesCount);
    const pools = Array.from(m.pools.slice(0, oc), (v)=>Number(v));
    const total = pools.reduce((a,b)=>a+b,0);
    const odds = total>0 ? pools.map(p=>p/total) : pools.map(()=>0);
    const row = {
      market: x.publicKey.toBase58(),
      cutoff: Number(m.cutoffTs), created: Number(m.createdTs),
      total_pool: total, fees_accrued_total: Number(m.feesAccruedTotal),
      pools, odds
    };
    console.log(JSON.stringify(row));
  }
})();

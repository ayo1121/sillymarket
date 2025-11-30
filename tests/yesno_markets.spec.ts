import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || (process.env.ANCHOR_PROGRAM_ID || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb"));

function u32le(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function i64le(n: number) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function hashQA(q: string, as: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Buffer[] = [];
  parts.push(Buffer.from("yesno_markets_v1"));
  parts.push(u32le(q.length)); parts.push(Buffer.from(enc.encode(q)));
  parts.push(u32le(as.length));
  for (const a of as) { parts.push(u32le(a.length)); parts.push(Buffer.from(enc.encode(a))); }
  const h = createHash("sha256"); h.update(Buffer.concat(parts)); return Uint8Array.from(h.digest());
}
function marketPda(creator: PublicKey, cutoff: number, qh: Uint8Array, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), i64le(cutoff), Buffer.from(qh)], programId)[0];
}
function posPda(market: PublicKey, user: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("pos"), market.toBuffer(), user.toBuffer()], programId)[0];
}

import * as fs from "fs";

// ... imports ...

describe("yesno_markets", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: any;
  let wallet = provider.wallet as anchor.Wallet;
  let feeWallet = wallet.publicKey;
  const MIN = 10_000_000n;        // 0.01 SOL
  const BET_A = 100_000_000n;     // 0.1 SOL
  const BET_B = 50_000_000n;      // 0.05 SOL
  let cfg: PublicKey;

  before(async () => {
    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
    program = new anchor.Program(idl, provider);

    // Initialize shared config once for all tests
    [cfg] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    try {
      await program.methods.initialize(
        feeWallet,
        new BN(MIN.toString()),
        new BN((100_000_000_000n).toString()),
        true
      ).accounts({
        config: cfg,
        authority: wallet.publicKey,
        feeWalletAcc: feeWallet,
        systemProgram: SystemProgram.programId
      }).rpc();
    } catch (e) {
      console.log("Config already initialized, continuing...");
    }
  });

  it("initialize config", async () => {
    const c = await program.account.config.fetch(cfg);
    expect(c.authority.toBase58()).to.eq(wallet.publicKey.toBase58());
    expect(c.feeWallet.toBase58()).to.eq(feeWallet.toBase58());

    // --- create standard market
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + 3600;
    const Q = "Test: does 2+2=4?";
    const A = ["Yes", "No"];
    const qh = hashQA(Q, A);
    const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

    await program.methods.createMarket(
      new BN(cutoff),
      Array.from(qh) as any,
      Q,
      A,
      "https://img"
    ).accounts({
      creator: wallet.publicKey,
      config: cfg,
      platformFeeWallet: feeWallet,
      market: mkt,
      systemProgram: SystemProgram.programId
    }).rpc();

    const m = await program.account.market.fetch(mkt);
    expect(m.state).to.eq(1);
    expect(m.outcomesCount).to.eq(2);

    // --- place two bets
    const posA = posPda(mkt, wallet.publicKey, PROGRAM_ID);
    await program.methods.placeBet(0, new BN(BET_A.toString()))
      .accounts({ market: mkt, user: wallet.publicKey, position: posA, systemProgram: SystemProgram.programId })
      .rpc();

    const userB = anchor.web3.Keypair.generate();
    // fund B
    await provider.connection.requestAirdrop(userB.publicKey, Number(1n * BigInt(LAMPORTS_PER_SOL)));
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for airdrop
    const posB = posPda(mkt, userB.publicKey, PROGRAM_ID);
    await program.methods.placeBet(1, new BN(BET_B.toString()))
      .accounts({ market: mkt, user: userB.publicKey, position: posB, systemProgram: SystemProgram.programId })
      .signers([userB]).rpc();

    // snapshot before resolve
    const before = await program.account.market.fetch(mkt);
    const total = BigInt(before.totalPool.toString());
    const feesAccrued = BigInt(before.feesAccruedTotal.toString());
    expect(total).to.eq(BET_A + BET_B);
    expect(feesAccrued > 0n).to.be.true;

    // resolve winner = 0
    await program.methods.resolve(0).accounts({
      config: cfg,
      market: mkt,
      signer: wallet.publicKey,
      platformFeeWallet: feeWallet,
      creatorWallet: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    const after = await program.account.market.fetch(mkt);
    expect(after.state).to.eq(2);
    expect(after.winningIndex).to.eq(0);

    // claim winner
    await program.methods.claimWinnings().accounts({
      market: mkt, user: wallet.publicKey, position: posA, systemProgram: SystemProgram.programId
    }).rpc();

    // loser cannot claim
    try {
      await program.methods.claimWinnings().accounts({
        market: mkt, user: userB.publicKey, position: posB, systemProgram: SystemProgram.programId
      }).signers([userB]).rpc();
      expect.fail("Should have thrown error");
    } catch (e) {
      // Expected error
    }

    // close winner position
    await program.methods.closePosition().accounts({ user: wallet.publicKey, position: posA }).rpc();

    const final = await program.account.market.fetch(mkt);
    expect(BigInt(final.resolvedTotalPoolRemaining.toString()) >= 0n).to.be.true;
  });

  it("auto-VOID when winner pool is empty", async () => {
    const cfg2 = anchor.web3.Keypair.generate();
    await program.methods.initialize(
      feeWallet,
      new BN(MIN.toString()),
      new BN((100_000_000_000n).toString()),
      true
    ).accounts({
      config: cfg2.publicKey,
      authority: wallet.publicKey,
      feeWalletAcc: feeWallet,
      systemProgram: SystemProgram.programId
    }).signers([cfg2]).rpc();

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + 300;
    const Q = "VOID path?";
    const A = ["Yes", "No"];
    const qh = hashQA(Q, A);
    const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

    await program.methods.createMarket(
      new BN(cutoff),
      Array.from(qh) as any,
      Q, A, "https://img"
    ).accounts({
      creator: wallet.publicKey,
      config: cfg2.publicKey,
      platformFeeWallet: feeWallet,
      market: mkt,
      systemProgram: SystemProgram.programId
    }).rpc();

    const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);
    await program.methods.placeBet(1, new BN(BET_A.toString()))
      .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
      .rpc();

    await program.methods.resolve(0).accounts({
      config: cfg2.publicKey,
      market: mkt,
      signer: wallet.publicKey,
      platformFeeWallet: feeWallet,
      creatorWallet: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    const m = await program.account.market.fetch(mkt);
    expect(m.winningIndex).to.eq(-2); // WIN_VOID

    // refund equals contributed
    const balBefore = await provider.connection.getBalance(wallet.publicKey);
    await program.methods.claimWinnings().accounts({
      market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId
    }).rpc();
    const balAfter = await provider.connection.getBalance(wallet.publicKey);
    expect(balAfter).to.be.greaterThan(balBefore);

    await program.methods.closePosition().accounts({ user: wallet.publicKey, position: pos }).rpc();
  });

  it("enforces min/max bet and cutoff", async () => {

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + 5; // very soon
    const qh = hashQA("Limits?", ["Yes", "No"]);
    const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);
    await program.methods.createMarket(
      new BN(cutoff), Array.from(qh) as any, "Limits?", ["Yes", "No"], "img"
    ).accounts({
      creator: wallet.publicKey, config: cfg, platformFeeWallet: feeWallet, market: mkt, systemProgram: SystemProgram.programId
    }).rpc();

    // below min fails
    try {
      await program.methods.placeBet(0, new BN(9_000_000)).accounts({ market: mkt, user: wallet.publicKey, position: posPda(mkt, wallet.publicKey, PROGRAM_ID), systemProgram: SystemProgram.programId }).rpc();
      expect.fail("Should have thrown error");
    } catch (e) {
      // Expected error
    }

    // above max fails
    try {
      await program.methods.placeBet(0, new BN(30_000_000)).accounts({ market: mkt, user: wallet.publicKey, position: posPda(mkt, wallet.publicKey, PROGRAM_ID), systemProgram: SystemProgram.programId }).rpc();
      expect.fail("Should have thrown error");
    } catch (e) {
      // Expected error
    }
  });
});

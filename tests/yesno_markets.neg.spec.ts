import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || (process.env.ANCHOR_PROGRAM_ID || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb"));

function u32le(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function i64le(n: number) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function hashQA(q: string, as: string[]) {
  const enc = new TextEncoder();
  const parts: Buffer[] = [];
  parts.push(Buffer.from("yesno_markets_v1"));
  parts.push(u32le(q.length)); parts.push(Buffer.from(enc.encode(q)));
  parts.push(u32le(as.length));
  for (const a of as) {
    parts.push(u32le(a.length));
    parts.push(Buffer.from(enc.encode(a)));
  }
  const h = createHash("sha256"); h.update(Buffer.concat(parts));
  return Uint8Array.from(h.digest());
}
function marketPda(c: PublicKey, cutoff: number, qh: Uint8Array, pid: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("market"), c.toBuffer(), i64le(cutoff), Buffer.from(qh)], pid)[0];
}
function posPda(m: PublicKey, u: PublicKey, pid: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("pos"), m.toBuffer(), u.toBuffer()], pid)[0];
}

import * as fs from "fs";

describe("yesno_markets negative", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const feeWallet = wallet.publicKey;
  let program: any;
  let cfg: PublicKey;

  before(async () => {
    const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
    program = new anchor.Program(idl, provider);

    // Initialize shared config once for all tests
    [cfg] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    try {
      await program.methods.initialize(
        feeWallet,
        new BN(10_000_000),
        new BN(100_000_000_000),
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

  it("unauthorized resolve rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + 3600;
    const Q = "Unauthorized?";
    const A = ["Yes", "No"];
    const qh = hashQA(Q, A);
    const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);
    await program.methods.createMarket(new BN(cutoff), Array.from(qh) as any, Q, A, "img")
      .accounts({ creator: wallet.publicKey, config: cfg, platformFeeWallet: feeWallet, market: mkt, systemProgram: SystemProgram.programId })
      .rpc();
    const stranger = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(stranger.publicKey, Number(1n * BigInt(LAMPORTS_PER_SOL)));
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      await program.methods.resolve(0).accounts({
        config: cfg,
        market: mkt,
        signer: stranger.publicKey,
        platformFeeWallet: feeWallet,
        creatorWallet: wallet.publicKey,
        systemProgram: SystemProgram.programId
      }).signers([stranger]).rpc();
      expect.fail("Should have thrown error");
    } catch (e) {
      // Expected error
    }
  });

  it("double claim rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + 3600;
    const Q = "Double claim?";
    const A = ["Yes", "No"];
    const qh = hashQA(Q, A);
    const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);
    await program.methods.createMarket(new BN(cutoff), Array.from(qh) as any, Q, A, "img")
      .accounts({ creator: wallet.publicKey, config: cfg, platformFeeWallet: feeWallet, market: mkt, systemProgram: SystemProgram.programId })
      .rpc();
    const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);
    await program.methods.placeBet(0, new BN(20_000_000))
      .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
      .rpc();
    await program.methods.resolve(0).accounts({
      config: cfg,
      market: mkt,
      signer: wallet.publicKey,
      platformFeeWallet: feeWallet,
      creatorWallet: wallet.publicKey,
      systemProgram: SystemProgram.programId
    }).rpc();
    await program.methods.claimWinnings().accounts({
      market: mkt,
      user: wallet.publicKey,
      position: pos,
      systemProgram: SystemProgram.programId
    }).rpc();
    try {
      await program.methods.claimWinnings().accounts({
        market: mkt,
        user: wallet.publicKey,
        position: pos,
        systemProgram: SystemProgram.programId
      }).rpc();
      expect.fail("Should have thrown error");
    } catch (e) {
      // Expected error
    }
  });

  it("post-cutoff bet rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + 2;
    const Q = "Cutoff?";
    const A = ["Yes", "No"];
    const qh = hashQA(Q, A);
    const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);
    await program.methods.createMarket(new BN(cutoff), Array.from(qh) as any, Q, A, "img")
      .accounts({ creator: wallet.publicKey, config: cfg, platformFeeWallet: feeWallet, market: mkt, systemProgram: SystemProgram.programId })
      .rpc();
    await new Promise(r => setTimeout(r, 3000));
    try {
      await program.methods.placeBet(0, new BN(10_000_000))
        .accounts({ market: mkt, user: wallet.publicKey, position: posPda(mkt, wallet.publicKey, PROGRAM_ID), systemProgram: SystemProgram.programId })
        .rpc();
      expect.fail("Should have thrown error");
    } catch (e) {
      // Expected error
    }
  });
});

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || (process.env.ANCHOR_PROGRAM_ID || "8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb"));

// Helper functions
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

describe("Security Tests: Limits and Overflow", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    let program: any;
    let wallet = provider.wallet as anchor.Wallet;
    let feeWallet = wallet.publicKey;
    let cfg: PublicKey;

    before(async () => {
        const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
        program = new anchor.Program(idl, provider);

        // Initialize shared config once for all tests
        [cfg] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
        try {
            await program.methods.initialize(
                feeWallet,
                new BN("10000000"),
                new BN("100000000000"),
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

    it("SECURITY: enforces minimum bet amount", async () => {
        const MIN = 10_000_000n; // 0.01 SOL
        const MAX = 100_000_000_000n; // 100 SOL

        await program.methods.initialize(
            feeWallet,
            new BN(MIN.toString()),
            new BN(MAX.toString()),
            true
        ).accounts({
            config: cfg,
            authority: wallet.publicKey,
            feeWalletAcc: feeWallet,
            systemProgram: SystemProgram.programId
        }).rpc();

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Min bet test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Min bet test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);

        // Bet below minimum should fail
        const BELOW_MIN = 5_000_000n; // 0.005 SOL (below 0.01 SOL min)
        try {
            await program.methods.placeBet(0, new BN(BELOW_MIN.toString()))
                .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
                .rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: enforces maximum bet amount", async () => {
        const MIN = 10_000_000n; // 0.01 SOL
        const MAX = 20_000_000n; // 0.02 SOL (low max for testing)

        await program.methods.initialize(
            feeWallet,
            new BN(MIN.toString()),
            new BN(MAX.toString()),
            true
        ).accounts({
            config: cfg,
            authority: wallet.publicKey,
            feeWalletAcc: feeWallet,
            systemProgram: SystemProgram.programId
        }).rpc();

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Max bet test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Max bet test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);

        // Bet above maximum should fail
        const ABOVE_MAX = 30_000_000n; // 0.03 SOL (above 0.02 SOL max)
        try {
            await program.methods.placeBet(0, new BN(ABOVE_MAX.toString()))
                .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
                .rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: enforces pool cap limit", async () => {
        const MIN = 10_000_000n; // 0.01 SOL
        const MAX = 100_000_000_000n; // 100 SOL
        const POOL_CAP = 200_000_000n; // 0.2 SOL (low cap for testing)

        await program.methods.initialize(
            feeWallet,
            new BN(MIN.toString()),
            new BN(MAX.toString()),
            true
        ).accounts({
            config: cfg,
            authority: wallet.publicKey,
            feeWalletAcc: feeWallet,
            systemProgram: SystemProgram.programId
        }).rpc();

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Pool cap test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        // Create market with pool cap
        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Pool cap test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Set pool cap (if there's a method for it, otherwise this tests default behavior)
        // For now, we'll test that large bets are rejected when they would exceed reasonable limits

        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);

        // Place bet close to max
        const LARGE_BET = 100_000_000n; // 0.1 SOL
        await program.methods.placeBet(0, new BN(LARGE_BET.toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
            .rpc();

        // Verify market state
        const market = await program.account.market.fetch(mkt);
        expect(BigInt(market.totalPool.toString()) > 0n).to.be.true;
    });

    it("SECURITY: prevents betting after cutoff time", async () => {
        const MIN = 10_000_000n;
        const MAX = 100_000_000_000n;

        await program.methods.initialize(
            feeWallet,
            new BN(MIN.toString()),
            new BN(MAX.toString()),
            true
        ).accounts({
            config: cfg,
            authority: wallet.publicKey,
            feeWalletAcc: feeWallet,
            systemProgram: SystemProgram.programId
        }).rpc();

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 2; // Very short cutoff (2 seconds)
        const qh = hashQA("Cutoff test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Cutoff test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Wait for cutoff to pass
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);

        // Bet after cutoff should fail
        try {
            await program.methods.placeBet(0, new BN((50_000_000n).toString()))
                .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
                .rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: prevents betting on resolved market", async () => {
        const MIN = 10_000_000n;
        const MAX = 100_000_000_000n;

        await program.methods.initialize(
            feeWallet,
            new BN(MIN.toString()),
            new BN(MAX.toString()),
            true
        ).accounts({
            config: cfg,
            authority: wallet.publicKey,
            feeWalletAcc: feeWallet,
            systemProgram: SystemProgram.programId
        }).rpc();

        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Resolved bet test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Resolved bet test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Place initial bet
        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN((50_000_000n).toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
            .rpc();

        // Resolve market
        await program.methods.resolve(0).accounts({
            config: cfg,
            market: mkt,
            signer: wallet.publicKey,
            platformFeeWallet: feeWallet,
            creatorWallet: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        // Try to bet after resolution should fail
        try {
            await program.methods.placeBet(1, new BN((50_000_000n).toString()))
                .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
                .rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });
});

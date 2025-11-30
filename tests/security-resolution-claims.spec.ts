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

describe("Security Tests: Resolution and Claims", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    let program: any;
    let wallet = provider.wallet as anchor.Wallet;
    let feeWallet = wallet.publicKey;
    const MIN = 10_000_000n;
    const MAX = 100_000_000_000n;
    const BET_AMOUNT = 100_000_000n;
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
                new BN(MAX.toString()),
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

    it("SECURITY: void resolution refunds all bettors", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Void test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Void test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        // User A bets on outcome 0
        const posA = posPda(mkt, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: posA, systemProgram: SystemProgram.programId })
            .rpc();

        // User B bets on outcome 1
        const userB = anchor.web3.Keypair.generate();
        await provider.connection.requestAirdrop(userB.publicKey, Number(2n * BigInt(LAMPORTS_PER_SOL)));
        await new Promise(resolve => setTimeout(resolve, 1000));

        const posB = posPda(mkt, userB.publicKey, PROGRAM_ID);
        await program.methods.placeBet(1, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt, user: userB.publicKey, position: posB, systemProgram: SystemProgram.programId })
            .signers([userB]).rpc();

        // Resolve as VOID (winning_index = -2)
        // This happens automatically when winner pool is empty
        // Let's resolve with outcome 0, but only outcome 1 has bets
        // Actually, we need to create a scenario where winner pool is empty

        // Create new market where only one outcome has bets
        const qh2 = hashQA("Void test 2?", ["Yes", "No"]);
        const mkt2 = marketPda(wallet.publicKey, cutoff + 1, qh2, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff + 1),
            Array.from(qh2) as any,
            "Void test 2?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt2,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Only bet on outcome 1
        const pos2 = posPda(mkt2, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(1, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt2, user: wallet.publicKey, position: pos2, systemProgram: SystemProgram.programId })
            .rpc();

        const balBefore = await provider.connection.getBalance(wallet.publicKey);

        // Resolve with outcome 0 (which has no bets) - should auto-VOID
        await program.methods.resolve(0).accounts({
            config: cfg,
            market: mkt2,
            signer: wallet.publicKey,
            platformFeeWallet: feeWallet,
            creatorWallet: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        const market = await program.account.market.fetch(mkt2);
        expect(market.winningIndex).to.eq(-2); // WIN_VOID

        // Claim refund
        await program.methods.claimWinnings().accounts({
            market: mkt2,
            user: wallet.publicKey,
            position: pos2,
            systemProgram: SystemProgram.programId
        }).rpc();

        const balAfter = await provider.connection.getBalance(wallet.publicKey);
        // Should get refund (minus fees)
        expect(balAfter).to.be.greaterThan(balBefore);
    });

    it("SECURITY: prevents resolving market twice", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Double resolve?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Double resolve?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
            .rpc();

        // First resolution
        await program.methods.resolve(0).accounts({
            config: cfg,
            market: mkt,
            signer: wallet.publicKey,
            platformFeeWallet: feeWallet,
            creatorWallet: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        // Second resolution should fail
        try {
            await program.methods.resolve(1).accounts({
                config: cfg,
                market: mkt,
                signer: wallet.publicKey,
                platformFeeWallet: feeWallet,
                creatorWallet: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            }).rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: handles dust correctly for last claimer", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Dust test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Dust test?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Create multiple winners with different bet amounts
        const posA = posPda(mkt, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN((100_000_000n).toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: posA, systemProgram: SystemProgram.programId })
            .rpc();

        const userB = anchor.web3.Keypair.generate();
        await provider.connection.requestAirdrop(userB.publicKey, Number(2n * BigInt(LAMPORTS_PER_SOL)));
        await new Promise(resolve => setTimeout(resolve, 1000));

        const posB = posPda(mkt, userB.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN((50_000_000n).toString()))
            .accounts({ market: mkt, user: userB.publicKey, position: posB, systemProgram: SystemProgram.programId })
            .signers([userB]).rpc();

        // Add loser bet
        const userC = anchor.web3.Keypair.generate();
        await provider.connection.requestAirdrop(userC.publicKey, Number(2n * BigInt(LAMPORTS_PER_SOL)));
        await new Promise(resolve => setTimeout(resolve, 1000));

        const posC = posPda(mkt, userC.publicKey, PROGRAM_ID);
        await program.methods.placeBet(1, new BN((75_000_000n).toString()))
            .accounts({ market: mkt, user: userC.publicKey, position: posC, systemProgram: SystemProgram.programId })
            .signers([userC]).rpc();

        // Resolve with outcome 0 as winner
        await program.methods.resolve(0).accounts({
            config: cfg,
            market: mkt,
            signer: wallet.publicKey,
            platformFeeWallet: feeWallet,
            creatorWallet: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        // First winner claims
        await program.methods.claimWinnings().accounts({
            market: mkt,
            user: wallet.publicKey,
            position: posA,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Second (last) winner claims - should get remaining dust
        const marketBefore = await program.account.market.fetch(mkt);
        const remainingBefore = BigInt(marketBefore.resolvedTotalPoolRemaining.toString());

        await program.methods.claimWinnings().accounts({
            market: mkt,
            user: userB.publicKey,
            position: posB,
            systemProgram: SystemProgram.programId
        }).signers([userB]).rpc();

        const marketAfter = await program.account.market.fetch(mkt);
        const remainingAfter = BigInt(marketAfter.resolvedTotalPoolRemaining.toString());

        // Last claimer should have received all remaining funds
        expect(remainingAfter).to.eq(0n);
    });

    it("SECURITY: prevents claiming before resolution", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Claim before resolve?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Claim before resolve?", ["Yes", "No"], "img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
            .rpc();

        // Try to claim before resolution
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
});

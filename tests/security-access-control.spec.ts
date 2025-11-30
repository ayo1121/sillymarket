import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";
import * as fs from "fs";

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


describe("Security Tests: Access Control", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    let program: any;
    let wallet = provider.wallet as anchor.Wallet;
    let feeWallet = wallet.publicKey;
    const MIN = 10_000_000n;        // 0.01 SOL
    const MAX = 100_000_000_000n;   // 100 SOL
    const BET_AMOUNT = 100_000_000n; // 0.1 SOL
    let cfg: PublicKey;

    before(async () => {
        const idl = JSON.parse(fs.readFileSync("target/idl/yesno_markets.json", "utf8"));
        expect(idl).to.not.equal(null);
        // Cast to any to avoid type issues with constructor signature
        program = new anchor.Program(idl!, provider);

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
            // Config may already be initialized from previous test run
            console.log("Config already initialized, continuing...");
        }
    });

    it("SECURITY: initialize cannot be called twice on same config", async () => {
        // Second initialization should fail
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
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: non-creator cannot resolve market", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600; // 1 hour in future
        const Q = "Security test: non-creator resolve?";
        const A = ["Yes", "No"];
        const qh = hashQA(Q, A);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            Q, A, "https://img"
        ).accounts({
            creator: wallet.publicKey,
            config: cfg,
            platformFeeWallet: feeWallet,
            market: mkt,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Place a bet
        const pos = posPda(mkt, wallet.publicKey, PROGRAM_ID);
        await program.methods.placeBet(0, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
            .rpc();

        // Create attacker wallet
        const attacker = anchor.web3.Keypair.generate();
        await provider.connection.requestAirdrop(attacker.publicKey, Number(1n * BigInt(LAMPORTS_PER_SOL)));
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for airdrop

        // Attacker tries to resolve market
        try {
            await program.methods.resolve(0).accounts({
                config: cfg,
                market: mkt,
                signer: attacker.publicKey, // Attacker, not creator
                platformFeeWallet: feeWallet,
                creatorWallet: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            }).signers([attacker]).rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: non-winner cannot claim winnings", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Claim test?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Claim test?", ["Yes", "No"], "img"
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
        await provider.connection.requestAirdrop(userB.publicKey, Number(1n * BigInt(LAMPORTS_PER_SOL)));
        await new Promise(resolve => setTimeout(resolve, 1000));

        const posB = posPda(mkt, userB.publicKey, PROGRAM_ID);
        await program.methods.placeBet(1, new BN(BET_AMOUNT.toString()))
            .accounts({ market: mkt, user: userB.publicKey, position: posB, systemProgram: SystemProgram.programId })
            .signers([userB]).rpc();

        // Resolve with outcome 0 as winner
        await program.methods.resolve(0).accounts({
            config: cfg,
            market: mkt,
            signer: wallet.publicKey,
            platformFeeWallet: feeWallet,
            creatorWallet: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        // User B (loser) tries to claim
        try {
            await program.methods.claimWinnings().accounts({
                market: mkt,
                user: userB.publicKey,
                position: posB,
                systemProgram: SystemProgram.programId
            }).signers([userB]).rpc();
            expect.fail("Should have thrown error");
        } catch (e) {
            // Expected error
        }
    });

    it("SECURITY: double claim should fail", async () => {
        const now = Math.floor(Date.now() / 1000);
        const cutoff = now + 3600;
        const qh = hashQA("Double claim?", ["Yes", "No"]);
        const mkt = marketPda(wallet.publicKey, cutoff, qh, PROGRAM_ID);

        await program.methods.createMarket(
            new BN(cutoff),
            Array.from(qh) as any,
            "Double claim?", ["Yes", "No"], "img"
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

        // Resolve
        await program.methods.resolve(0).accounts({
            config: cfg,
            market: mkt,
            signer: wallet.publicKey,
            platformFeeWallet: feeWallet,
            creatorWallet: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        }).rpc();

        // First claim should succeed
        await program.methods.claimWinnings().accounts({
            market: mkt,
            user: wallet.publicKey,
            position: pos,
            systemProgram: SystemProgram.programId
        }).rpc();

        // Second claim should fail
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

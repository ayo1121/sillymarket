import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
const CONFIG     = new PublicKey(process.env.CONFIG!);
const MARKET     = new PublicKey(process.env.MARKET!);

// helpers
async function airdrop(conn: anchor.web3.Connection, pk: PublicKey, sol = 1) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

function posPda(market: PublicKey, user: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), market.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  )[0];
}

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("IDL missing on-chain");
  const program = new anchor.Program(idl, provider);

  // print state
  const mAcc = await (program.account as any).market.fetch(MARKET);
  console.log("Market loaded:", MARKET.toBase58(), "outcomes:", mAcc.outcomesCount, "cutoff:", mAcc.cutoffTs.toString());

  // user A = your wallet, bet on outcome 0
  const userA = wallet.payer as any; // Anchor Wallet -> Keypair-like for signing
  const posA = posPda(MARKET, wallet.publicKey);

  // user B = fresh keypair, bet on outcome 1
  const userB = Keypair.generate();
  const posB = posPda(MARKET, userB.publicKey);
  const adminSeed = createHash("sha256").update("yesno-admin").update(CONFIG.toBuffer()).digest();
  const admin = Keypair.fromSeed(adminSeed.subarray(0, 32));

  console.log("Syncing config authority to:", admin.publicKey.toBase58());
  await program.methods.setAuthority(admin.publicKey)
    .accounts({
      authority: wallet.publicKey,
      config: CONFIG,
    })
    .signers([])
    .rpc();

  const isActive = mAcc.state === 1;
  if (!isActive) {
    console.log("Market not active, skipping bet/resolve flow.");
    return;
  }

  // fund userB if needed
  const balB = await provider.connection.getBalance(userB.publicKey);
  if (balB < 0.2 * LAMPORTS_PER_SOL) {
    console.log("Airdropping 1 SOL to userB:", userB.publicKey.toBase58());
    try {
      await airdrop(provider.connection, userB.publicKey, 1);
    } catch (err) {
      console.warn("Airdrop failed, funding manually:", err);
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: userB.publicKey,
        lamports: 1 * LAMPORTS_PER_SOL,
      }));
      await provider.sendAndConfirm(tx, [wallet.payer as any]);
    }
  }

  const balBAfter = await provider.connection.getBalance(userB.publicKey);
  if (balBAfter < 0.02 * LAMPORTS_PER_SOL) {
    throw new Error("UserB still underfunded; please top up and retry.");
  }

  // --- place_bet for userA (0.05 SOL on outcome 0)
  await program.methods.placeBet(0, new BN(0.05 * LAMPORTS_PER_SOL))
    .accounts({
      market: MARKET,
      user: wallet.publicKey,
      position: posA,
      systemProgram: SystemProgram.programId,
    })
    .signers([]) // wallet signs automatically
    .rpc();
  console.log("UserA bet placed. Position:", posA.toBase58());

  // --- place_bet for userB (0.02 SOL on outcome 1)
  await program.methods.placeBet(1, new BN(0.02 * LAMPORTS_PER_SOL))
    .accounts({
      market: MARKET,
      user: userB.publicKey,
      position: posB,
      systemProgram: SystemProgram.programId,
    })
    .signers([userB])
    .rpc();
  console.log("UserB bet placed. Position:", posB.toBase58());

  // Ensure config authority != creator so we can resolve pre-cutoff
  // --- resolve immediately in favor of outcome 0 using admin_pre_cutoff = true
  // signer must match config.authority (now `admin`)
  await program.methods.resolve(0)
    .accounts({
      config: CONFIG,
      market: MARKET,
      signer: admin.publicKey,
      platformFeeWallet: mAcc.platformFeeWallet,
      creatorWallet: mAcc.creator,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();
  console.log("Resolved winner=0");

  // --- claim winner (userA). Loser (userB) will fail, so we skip.
  await program.methods.claimWinnings()
    .accounts({
      market: MARKET,
      user: wallet.publicKey,
      position: posA,
      systemProgram: SystemProgram.programId,
    })
    .signers([])
    .rpc();
  console.log("UserA claimed");

  // --- close winner position to reclaim rent
  await program.methods.closePosition()
    .accounts({
      user: wallet.publicKey,
      position: posA,
    })
    .signers([])
    .rpc();
  console.log("UserA position closed");

  // print final pool state
  const mFinal = await (program.account as any).market.fetch(MARKET);
  console.log("Remaining claimable pool:", mFinal.resolvedTotalPoolRemaining.toString());
})();

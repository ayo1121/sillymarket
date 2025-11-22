import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
const CONFIG     = new PublicKey(process.env.CONFIG!);

function leI64Bytes(n: number) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function u32le(n:number){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; }
function hashQA(q: string, as: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Buffer[] = [];
  parts.push(Buffer.from("yesno_markets_v1"));
  parts.push(u32le(q.length)); parts.push(Buffer.from(enc.encode(q)));
  parts.push(u32le(as.length));
  for (const a of as) { parts.push(u32le(a.length)); parts.push(Buffer.from(enc.encode(a))); }
  const h = createHash("sha256"); h.update(Buffer.concat(parts)); return Uint8Array.from(h.digest());
}
function posPda(market: PublicKey, user: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("pos"), market.toBuffer(), user.toBuffer()], programId)[0];
}

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("IDL not found on-chain");
  const program = new anchor.Program(idl, provider);

  const cfg = await (program.account as any).config.fetch(CONFIG);
  const adminSeed = createHash("sha256").update("void-admin").update(CONFIG.toBuffer()).digest();
  const admin = Keypair.fromSeed(adminSeed.subarray(0, 32));
  if (!cfg.authority.equals(admin.publicKey)) {
    console.log("Setting config authority to admin", admin.publicKey.toBase58());
    await program.methods.setAuthority(admin.publicKey)
      .accounts({ authority: wallet.publicKey, config: CONFIG })
      .rpc();
  }

  async function ensureLamports(pk: PublicKey, minLamports: number) {
    const bal = await provider.connection.getBalance(pk);
    if (bal >= minLamports) return;
    const needed = Math.ceil(minLamports - bal);
    try {
      const sig = await provider.connection.requestAirdrop(pk, needed);
      await provider.connection.confirmTransaction(sig, "confirmed");
      return;
    } catch (err) {
      console.warn("Airdrop failed, funding manually:", err);
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: pk,
        lamports: needed,
      }));
      await provider.sendAndConfirm(tx, [wallet.payer as any]);
    }
  }

  await ensureLamports(admin.publicKey, 0.01 * LAMPORTS_PER_SOL);

  // Create fresh market
  const now = Math.floor(Date.now()/1000);
  const cutoff = now + 900; // +15 min
  const question = "VOID test: one-sided liquidity only?";
  const answers  = ["Yes","No"];
  const imageUrl = "https://example.com/test.png";
  const qhash = hashQA(question, answers);

  // Derive market PDA = [b"market", creator, cutoff_le, question_hash]
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), wallet.publicKey.toBuffer(), leI64Bytes(cutoff), Buffer.from(qhash)],
    PROGRAM_ID
  );

  // Use fee wallet = creator
  await program.methods.createMarket(
    new BN(cutoff),
    Array.from(qhash) as any,
    question,
    answers,
    imageUrl
  ).accounts({
    creator: wallet.publicKey,
    config: CONFIG,
    platformFeeWallet: wallet.publicKey,
    market: marketPda,
    systemProgram: SystemProgram.programId
  }).rpc();
  console.log("Market:", marketPda.toBase58());

  // Place all liquidity on outcome 1 ("No"), none on outcome 0
  const pos = posPda(marketPda, wallet.publicKey, PROGRAM_ID);
  await program.methods.placeBet(1, new BN(0.05 * LAMPORTS_PER_SOL))
    .accounts({ market: marketPda, user: wallet.publicKey, position: pos, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("Bet placed on outcome 1");

  // Resolve winner=0 -> auto VOID expected because win_pool==0 and total_pool>0
  await program.methods.resolve(0).accounts({
    config: CONFIG,
    market: marketPda,
    signer: admin.publicKey,
    platformFeeWallet: wallet.publicKey,
    creatorWallet: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }).signers([admin]).rpc();
  console.log("Resolved with intended winner=0 (should auto-VOID)");

  // Claim refund
  await program.methods.claimWinnings().accounts({
    market: marketPda,
    user: wallet.publicKey,
    position: pos,
    systemProgram: SystemProgram.programId,
  }).rpc();
  console.log("Refund claimed on VOID");

  // Close position to reclaim rent
  await program.methods.closePosition().accounts({ user: wallet.publicKey, position: pos }).rpc();
  console.log("Position closed");

  const m = await (program.account as any).market.fetch(marketPda);
  console.log("Post-VOID remaining:", m.resolvedTotalPoolRemaining.toString());
})();

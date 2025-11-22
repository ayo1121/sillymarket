import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);

function leI64Bytes(n: number) {
  const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b;
}
function u32le(n:number){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; }

// Mirrors on-chain hash_question_and_answers (Solana hashv = SHA-256)
function hashQuestionAndAnswers(q: string, as: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Buffer[] = [];
  parts.push(Buffer.from("yesno_markets_v1"));
  parts.push(u32le(q.length)); parts.push(Buffer.from(enc.encode(q)));
  parts.push(u32le(as.length));
  for (const a of as) { parts.push(u32le(a.length)); parts.push(Buffer.from(enc.encode(a))); }
  const h = createHash("sha256"); h.update(Buffer.concat(parts)); return Uint8Array.from(h.digest());
}

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("IDL not found on-chain.");
  const program = new anchor.Program(idl, provider);

  // initialize
  const cfg = anchor.web3.Keypair.generate();
  const feeWallet = wallet.publicKey;
  await program.methods.initialize(
    feeWallet,
    new BN(10_000_000),          // 0.01 SOL
    new BN(100_000_000_000),     // 100 SOL
    true                                // admin_pre_cutoff
  ).accounts({
    config: cfg.publicKey,
    authority: wallet.publicKey,
    feeWalletAcc: feeWallet,
    systemProgram: SystemProgram.programId
  }).signers([cfg]).rpc();
  console.log("Config:", cfg.publicKey.toBase58());

  // create_market
  const now = Math.floor(Date.now()/1000);
  const cutoff = now + 3600;
  const question = "Will BTC close today above $70k?";
  const answers  = ["Yes","No"];
  const imageUrl = "https://example.com/img.png";
  const qhash = hashQuestionAndAnswers(question.trim(), answers.map(a=>a.trim()));

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), wallet.publicKey.toBuffer(), leI64Bytes(cutoff), Buffer.from(qhash)],
    PROGRAM_ID
  );

  await program.methods.createMarket(
    new BN(cutoff),
    Array.from(qhash) as any,
    question.trim(),
    answers.map(a=>a.trim()),
    imageUrl.trim()
  ).accounts({
    creator: wallet.publicKey,
    config: cfg.publicKey,
    platformFeeWallet: feeWallet,
    market: marketPda,
    systemProgram: SystemProgram.programId
  }).rpc();

  console.log("Market:", marketPda.toBase58());
})();

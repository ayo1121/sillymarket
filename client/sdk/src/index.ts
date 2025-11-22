import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import bs58 from "bs58";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import idlJson from "../idl/yesno_markets.json" assert { type: "json" };
import { marketPda, positionPda } from "./pdas.js";

export type YesNoIdl = typeof idlJson;
export const IDL: YesNoIdl = idlJson as YesNoIdl;

export const STATE_ACTIVE = 1;
export const STATE_RESOLVED = 2;
export const WIN_VOID = -2;

const HELIUS_RPC_URL = "https://devnet.helius-rpc.com/?api-key=837c2c48-6328-44b6-a49f-3a25e0567a96";

function getEnvWallet(): anchor.Wallet {
  try {
    return anchor.AnchorProvider.env().wallet as anchor.Wallet;
  } catch {
    throw new Error("No wallet provided and AnchorProvider.env() unavailable");
  }
}

export function getProvider(endpoint?: string, wallet?: anchor.Wallet): anchor.AnchorProvider {
  const url = endpoint ?? process.env.ANCHOR_PROVIDER_URL ?? process.env.SOLANA_RPC_URL ?? HELIUS_RPC_URL;
  const conn = new anchor.web3.Connection(url, "confirmed");
  const resolvedWallet = wallet ?? getEnvWallet();
  console.log("[yesno SDK] Using Solana RPC endpoint:", url);
  return new anchor.AnchorProvider(conn, resolvedWallet, { commitment: "confirmed" });
}

export function getProgram(programId: PublicKey, provider?: anchor.AnchorProvider): any {
  const p = provider ?? getProvider();
  return new anchor.Program(IDL as anchor.Idl, programId, p);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle digest not available");
  }
  const digest = await subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

export async function hashQA(question: string, answers: string[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const pushU32 = (arr: number[], n: number) => {
    arr.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  };
  const bytes: number[] = [];
  const prefix = enc.encode("yesno_markets_v1");
  bytes.push(...prefix);
  const qBytes = enc.encode(question);
  pushU32(bytes, qBytes.length);
  bytes.push(...qBytes);
  pushU32(bytes, answers.length);
  for (const a of answers) {
    const aBytes = enc.encode(a);
    pushU32(bytes, aBytes.length);
    bytes.push(...aBytes);
  }
  return await sha256(new Uint8Array(bytes));
}

export async function fetchConfig(programId: PublicKey, configPk: PublicKey, provider?: anchor.AnchorProvider) {
  const program = getProgram(programId, provider);
  return await program.account.config.fetch(configPk);
}

export async function fetchMarket(programId: PublicKey, marketPk: PublicKey, provider?: anchor.AnchorProvider) {
  const program = getProgram(programId, provider);
  return await program.account.market.fetch(marketPk);
}

export async function listMyMarkets(programId: PublicKey, provider?: anchor.AnchorProvider, state?: number) {
  const p = provider ?? getProvider();
  const program = getProgram(programId, p);
  const me = p.wallet.publicKey.toBase58();
  const filters: any[] = [{ memcmp: { offset: 8, bytes: me } }];
  if (state !== undefined) {
    filters.push({ memcmp: { offset: 88, bytes: bs58.encode(Uint8Array.of(state)) } });
  }
  return await program.account.market.all(filters);
}

export async function createMarket(programId: PublicKey, args: {
  cutoffTs: number;
  question: string;
  answers: string[];
  imageUrl: string;
  config: PublicKey;
  platformFeeWallet: PublicKey;
  creator: PublicKey;
}, provider?: anchor.AnchorProvider) {
  const p = provider ?? getProvider();
  const program = getProgram(programId, p);
  const qh = await hashQA(args.question, args.answers);
  const market = marketPda(args.creator, args.cutoffTs, qh, programId);
  await program.methods.createMarket(
    new BN(args.cutoffTs),
    Array.from(qh) as any,
    args.question,
    args.answers,
    args.imageUrl
  ).accounts({
    creator: args.creator,
    config: args.config,
    platformFeeWallet: args.platformFeeWallet,
    market,
    systemProgram: SystemProgram.programId
  }).rpc();
  return market;
}

export async function placeBet(
  programId: PublicKey,
  market: PublicKey,
  outcomeIndex: number,
  lamports: number,
  provider?: anchor.AnchorProvider
) {
  const p = provider ?? getProvider();
  const program = getProgram(programId, p);
  const user = p.wallet.publicKey;
  const position = positionPda(market, user, programId);
  await program.methods.placeBet(outcomeIndex, new BN(lamports)).accounts({
    market,
    user,
    position,
    systemProgram: SystemProgram.programId
  }).rpc();
  return position;
}

export async function resolve(
  programId: PublicKey,
  market: PublicKey,
  winnerIndex: number,
  accounts: { config: PublicKey; platformFeeWallet: PublicKey; creatorWallet: PublicKey },
  provider?: anchor.AnchorProvider
) {
  const p = provider ?? getProvider();
  const program = getProgram(programId, p);
  await program.methods.resolve(winnerIndex).accounts({
    config: accounts.config,
    market,
    signer: p.wallet.publicKey,
    platformFeeWallet: accounts.platformFeeWallet,
    creatorWallet: accounts.creatorWallet,
    systemProgram: SystemProgram.programId
  }).rpc();
}

export async function claim(programId: PublicKey, market: PublicKey, provider?: anchor.AnchorProvider) {
  const p = provider ?? getProvider();
  const program = getProgram(programId, p);
  const user = p.wallet.publicKey;
  const position = positionPda(market, user, programId);
  await program.methods.claimWinnings().accounts({
    market,
    user,
    position,
    systemProgram: SystemProgram.programId
  }).rpc();
}

export { marketPda, positionPda };
export const LAMPORTS = LAMPORTS_PER_SOL;

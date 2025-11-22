import { PublicKey } from "@solana/web3.js";

const te = new TextEncoder();
export const MARKET_SEED = "market";
export const POS_SEED = "pos";
const MARKET_SEED_BYTES = te.encode(MARKET_SEED);
const POS_SEED_BYTES = te.encode(POS_SEED);

export function i64le(n: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, BigInt(n), true);
  return new Uint8Array(buffer);
}

export function marketPda(
  creator: PublicKey,
  cutoffTs: number,
  questionHash: Uint8Array,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED_BYTES, creator.toBuffer(), i64le(cutoffTs), questionHash],
    programId
  )[0];
}

export function positionPda(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POS_SEED_BYTES, market.toBuffer(), user.toBuffer()],
    programId
  )[0];
}

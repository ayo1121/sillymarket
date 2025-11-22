const fs = require("fs");
const { createHash } = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = require("@solana/web3.js");

function u32le(n){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; }
function i64le(n){ const b=Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function hashQA(q, answers){
  const parts=[]; parts.push(Buffer.from("yesno_markets_v1"));
  parts.push(u32le(Buffer.byteLength(q))); parts.push(Buffer.from(q));
  parts.push(u32le(answers.length));
  for(const a of answers){ parts.push(u32le(Buffer.byteLength(a))); parts.push(Buffer.from(a)); }
  return createHash("sha256").update(Buffer.concat(parts)).digest();
}
function marketPda(creator, cutoff, qhash, programId){
  return PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), i64le(cutoff), qhash], programId)[0];
}
function posPda(market, user, programId){
  return PublicKey.findProgramAddressSync([Buffer.from("pos"), market.toBuffer(), user.toBuffer()], programId)[0];
}
function getProgram(PROGRAM_ID){
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idlPathCandidates = [
    "client/sdk/idl/yesno_markets.json",
    "target/idl/yesno_markets.json"
  ];
  let rawIdl;
  for (const p of idlPathCandidates) {
    if (fs.existsSync(p)) {
      rawIdl = JSON.parse(fs.readFileSync(p, "utf8"));
      break;
    }
  }
  if (!rawIdl) throw new Error("IDL not found");
  const programId = new PublicKey(PROGRAM_ID);
  const patchedIdl = { ...rawIdl, address: programId.toBase58() };
  const program = new anchor.Program(patchedIdl, provider);
  return { program, provider, anchor };
}
module.exports = { hashQA, marketPda, posPda, getProgram, SystemProgram, PublicKey };

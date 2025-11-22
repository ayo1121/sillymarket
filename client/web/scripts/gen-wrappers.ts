import fs from "fs";
import path from "path";
const idlPath = path.resolve("src/idl/yesno_markets.json");
const outPath = path.resolve("src/solana/wrappers.ts");
if (!fs.existsSync(idlPath)) {
  console.error("IDL not found:", idlPath);
  process.exit(0);
}
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
let out = `// Auto-generated from IDL. Do not edit.\nimport { Program, Idl, web3 } from "@coral-xyz/anchor";\nimport type { Address } from "@coral-xyz/anchor";\ntype AnyProgram = Program<Idl>;\n`;
for (const ix of idl.instructions || []) {
  const name = ix.name;
  const argsSig = (ix.args || []).map((_: any, i: number) => `arg${i}: any`).join(", ");
  out += `\nexport async function ${name}(program: AnyProgram, accounts: Record<string, Address>, ${argsSig}${argsSig ? ", " : ""}opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {\n  let b = (program.methods as any)["${name}"](${(ix.args || []).map((_: any, i: number) => `arg${i}`).join(", ")});\n  b = b.accounts(accounts);\n  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);\n  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);\n  return b.rpc({ commitment: "confirmed" });\n}\n`;
}
fs.writeFileSync(outPath, out);
console.log("Wrote", outPath);

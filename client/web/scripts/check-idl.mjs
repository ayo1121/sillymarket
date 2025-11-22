import fs from "node:fs";
const idl = JSON.parse(fs.readFileSync("src/idl/yesno_markets.json", "utf8"));

const types = new Map((idl.types || []).map((t) => [t.name, t]));
const problems = [];

function resolveType(t) {
  if (!t) return null;
  if (typeof t === "string") return { kind: "builtin" };
  if (t.defined) return types.get(t.defined) || null;
  return t;
}

for (const a of idl.accounts || []) {
  const resolved = resolveType(a.type);
  const kind = resolved?.type?.kind || resolved?.kind;
  if (kind !== "struct") {
    problems.push({ account: a.name, reason: "unresolved-or-non-struct-type", resolved });
  }
}

console.log(
  JSON.stringify(
    {
      anchor_ts_hint: "Use @coral-xyz/anchor that matches your Anchor CLI",
      idl_has_address: !!idl.address,
      accounts_count: (idl.accounts || []).length,
      bad_accounts: problems,
    },
    null,
    2
  )
);

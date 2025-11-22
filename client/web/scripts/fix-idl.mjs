import fs from "node:fs";

const p = "src/idl/yesno_markets.json";
const raw = fs.readFileSync(p, "utf8");
const idl = JSON.parse(raw);

// Map of defined struct types
const typeMap = new Map();
for (const t of idl.types || []) {
  if (t?.type?.kind === "struct") typeMap.set(t.name, t);
}

function baseName(s) { return s.replace(/(Account|State|Data)$/i, ""); }

let changed = 0, unresolved = [];
for (const a of idl.accounts || []) {
  const t = a.type;
  const isStruct = t?.kind === "struct" || (t?.defined && typeMap.get(t.defined)?.type?.kind === "struct");
  if (isStruct) continue;

  if (typeMap.has(a.name)) {
    a.type = { defined: a.name };
    changed++; continue;
  }
  const base = baseName(a.name);
  const candidates = [...typeMap.keys()].filter(k => baseName(k).toLowerCase() === base.toLowerCase());
  if (candidates.length === 1) {
    a.type = { defined: candidates[0] };
    changed++; continue;
  }
  if (t?.fields && Array.isArray(t.fields)) {
    a.type = { kind: "struct", fields: t.fields };
    changed++; continue;
  }
  unresolved.push({ account: a.name, hadType: !!t, resolved: false });
}

if (changed > 0) {
  const bak = p.replace(/\.json$/, ".bak.json");
  fs.writeFileSync(bak, raw);
  fs.writeFileSync(p, JSON.stringify(idl, null, 2));
}

console.log(JSON.stringify({ changed, unresolved, accounts: (idl.accounts||[]).map(a=>({name:a.name, hasType:!!a.type, type:a.type})) }, null, 2));

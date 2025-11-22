import React, { useState } from "react";
import { useAnchorProgram } from "../solana/program";
import idl from "../idl/yesno_markets.json";
import BN from "bn.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { computeBudgetIxs } from "../solana/tx";

function coerce(value: string, type: any): any {
  const lower = typeof type === "string" ? type.toLowerCase() : "";
  if (lower.includes("u64") || lower.includes("i64")) {
    return new BN(value || "0");
  }
  if (
    lower.includes("u32") ||
    lower.includes("i32") ||
    lower.includes("u16") ||
    lower.includes("i16") ||
    lower.includes("u8") ||
    lower.includes("i8")
  ) {
    const n = Number(value || "0");
    return Number.isFinite(n) ? n : 0;
  }
  return value;
}

export default function IDLExplorer() {
  const program = useAnchorProgram();
  const { publicKey } = useWallet();
  const [sel, setSel] = useState(0);
  const [accInputs, setAccInputs] = useState<Record<string, string>>({});
  const [argInputs, setArgInputs] = useState<Record<string, string>>({});
  const [log, setLog] = useState("");

  const instructions = (idl as any).instructions || [];
  const ix = instructions[sel];

  const onRun = async () => {
    if (!program) return;
    try {
      const method = (program.methods as any)[ix.name];
      if (!method) throw new Error("Method not found in program");
      const args = (ix.args || []).map((a: any) => coerce(argInputs[a.name] || "", a.type));
      const accounts = Object.fromEntries((ix.accounts || []).map((a: any) => [a.name, accInputs[a.name] || ""]));
      for (const k of Object.keys(accounts)) {
        if (!accounts[k] && k.toLowerCase().includes("payer") && publicKey) accounts[k] = publicKey.toBase58();
        if (!accounts[k] && k.toLowerCase() === "systemprogram") accounts[k] = "11111111111111111111111111111111";
      }
      const preIxs = computeBudgetIxs();
      const sig = await method(...args)
        .accounts(accounts)
        .preInstructions(preIxs)
        .rpc({ commitment: "confirmed" });
      setLog((prev) => `OK: ${sig}\n` + prev);
    } catch (e: any) {
      setLog((prev) => `ERR: ${e?.message || String(e)}\n` + prev);
    }
  };

  const onPrefill = () => {
    const next = { ...accInputs };
    for (const a of ix.accounts || []) {
      if (!next[a.name] && a.name.toLowerCase().includes("payer") && publicKey) next[a.name] = publicKey.toBase58();
      if (!next[a.name] && a.name.toLowerCase() === "systemprogram") next[a.name] = "11111111111111111111111111111111";
    }
    setAccInputs(next);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-medium">IDL Explorer</div>
      <select className="border rounded px-2 py-1 text-sm" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
        {instructions.map((i: any, idx: number) => (
          <option key={i.name} value={idx}>
            {i.name}
          </option>
        ))}
      </select>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold mb-1">Accounts</div>
          {(ix.accounts || []).map((a: any) => (
            <div key={a.name} className="mb-2">
              <div className="text-[11px] text-gray-500">{a.name}</div>
              <input
                className="border rounded px-2 py-1 text-sm w-full"
                placeholder="pubkey"
                value={accInputs[a.name] || ""}
                onChange={(e) => setAccInputs({ ...accInputs, [a.name]: e.target.value })}
              />
            </div>
          ))}
          <button className="border rounded px-3 py-1 text-sm" onClick={onPrefill}>
            Prefill common
          </button>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1">Args</div>
          {(ix.args || []).map((a: any) => (
            <div key={a.name} className="mb-2">
              <div className="text-[11px] text-gray-500">
                {a.name} <span className="opacity-60">{JSON.stringify(a.type)}</span>
              </div>
              <input
                className="border rounded px-2 py-1 text-sm w-full"
                placeholder="value"
                value={argInputs[a.name] || ""}
                onChange={(e) => setArgInputs({ ...argInputs, [a.name]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </div>

      <button className="border rounded px-3 py-1 text-sm" onClick={onRun}>
        Send Transaction
      </button>

      <pre className="text-[11px] overflow-x-auto bg-gray-50 p-2 rounded h-40">{log}</pre>
    </div>
  );
}

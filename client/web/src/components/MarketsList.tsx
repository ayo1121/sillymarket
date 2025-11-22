import React, { useEffect, useState } from "react";
import { useAnchorProgram } from "../solana/program";
import { fetchAllMarkets } from "../solana/read";

export default function MarketsList() {
  const program = useAnchorProgram();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!program) return;
      try {
        const all = await fetchAllMarkets(program);
        setRows(all);
      } catch (e: any) {
        setErr(e?.message || String(e));
      }
    })();
  }, [program]);

  if (!program) return <div className="p-4 text-sm">Connect wallet.</div>;
  if (err) return <div className="p-4 text-red-600 text-sm">Error: {err}</div>;
  if (!rows) return <div className="p-4 text-sm">Loading markets…</div>;

  return (
    <div className="p-4 space-y-2">
      <div className="font-medium">Markets: {rows.length}</div>
      <div className="grid md:grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.publicKey.toBase58()} className="border rounded-xl p-3">
            <a href={`/market/${r.publicKey.toBase58()}`} className="text-sm underline">
              Open
            </a>
            <div className="text-xs text-gray-500 break-all">{r.publicKey.toBase58()}</div>
            <pre className="text-[11px] overflow-x-auto mt-2 bg-gray-50 p-2 rounded">
              {JSON.stringify(r.account, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

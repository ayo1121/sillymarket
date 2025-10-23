// src/components/SweepAllButton.tsx
"use client";

import React, { useMemo, useState } from "react";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { trySendWithRebuild, buildV0Tx } from "@/lib/tx";
import { useToast } from "@/components/ui/Toast";

type Props = {
  programId: string;                // from env
  ownerPubkey: string;              // from env
  markets: string[];                // resolved market pubkeys to sweep
  // Build a single sweep_fees instruction for a given market.
  // Return null to skip a market (e.g., already swept).
  buildSweepIx: (marketPk: PublicKey) => Promise<TransactionInstruction | null>;
  initialBatchSize?: number;        // default 8
  priorityUnits?: number;           // optional compute units
  explorerBase?: string;            // optional custom explorer base
};

export default function SweepAllButton({
  programId,
  ownerPubkey,
  markets,
  buildSweepIx,
  initialBatchSize = 8,
  priorityUnits,
  explorerBase = "https://solscan.io/tx/"
}: Props) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ mk: string; status: "pending" | "ok" | "skipped" | "err"; note?: string }[]>([]);

  const isOwner = useMemo(
    () => publicKey?.toBase58() === ownerPubkey,
    [publicKey, ownerPubkey]
  );

  async function handleSweepAll() {
    if (!publicKey || !signTransaction) {
      push({ variant: "warning", message: "Connect your wallet first." });
      return;
    }
    if (!isOwner) {
      push({ variant: "error", message: "Only the OWNER can sweep fees." });
      return;
    }

    setOpen(true);
    setBusy(true);
    setRows(markets.map((mk) => ({ mk, status: "pending" as const })));

    // Build all instructions (skip nulls)
    const instrs: { mk: string; ix: TransactionInstruction }[] = [];
    for (const mk of markets) {
      try {
        const ix = await buildSweepIx(new PublicKey(mk));
        if (ix) instrs.push({ mk, ix });
        else {
          setRows((r) => r.map((row) => row.mk === mk ? { ...row, status: "skipped", note: "No fees" } : row));
        }
      } catch (e: any) {
        setRows((r) => r.map((row) => row.mk === mk ? { ...row, status: "err", note: e?.message ?? "Build failed" } : row));
      }
    }
    if (instrs.length === 0) {
      push({ variant: "warning", message: "No markets need sweeping." });
      setBusy(false);
      return;
    }

    // Adaptive batching
    let batchSize = Math.min(initialBatchSize, Math.max(1, instrs.length));
    let start = 0;

    while (start < instrs.length) {
      const slice = instrs.slice(start, Math.min(start + batchSize, instrs.length));
      const ixs = slice.map((s) => s.ix);

      const build = async () =>
        buildV0Tx(connection, ixs, {
          payer: publicKey,
          addPriorityUnits: priorityUnits,
          onBlockhash: () => {}, // you could surface this if you want
        }).then(async (tx) => {
          // sign
          const signed = await signTransaction!(tx);
          return signed;
        });

      try {
        const sig = await trySendWithRebuild(connection, build, 2);
        push({
          variant: "success",
          title: `Swept ${slice.length} market${slice.length>1?"s":""}`,
          message: `${sig.slice(0, 8)}…`,
          href: `${explorerBase}${sig}?cluster=devnet`,
        });
        // mark rows ok
        setRows((r) =>
          r.map((row) =>
            slice.find((s) => s.mk === row.mk)
              ? { ...row, status: "ok", note: "Swept" }
              : row
          )
        );
        start += batchSize;
        // Try to grow a bit if things are smooth
        if (batchSize < 16) batchSize++;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // Heuristics for “tx too large / encoding overrun”
        if (/too large|Packet too large|Transaction too large|encoding overruns|Transaction recentBlockhash required/i.test(msg) && batchSize > 1) {
          batchSize = Math.max(1, Math.floor(batchSize / 2));
          push({
            variant: "warning",
            title: "Shrinking batch",
            message: `Retrying with batch size ${batchSize}`,
          });
        } else {
          // Hard fail this batch: mark them as errors and advance
          setRows((r) =>
            r.map((row) =>
              slice.find((s) => s.mk === row.mk)
                ? { ...row, status: "err", note: msg }
                : row
            )
          );
          push({
            variant: "error",
            title: "Sweep failed",
            message: msg.slice(0, 200),
          });
          start += batchSize; // move on to avoid infinite loop
        }
      }
    }

    setBusy(false);
  }

  if (!isOwner) return null;

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleSweepAll}
        disabled={busy}
        className="rounded-2xl px-4 py-2 text-sm font-semibold shadow border
                   bg-black text-white hover:opacity-90 disabled:opacity-50
                   dark:bg-white dark:text-black"
      >
        {busy ? "Sweeping…" : "Sweep all fees"}
      </button>

      {open && (
        <div className="rounded-2xl border p-3 shadow bg-white/70 backdrop-blur dark:bg-neutral-900/60">
          <div className="mb-2 text-sm font-semibold">Sweep progress</div>
          <ul className="max-h-60 overflow-auto text-xs space-y-1">
            {rows.map((r) => (
              <li key={r.mk} className="flex items-center justify-between gap-2">
                <span className="truncate">{r.mk}</span>
                <span className={[
                  "ml-2 shrink-0 rounded-full px-2 py-0.5 border",
                  r.status === "pending" && "border-neutral-300 text-neutral-600",
                  r.status === "ok" && "border-green-500 text-green-600",
                  r.status === "skipped" && "border-amber-500 text-amber-600",
                  r.status === "err" && "border-red-500 text-red-600",
                ].filter(Boolean).join(" ")}>
                  {r.status}{r.note ? `: ${r.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

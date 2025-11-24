import React, { useState } from "react";
import { api } from "@/lib/http";

export default function UsernameModal({
  open, onOpenChange, onSubmitted
}: { open: boolean; onOpenChange: (b: boolean) => void; onSubmitted?: (u: string) => void }) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const okFmt = /^[a-z0-9_]{3,20}$/i.test(draft.trim());
  async function submit() {
    const u = draft.trim();
    if (!okFmt) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/user/username", { method: "POST", body: JSON.stringify({ username: u }) });
      onOpenChange(false);
      onSubmitted?.(u);
    } catch (e: any) {
      console.error("Username error:", e);
      if (e?.status === 409) {
        setErr("username taken");
      } else if (e?.isNetworkError || e?.message?.includes("fetch") || e?.message?.includes("Failed to fetch") || e?.name === "TypeError") {
        setErr("Cannot connect to server. Make sure the backend is running on port 8787.");
      } else if (e?.status === 401) {
        setErr("Please sign in with your wallet first");
      } else {
        setErr(e?.message || e?.data?.error || "unable to set username");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-[360px] bg-white dark:bg-[#1f1f1f] border border-[#333] dark:border-[#555] p-4 rounded-lg shadow-lg">
        <div className="font-bold mb-2 text-foreground dark:text-white">Choose a username</div>
        <input
          placeholder="e.g. ayo"
          value={draft}
          disabled={busy}
          onChange={e => { setDraft(e.target.value); setErr(null); }}
          maxLength={20}
          className="w-full border border-[#999] dark:border-[#555] p-2 rounded-md bg-white dark:bg-[#2a2a2a] text-foreground dark:text-white placeholder:text-muted-foreground"
        />
        <div className="text-xs opacity-70 mt-1.5 text-foreground dark:text-[#ccc]">3–20 chars, letters/numbers/_</div>
        {err && <div className="text-[#b00020] dark:text-red-400 text-xs mt-1.5">{err}</div>}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 p-2 rounded border border-transparent hover:bg-gray-100 dark:hover:bg-[#333] text-foreground dark:text-white transition-colors"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            disabled={!okFmt || busy}
            onClick={submit}
            className="flex-1 p-2 bg-black dark:bg-white text-white dark:text-black rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {busy ? "Saving..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

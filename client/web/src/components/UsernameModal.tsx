import React, { useState } from "react";
import { api } from "@/lib/http";

export default function UsernameModal({
  open, onOpenChange, onSubmitted
}: { open: boolean; onOpenChange:(b:boolean)=>void; onSubmitted?: (u:string)=>void }) {
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
    } catch (e:any) {
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
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:60}}>
      <div style={{width:360,background:"#fff",border:"1px solid #333",padding:16,borderRadius:8,fontFamily:"system-ui"}}>
        <div style={{fontWeight:700,marginBottom:8}}>Choose a username</div>
        <input
          placeholder="e.g. ayotrader"
          value={draft}
          disabled={busy}
          onChange={e=>{ setDraft(e.target.value); setErr(null); }}
          maxLength={20}
          style={{width:"100%",border:"1px solid #999",padding:"8px",borderRadius:6}}
        />
        <div style={{fontSize:12,opacity:.7,marginTop:6}}>3–20 chars, letters/numbers/_</div>
        {err && <div style={{color:"#b00020",fontSize:12,marginTop:6}}>{err}</div>}
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={()=>onOpenChange(false)} style={{flex:1,padding:"8px"}} disabled={busy}>Cancel</button>
          <button
            disabled={!okFmt || busy}
            onClick={submit}
            style={{flex:1,padding:"8px",background:"#000",color:"#fff"}}
          >{busy ? "Saving..." : "Continue"}</button>
        </div>
      </div>
    </div>
  );
}

"use client";
// The one-time Studio → board picker (lib/studio-import). Tap the old
// requests worth keeping; each becomes one draft card on this board. The
// last 60 days come pre-ticked. Delete with Studio.
import { useEffect, useState } from "react";
import { H, primaryBtn, ghostBtn, tag, ago } from "@/lib/studio-theme";
import type { StudioRequest } from "@/lib/studio-import";

const thumb = (id: string) => `/api/files/thumbnail?id=${id}&thumb=1&size=400`;

export function StudioImportPicker({ sheetId, onClose, onDone }: { sheetId: string; onClose: () => void; onDone: (added: number) => void }) {
  const [reqs, setReqs] = useState<StudioRequest[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/studio/line-sheets/${sheetId}/from-studio`).then(r => r.json()).then(r => {
      if (r.error) { setErr(r.error); setReqs([]); return; }
      setReqs(r.requests);
      setPicked(new Set((r.requests as StudioRequest[]).filter(q => q.recent && !q.onBoard).map(q => q.id)));
    }).catch(() => { setErr("Couldn't load the Studio requests. Try again."); setReqs([]); });
  }, [sheetId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const open = (reqs || []).filter(q => !q.onBoard);
  const already = (reqs || []).filter(q => q.onBoard);
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function bringIn() {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/studio/line-sheets/${sheetId}/from-studio`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ briefIds: [...picked] }) }).then(x => x.json());
      if (r.error) setErr(r.error); else onDone(r.added);
    } catch { setErr("Couldn't bring them in. Nothing was added; try again."); }
    finally { setBusy(false); }
  }

  const card = (q: StudioRequest, disabled: boolean) => {
    const on = picked.has(q.id);
    return (
      <button key={q.id} type="button" disabled={disabled || busy} aria-pressed={on} onClick={() => toggle(q.id)}
        style={{ textAlign: "left", padding: 0, background: H.panel, border: `2px solid ${on ? H.blue : H.line2}`, borderRadius: 12, overflow: "hidden", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, fontFamily: H.font, color: H.text }}>
        <div style={{ position: "relative", aspectRatio: "1", background: "#f4f2ee", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={thumb(q.images[0].driveId)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
          {!disabled && (
            <span aria-hidden style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: on ? H.blue : "rgba(10,10,10,.55)", border: `2px solid ${on ? H.blue : "rgba(255,255,255,.7)"}`, color: H.ink }}>
              {on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
            </span>
          )}
        </div>
        <div style={{ padding: "8px 10px 10px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.title}</div>
          <div style={{ marginTop: 3, ...tag(disabled ? H.faint : q.state === "approved" ? H.green : H.faint, 9) }}>
            {disabled ? "Already on the board" : q.state === "approved" ? "Approved · lands As is" : ago(q.updatedAt)}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div role="dialog" aria-label="Bring in from Studio" style={{ position: "fixed", inset: 0, zIndex: 300, background: H.ink, overflowY: "auto", fontFamily: H.font, color: H.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 16px 120px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ fontSize: "clamp(22px,3.5vw,34px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", flex: "1 1 260px" }}>Bring in from Studio</div>
          <button onClick={onClose} disabled={busy} style={ghostBtn}>Close</button>
        </div>
        <div style={{ fontSize: 12.5, color: H.dim, marginBottom: 18 }}>
          Tap the ones worth keeping. Each lands on the board as a draft card with its latest art; nothing shows in their hub until you publish.
        </div>
        {reqs === null && <div style={{ color: H.faint, fontSize: 13 }}>Loading their Studio requests…</div>}
        {reqs && !reqs.length && !err && <div style={{ color: H.faint, fontSize: 13 }}>This client has no Studio requests with art.</div>}
        {open.length > 0 && (
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setPicked(new Set(open.map(q => q.id)))} style={link}>Pick all {open.length}</button>
            <button onClick={() => setPicked(new Set(open.filter(q => q.recent).map(q => q.id)))} style={link}>Last 60 days</button>
            <button onClick={() => setPicked(new Set())} style={link}>None</button>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {open.map(q => card(q, false))}
        </div>
        {already.length > 0 && (<>
          <div style={{ ...tag(H.faint, 10), margin: "26px 0 10px" }}>Already on the board ({already.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>{already.map(q => card(q, true))}</div>
        </>)}
      </div>
      {reqs && open.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(10,10,10,.96)", borderTop: `1px solid ${H.line}`, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          {err && <span style={{ color: H.red, fontSize: 12 }}>{err}</span>}
          <span style={{ fontSize: 12.5, color: H.dim }}>{picked.size} of {open.length} picked</span>
          <button disabled={busy || !picked.size} onClick={bringIn} style={{ ...primaryBtn, opacity: picked.size ? 1 : 0.4 }}>{busy ? "Bringing in…" : `Bring in ${picked.size} →`}</button>
        </div>
      )}
      {err && (!reqs || !open.length) && <div style={{ color: H.red, fontSize: 12, padding: "0 16px" }}>{err}</div>}
    </div>
  );
}

const link: React.CSSProperties = { background: "none", border: "none", padding: 0, color: H.blue, cursor: "pointer", fontSize: 12, fontFamily: H.font, borderBottom: `1px dotted ${H.blue}` };

"use client";
import { useEffect, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp } from "@/lib/studio-theme";

// PLANNERS — the index (mig 190; renamed Nov 27 2026). One per client: the
// client's board of designs, with its releases underneath. No name of its
// own: it's the client's planner. Rides the /studio grant.
export default function LineSheetsPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [archived, setArchived] = useState(false);   // mig 211: archived sheets only, on demand
  useEffect(() => {
    setSheets([]);
    fetch(`/api/studio/line-sheets${archived ? "?archived=1" : ""}`).then(r => r.json()).then(j => setSheets(j.sheets || [])).catch(() => {});
  }, [archived]);
  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 20px 90px", background: H.ink, minHeight: "100vh", color: H.text, fontFamily: H.font }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}><a href="/studio" style={{ color: H.faint, textDecoration: "none" }}>‹ The studio</a></div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "6px 0 26px" }}>
        <h1 style={{ fontSize: "clamp(34px,5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0 }}>Planners.</h1>
        <button onClick={() => setShowNew(true)} style={{ ...primaryBtn, padding: "12px 22px" }}>+ New planner</button>
        <button onClick={() => setArchived(a => !a)} style={{ ...ghostBtn, marginLeft: "auto" }}>{archived ? "‹ Active planners" : "Show archived"}</button>
      </div>
      {archived && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginBottom: 12 }}>Archived · open one to unarchive</div>}
      {archived && sheets.length === 0 && <div style={{ color: H.faint, fontSize: 13 }}>No archived planners.</div>}
      {!archived && sheets.length === 0 && <div style={{ color: H.faint, fontSize: 13 }}>Nothing yet. A planner is a client&rsquo;s board of designs, presented like a webstore: they say As is, Change or Pass on each, then pull what&rsquo;s As is into a release.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
        {sheets.map(s => (
          <a key={s.id} href={`/studio/line-sheets/${s.id}`} style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 14, padding: "16px 18px", color: H.text, textDecoration: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{s.client_name}</span>
              <span style={tag(s.status === "final" ? H.green : s.current_version ? H.blue : H.amber, 9)}>{s.status === "final" ? "Final" : s.current_version ? `v${s.current_version} live` : "Draft"}</span>
            </div>
            <div style={{ fontSize: 11, color: H.dim, marginTop: 10, display: "flex", gap: 14 }}>
              <span>{s._counts.items} item{s._counts.items === 1 ? "" : "s"}</span>
              {s._counts.asis > 0 && <span style={{ color: H.green }}>{s._counts.asis} as is</span>}
              {s._counts.change > 0 && <span style={{ color: H.amber }}>{s._counts.change} to change</span>}
              {s._counts.pass > 0 && <span style={{ color: H.red }}>{s._counts.pass} passed</span>}
              <span style={{ marginLeft: "auto", fontFamily: H.mono, color: H.faint }}>{fmtStamp(s.updated_at)}</span>
            </div>
          </a>
        ))}
      </div>
      {showNew && <NewSheet onClose={() => setShowNew(false)} onCreated={(id: string) => { window.location.href = `/studio/line-sheets/${id}`; }} />}
    </div>
  );
}

function NewSheet({ onClose, onCreated }: any) {
  const [q, setQ] = useState(""); const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/lab/real-clients?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => ({}));
      setResults(r.clients || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  // one tap: the planner is the client's, so picking the client is all there is
  async function go(client: any) {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/studio/line-sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id }) }).then(x => x.json());
      if (r.sheetId) { onCreated(r.sheetId); return; }   // already has one: open it
      if (r.error) { setErr(r.error); return; }
      onCreated(r.sheet.id);
    } catch { setErr("Couldn't start it. Try again."); }
    finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 440, padding: "20px 22px", color: H.text, fontFamily: H.font }}>
        <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", marginBottom: 14 }}>New planner</div>
        <label style={lbl}>Whose?</label>
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search clients…" style={inp} />
        {results.map((c: any) => (
          <button key={c.id} disabled={busy} onClick={() => go(c)} style={{ display: "block", width: "100%", textAlign: "left", background: H.surface, border: `1px solid ${H.line2}`, borderRadius: 9, padding: "9px 12px", marginTop: 6, cursor: "pointer", fontFamily: H.font, color: H.text, fontSize: 12.5, fontWeight: 800, textTransform: "uppercase" }}>{c.name}</button>
        ))}
        {busy && <div style={{ color: H.faint, fontSize: 12, marginTop: 8 }}>Starting…</div>}
        {err && <div style={{ color: H.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp } from "@/lib/studio-theme";

// LINE SHEETS — the index (mig 190). A client-level product line worked in
// versions; standalone from the per-design lineup. Rides the /studio grant.
export default function LineSheetsPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const load = async () => { const j = await fetch("/api/studio/line-sheets").then(r => r.json()).catch(() => ({})); setSheets(j.sheets || []); };
  useEffect(() => { load(); }, []);
  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 20px 90px", background: H.ink, minHeight: "100vh", color: H.text, fontFamily: H.font }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}><a href="/studio" style={{ color: H.faint, textDecoration: "none" }}>‹ The studio</a></div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "6px 0 26px" }}>
        <h1 style={{ fontSize: "clamp(34px,5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0 }}>Line sheets.</h1>
        <button onClick={() => setShowNew(true)} style={{ ...primaryBtn, padding: "12px 22px" }}>+ New line sheet</button>
      </div>
      {sheets.length === 0 && <div style={{ color: H.faint, fontSize: 13 }}>Nothing yet. A line sheet is a client&rsquo;s whole product line — sections, items, versions — presented like a webstore.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
        {sheets.map(s => (
          <a key={s.id} href={`/studio/line-sheets/${s.id}`} style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 14, padding: "16px 18px", color: H.text, textDecoration: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{s.title}</span>
              <span style={tag(s.status === "final" ? H.green : s.current_version ? H.blue : H.amber, 9)}>{s.status === "final" ? "Final" : s.current_version ? `v${s.current_version} live` : "Draft"}</span>
            </div>
            <div style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint, marginTop: 4 }}>{s.client_name}{s.season ? ` · ${s.season}` : ""}</div>
            <div style={{ fontSize: 11, color: H.dim, marginTop: 10, display: "flex", gap: 14 }}>
              <span>{s._counts.items} item{s._counts.items === 1 ? "" : "s"}</span>
              {s._counts.thumbsUp > 0 && <span style={{ color: H.green }}>👍 {s._counts.thumbsUp}</span>}
              {s._counts.thumbsDown > 0 && <span style={{ color: H.red }}>👎 {s._counts.thumbsDown}</span>}
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
  const [client, setClient] = useState<any>(null);
  const [title, setTitle] = useState(""); const [season, setSeason] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => {
    if (!q.trim() || client) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/lab/real-clients?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => ({}));
      setResults(r.clients || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, client]);
  async function go() {
    if (!client || !title.trim()) { setErr("Pick a client and give it a title."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/studio/line-sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, title: title.trim(), season: season.trim() || null }) }).then(x => x.json());
      if (r.error) { setErr(r.error); return; }
      onCreated(r.sheet.id);
    } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 440, padding: "20px 22px", color: H.text, fontFamily: H.font }}>
        <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", marginBottom: 14 }}>New line sheet</div>
        <label style={lbl}>Client</label>
        {client ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" }}>{client.name}</span>
            <button onClick={() => { setClient(null); setQ(""); }} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, cursor: "pointer", fontFamily: H.font }}>change</button>
          </div>
        ) : (<>
          <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search clients…" style={inp} />
          {results.map((c: any) => (
            <button key={c.id} onClick={() => setClient(c)} style={{ display: "block", width: "100%", textAlign: "left", background: H.surface, border: `1px solid ${H.line2}`, borderRadius: 9, padding: "9px 12px", marginTop: 6, cursor: "pointer", fontFamily: H.font, color: H.text, fontSize: 12.5, fontWeight: 800, textTransform: "uppercase" }}>{c.name}</button>
          ))}
        </>)}
        <label style={{ ...lbl, marginTop: 12 }}>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sike Ops Line Sheet" style={inp} />
        <label style={{ ...lbl, marginTop: 12 }}>Season <span style={{ color: H.faint }}>(optional)</span></label>
        <input value={season} onChange={e => setSeason(e.target.value)} placeholder="e.g. FALL / 2026" style={inp} />
        {err && <div style={{ color: H.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button disabled={busy} onClick={go} style={{ ...primaryBtn, width: "100%", marginTop: 16, padding: "13px" }}>{busy ? "Starting…" : "Start the sheet"}</button>
      </div>
    </div>
  );
}

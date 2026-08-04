"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ThumbIcon from "@/components/ThumbIcon";

// THE STUDIO (Phase 2 of the replacement, Aug 4 2026) — the Lab's proven UX
// on the REAL tables: art_briefs + art_brief_messages + art_brief_files.
// Five states (mig 159), the message wall (client / internal), files as the
// filmstrip, thumbs rendered from file reactions, the bank footer with the
// order ask + bridged job. FOG's 41 real briefs are the launch content.
// The old /art-studio + /studio2 died with this page's arrival.
const H = { ink: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const STATE = (s: string) => s === "with_client" ? { label: "With the client", color: H.blue } : s === "approved" ? { label: "In the bank", color: H.green } : s === "shelved" ? { label: "On the shelf", color: H.faint } : s === "killed" ? { label: "Killed", color: H.red } : { label: "Your move", color: H.amber };
const GUIDE: Record<string, { tint: string; head: string; text: string }> = {
  working: { tint: H.amber, head: "It's your move", text: "Shape the design with the client. Drop a draft, or talk it through — flip a note to Internal to keep it off their screen. Send a client-visible design and it's their move." },
  with_client: { tint: H.blue, head: "It's with the client", text: "The design is in front of the client. A thumbs up opens their keep sheet (order it or bank it); a thumbs down passes on that version, with quiet exits to shelve or kill the idea. Wait, or nudge them below." },
  shelved: { tint: H.blue, head: "The client shelved it", text: "Not now, not wrong. Out of their view, parked here. Re-pitch it whenever: a client-visible note or a fresh take lands it back in their court." },
  killed: { tint: H.red, head: "The client killed it", text: "They're done exploring this one. It stays as the record. A new pitch is a new design." },
};
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function StudioPage() {
  const [briefs, setBriefs] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [showKilled, setShowKilled] = useState(false);
  const [showPiped, setShowPiped] = useState(false);
  const [clientFilter, setClientFilter] = useState("");
  const params = useSearchParams();

  const [reqs, setReqs] = useState<any[]>([]);
  const [bridging, setBridging] = useState<string | null>(null);
  const [bridged, setBridged] = useState<Record<string, { jobId: string; jobNumber: string }>>({});
  const [bridgeErr, setBridgeErr] = useState<Record<string, string>>({});
  async function loadList() {
    const [j, r] = await Promise.all([
      fetch("/api/studio/briefs").then(r => r.json()).catch(() => ({})),
      fetch("/api/lab/order-requests").then(r => r.json()).catch(() => ({})),
    ]);
    setBriefs(j.briefs || []); setReqs(r.requests || []);
  }
  async function startJob(id: string) {
    setBridging(id); setBridgeErr(e => ({ ...e, [id]: "" }));
    try {
      const r = await fetch("/api/lab/bridge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id }) }).then(x => x.json());
      if (r.error) { setBridgeErr(e => ({ ...e, [id]: r.error })); return; }
      setBridged(m => ({ ...m, [id]: { jobId: r.jobId, jobNumber: r.jobNumber } }));
    } finally { setBridging(null); }
  }
  async function reqDone(id: string) {
    await fetch("/api/lab/order-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done: true }) });
    await loadList();
  }
  async function loadDetail(id: string) { setDetail(await fetch(`/api/studio/briefs/${id}`).then(r => r.json()).catch(() => null)); }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { const b = params.get("brief"); if (b) setOpenId(b); }, [params]);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId]);
  const refresh = async () => { await loadList(); if (openId) await loadDetail(openId); };

  const buckets = [
    { key: "working", title: "Your move.", hint: "designs waiting on you", color: H.amber },
    { key: "with_client", title: "With the client.", hint: "sent, waiting on their thumbs", color: H.blue },
    { key: "approved", title: "The bank.", hint: "greenlit designs, order-ready", color: H.green },
    { key: "shelved", title: "On the shelf.", hint: "parked by the client, re-pitch whenever", color: H.faint },
  ];
  // Client filter — board convention: a select, scoping every bucket at once.
  const clientNames = Array.from(new Set(briefs.map(b => b.client_name).filter(Boolean))).sort() as string[];
  const visible = clientFilter ? briefs.filter(b => b.client_name === clientFilter) : briefs;
  const killed = visible.filter(b => b.state === "killed" && !b._job);
  const piped = visible.filter(b => b._job);
  const thumb = (id: string, size = 600) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
  const card = (b: any) => {
    const st = STATE(b.state);
    return (
      <button key={b.id} className="st-card" onClick={() => setOpenId(b.id)}>
        <div style={{ aspectRatio: "1", background: b._art ? "#fff" : H.surface, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
          {b._art ? <img src={thumb(b._art, 400)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            : <span style={{ padding: 14, fontSize: 15, fontWeight: 900, textTransform: "uppercase", color: H.dim, lineHeight: 1.15 }}>{b.title}</span>}
        </div>
        <div style={{ padding: "11px 13px 13px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{b.title || "Untitled"}</div>
          <div style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, marginTop: 4 }}>{b.client_name || "—"}</div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: st.color, marginTop: 4 }}>{st.label}{b.source === "client" ? " · they started it" : ""}</div>
        </div>
      </button>
    );
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 20px 90px", background: H.ink, minHeight: "100vh", color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .st-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px 12px}
        @media(min-width:900px){.st-grid{grid-template-columns:repeat(4,1fr);gap:22px 16px}}
        .st-card{background:${H.panel};border:1px solid ${H.line};border-radius:14px;overflow:hidden;cursor:pointer;text-align:left;color:${H.text};font-family:${H.font};padding:0;transition:transform .15s ease,border-color .15s ease;display:block;width:100%}
        .st-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .st-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:34px 14px;overflow-y:auto}
        .st-sheet{background:${H.panel};border:1px solid ${H.line};border-radius:20px;max-width:760px;width:100%;overflow:hidden}
        @media(prefers-reduced-motion:reduce){.st-card,.st-card:hover{transition:none;transform:none}}
      ` }} />

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>Everything before a job</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "6px 0 4px" }}>
        <h1 style={{ fontSize: "clamp(34px,5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0 }}>The studio.</h1>
        <button onClick={() => setShowNew(true)} style={{ ...primaryBtn, padding: "12px 22px" }}>+ Start something</button>
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={{ marginLeft: "auto", background: H.surface, border: `1px solid ${clientFilter ? "rgba(255,255,255,.45)" : H.line}`, borderRadius: 999, color: clientFilter ? H.text : H.dim, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "10px 14px", cursor: "pointer", fontFamily: H.font, outline: "none" }}>
          <option value="">All clients</option>
          {clientNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {reqs.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.amber }}>Order requests.</h2>
            <span style={{ fontSize: 10.5, color: H.faint }}>the ask is in. build the job, quote it there, then clear the card</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reqs.map((r: any) => {
              const done = bridged[r.id];
              const who = r.lab_clients?.name || r.art_briefs?.clients?.name || "—";
              const what = r.lab_threads?.title || r.art_briefs?.title || "design";
              return (
                <div key={r.id} onClick={() => { if (r.art_briefs?.id) setOpenId(r.art_briefs.id); }} style={{ background: H.panel, border: `1px solid ${H.line}`, borderLeft: `3px solid ${done ? H.green : H.amber}`, borderRadius: 12, padding: "10px 14px 10px 10px", cursor: r.art_briefs?.id ? "pointer" : "default" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#fff", flexShrink: 0 }}>
                      {r.design_file_url && <img src={r.design_file_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who} · {what}</span>
                      <span style={{ display: "block", fontSize: 11, color: H.dim, marginTop: 2 }}>{r.blank || "blank TBD"}{r.qty ? ` × ${r.qty}` : ""}{r.note ? ` · "${r.note}"` : ""}</span>
                    </span>
                    <span style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, flexShrink: 0 }}>{fmt(r.created_at)}</span>
                    {done ? (
                      <>
                        <a href={`/jobs/${done.jobId}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ ...primaryBtn, flexShrink: 0, background: H.green, color: "#08210a", textDecoration: "none", display: "inline-block" }}>✓ {done.jobNumber} · Open ↗</a>
                        <button onClick={e => { e.stopPropagation(); loadList(); }} style={{ ...ghostBtn, flexShrink: 0, border: "none", color: H.faint }}>dismiss</button>
                      </>
                    ) : (
                      <>
                        <button disabled={bridging === r.id} onClick={e => { e.stopPropagation(); startJob(r.id); }} title="Real product + job in intake, art carried" style={{ ...primaryBtn, flexShrink: 0, background: H.green, color: "#08210a", opacity: bridging === r.id ? 0.6 : 1 }}>{bridging === r.id ? "Building…" : "Start the job →"}</button>
                        <button onClick={e => { e.stopPropagation(); reqDone(r.id); }} title="Clear without the bridge — carried over by hand" style={{ ...ghostBtn, flexShrink: 0, border: "none", color: H.faint }}>clear</button>
                      </>
                    )}
                  </div>
                  {bridgeErr[r.id] && <div style={{ marginTop: 8, marginLeft: 56, fontSize: 11.5, color: H.red }}>{bridgeErr[r.id]}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {visible.length === 0 && <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>{clientFilter ? `Nothing in the studio for ${clientFilter} yet.` : "Nothing here yet. Start something."}</div>}

      {buckets.map(bk => {
        const list = visible.filter(b => b.state === bk.key && !b._job);
        if (!list.length) return null;
        return (
          <section key={bk.key} style={{ marginTop: 34 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.color }}>{bk.title}</h2>
              <span style={{ fontSize: 10.5, color: H.faint }}>{bk.hint}</span>
            </div>
            <div className="st-grid" style={bk.key === "shelved" ? { opacity: 0.6 } : undefined}>{list.map(card)}</div>
          </section>
        );
      })}

      {piped.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <button onClick={() => setShowPiped(v => !v)} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: 0 }}>
            <span style={{ color: H.green }}>✓</span> {piped.length} in the pipeline · {showPiped ? "hide" : "show"}
          </button>
          {showPiped && (
            <div className="st-grid" style={{ marginTop: 14, opacity: 0.75 }}>
              {piped.map(b => (
                <div key={b.id} style={{ position: "relative" }}>
                  {card(b)}
                  <a href={`/jobs/${b._job.id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ position: "absolute", top: 8, right: 8, background: "rgba(10,10,10,.85)", color: H.green, borderRadius: 999, padding: "5px 11px", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>{b._job.number || "job"} ↗</a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {killed.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <button onClick={() => setShowKilled(v => !v)} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: 0 }}>
            <span style={{ color: H.red }}>✕</span> {killed.length} killed · {showKilled ? "hide" : "show"}
          </button>
          {showKilled && <div className="st-grid" style={{ marginTop: 14, opacity: 0.5 }}>{killed.map(card)}</div>}
        </section>
      )}

      {detail?.brief && <div className="st-back" onClick={e => { if (e.target === e.currentTarget) setOpenId(null); }}>
        <div className="st-sheet"><BriefSheet key={detail.brief.id} detail={detail} onRefresh={refresh} onClose={() => setOpenId(null)} /></div>
      </div>}

      {showNew && <NewDesign onClose={() => setShowNew(false)} onCreated={async (id: string) => { setShowNew(false); await loadList(); setOpenId(id); }} />}
    </div>
  );
}

// ── the sheet: header · hero+filmstrip (files) · notes (messages) · composer ──
function BriefSheet({ detail, onRefresh, onClose }: any) {
  const b = detail.brief; const timeline: any[] = detail.timeline || [];
  const orderReq = detail.orderRequest;
  const st = STATE(b.state);
  const [note, setNote] = useState(""); const [vis, setVis] = useState<"client" | "internal">("client");
  const [busy, setBusy] = useState(false);
  // Order on their word — the out-of-band door ("i want this" via text).
  const [wordForm, setWordForm] = useState(false);
  const [owBlank, setOwBlank] = useState(""); const [owQty, setOwQty] = useState(""); const [owNote, setOwNote] = useState("");
  const [owErr, setOwErr] = useState("");
  async function orderOnWord() {
    if (!owBlank.trim() || !(parseInt(owQty, 10) > 0)) return; setBusy(true); setOwErr("");
    try {
      const r = await fetch(`/api/studio/briefs/${b.id}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blank: owBlank.trim(), qty: parseInt(owQty, 10), note: owNote.trim() || null }) }).then(x => x.json());
      if (r.error) { setOwErr(r.error); return; }
      setWordForm(false); setOwBlank(""); setOwQty(""); setOwNote("");
      await onRefresh();
    } finally { setBusy(false); }
  }
  const [staged, setStaged] = useState<File | null>(null);
  const [stagedUrl, setStagedUrl] = useState<string | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);

  const images = timeline.filter(t => t.kind === "file");
  const live = images.filter(f => f.reaction !== "down");
  const passed = images.filter(f => f.reaction === "down");
  const hero = images.find(f => f.id === heroId) || (live.length ? live[live.length - 1] : images[images.length - 1] || null);
  const notes = timeline.filter(t => t.kind === "note" && t.body && t.body.trim());
  const banked = (fid: string | null) => fid && b.approved_file_id && `file-${b.approved_file_id}` === fid;

  async function send() {
    if (!note.trim() && !staged) return; setBusy(true);
    try {
      const fd = new FormData();
      if (note.trim()) fd.set("body", note.trim());
      fd.set("visibility", vis);
      if (staged) fd.set("file", staged);
      await fetch(`/api/studio/briefs/${b.id}/messages`, { method: "POST", body: fd });
      setNote(""); setStaged(null); if (stagedUrl) URL.revokeObjectURL(stagedUrl); setStagedUrl(null); setHeroId(null);
      await onRefresh();
    } finally { setBusy(false); }
  }
  function onFile(f: File) { setStaged(f); setStagedUrl(URL.createObjectURL(f)); }
  async function delBrief() { if (!confirm(`Delete "${b.title}"? This removes the design and its whole thread. Can't be undone.`)) return; await fetch(`/api/studio/briefs/${b.id}`, { method: "DELETE" }); onClose(); await onRefresh(); }
  async function delFile(fileId: string) { if (!confirm("Delete this version? It comes out of the thread. Can't be undone.")) return; setBusy(true); try { await fetch(`/api/studio/files/${fileId}`, { method: "DELETE" }); setHeroId(null); await onRefresh(); } finally { setBusy(false); } }
  // Flip a version across the wall after the fact (Jon: "make an internal
  // upload visible on client side"). No state move — sharing isn't the ball.
  async function shareFile(fileId: string, share: boolean) { setBusy(true); try { await fetch(`/api/studio/files/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share }) }); await onRefresh(); } finally { setBusy(false); } }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>{b.clients?.name || "—"} · design</div>
          <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>{b.title || "Untitled"}</div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: st.color, marginTop: 4 }}>{st.label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <button onClick={delBrief} title="Delete this design" style={{ background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }} onMouseEnter={e => (e.currentTarget.style.color = H.red)} onMouseLeave={e => (e.currentTarget.style.color = H.faint)}>Delete</button>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      </div>

      {b.concept && <div style={{ margin: "6px 22px 0", fontSize: 12.5, color: H.dim, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{b.concept}</div>}

      {GUIDE[b.state] && (
        <div style={{ margin: "10px 22px 0", padding: "13px 15px", background: H.surface, border: `1px solid ${H.line}`, borderLeft: `3px solid ${GUIDE[b.state].tint}`, borderRadius: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: GUIDE[b.state].tint, marginBottom: 6 }}>{GUIDE[b.state].head}</div>
          <div style={{ fontSize: 13.5, color: H.dim, lineHeight: 1.55 }}>{GUIDE[b.state].text}</div>
        </div>
      )}

      {hero && (
        <div style={{ marginTop: 10 }}>
          <div style={{ background: "#fff", position: "relative" }}>
            <img src={hero.file_url} alt="" referrerPolicy="no-referrer" style={{ width: "100%", maxHeight: "36vh", objectFit: "contain", display: "block", margin: "0 auto", filter: hero.reaction === "down" ? "grayscale(55%)" : "none" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
            <span style={{ position: "absolute", left: 10, bottom: 8, display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.reaction === "down" ? "#b3455a" : hero.sender_role === "client" || hero.visibility === "client" || hero.reaction === "up" ? "#3c9a2e" : "#b7791f", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "4px 10px" }}>
                {banked(hero.id) ? "✓ The banked design" : hero.reaction === "down" ? <><ThumbIcon down size={10} color="#b3455a" strokeWidth={2.5} /> Client passed on this</> : hero.reaction === "up" ? <><ThumbIcon size={10} color="#3c9a2e" strokeWidth={2.5} /> Client liked this</> : hero.sender_role === "client" ? "From client" : hero.visibility === "client" ? "Client sees this" : "Internal only"}
              </span>
              {hero.file_id && hero.visibility === "internal" && <button disabled={busy} onClick={() => shareFile(hero.file_id, true)} style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: H.blue, border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontFamily: H.font, opacity: busy ? 0.5 : 1 }}>Share with client</button>}
              {hero.file_id && hero.visibility === "client" && hero.sender_role !== "client" && <button disabled={busy} onClick={() => shareFile(hero.file_id, false)} style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: H.amber, border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontFamily: H.font, opacity: busy ? 0.5 : 1 }}>Make internal</button>}
              {hero.drive_file_id && <a href={`/api/files/view/${encodeURIComponent(hero.file_name || "design.png")}?id=${hero.drive_file_id}&download=1`} onClick={e => e.stopPropagation()} style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: H.green, borderRadius: 999, padding: "4px 10px", textDecoration: "none" }}>↓ Download</a>}
              {hero.drive_link && <a href={hero.drive_link} target="_blank" rel="noreferrer" style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: "#fff", borderRadius: 999, padding: "4px 10px", textDecoration: "none" }}>Open ↗</a>}
              {hero.file_id && <button disabled={busy} onClick={() => delFile(hero.file_id)} style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: H.red, border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontFamily: H.font, opacity: busy ? 0.5 : 1 }}>Delete</button>}
            </span>
          </div>
          {(live.length > 1 || passed.length > 0) && (
            <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", overflowX: "auto", alignItems: "center" }}>
              {live.map(f => {
                const active = f.id === hero.id;
                const internal = f.visibility !== "client" && f.sender_role !== "client";
                return (
                  <button key={f.id} onClick={() => setHeroId(f.id)} style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.6, position: "relative" }}>
                    <img src={f.file_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                    {internal && <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 2px rgba(244,178,43,.75)", borderRadius: 8, pointerEvents: "none" }} />}
                    {f.reaction === "up" && <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center", pointerEvents: "none" }}><ThumbIcon size={9} color="#3c9a2e" strokeWidth={2.5} /></span>}
                  </button>
                );
              })}
              {passed.length > 0 && <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginLeft: 6 }}>Passed</span>}
              {passed.map(f => (
                <button key={f.id} onClick={() => setHeroId(f.id)} style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 8, overflow: "hidden", background: "#fff", border: f.id === hero.id ? "2px solid #fff" : `1px solid ${H.line2}`, padding: 0, cursor: "pointer", opacity: f.id === hero.id ? 0.9 : 0.4, position: "relative" }}>
                  <img src={f.file_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(70%)" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center" }}><ThumbIcon down size={9} color="#b3455a" strokeWidth={2.5} /></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "14px 22px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "34vh", overflowY: "auto" }}>
        {notes.length === 0 ? (
          <div style={{ fontSize: 13, color: H.faint, padding: "8px 0 4px", lineHeight: 1.5 }}>No notes yet. Upload a draft or drop a note below to get it going.</div>
        ) : notes.map((m: any) => {
          const mine = m.sender_role !== "client";
          const whisper = m.visibility === "internal";
          const marker = String(m.body || "").startsWith("✓") ? H.green : String(m.body || "").startsWith("✕") ? H.red : null;
          // On a banked design the footer already says it — approval markers
          // (legacy "✓ Approved…" + "✓ Banked…") would just stutter (Jon:
          // "in the bank is enough"). History stays in the DB, muted here.
          if (marker && b.state === "approved" && /approved|banked/i.test(String(m.body))) return null;
          if (marker) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: marker }}>{m.body}</div>;
          return (
            <div key={m.id} style={{
              alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%",
              background: whisper ? "rgba(244,178,43,0.09)" : mine ? "#fff" : H.surface,
              color: whisper ? H.text : mine ? H.ink : H.text,
              border: whisper ? `1px dashed rgba(244,178,43,.5)` : "none",
              borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap",
            }}>
              <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: whisper ? H.amber : mine ? "rgba(10,10,10,0.45)" : H.faint, marginBottom: 3 }}>
                {m.sender_name || m.sender_role}{whisper ? " · internal" : ""} · {fmt(m.created_at)}
              </span>
              {m.body}
            </div>
          );
        })}
      </div>

      {b.state === "approved" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: H.dim }}>
          <b style={{ color: H.green }}>✓ In the bank</b> · artwork locked{b.updated_at ? ` · ${fmt(b.updated_at)}` : ""}.
          {orderReq && !orderReq.handled_at && (
            <div style={{ marginTop: 7, color: H.amber, fontWeight: 700 }}>Order request in: {orderReq.blank || "blank TBD"}{orderReq.qty ? ` × ${orderReq.qty}` : ""}{orderReq.note ? ` · "${orderReq.note}"` : ""}. Price it and get them a quote.</div>
          )}
          {orderReq?.job_id && (
            <div style={{ marginTop: 7 }}><a href={`/jobs/${orderReq.job_id}`} target="_blank" rel="noreferrer" style={{ color: H.green, fontWeight: 800, fontSize: 12.5, textDecoration: "none" }}>✓ In the pipeline · {orderReq.jobs?.job_number || "open the job"} ↗</a></div>
          )}
          {(!orderReq || (orderReq.handled_at && !orderReq.job_id)) && !wordForm && (
            <div style={{ marginTop: 10 }}><button disabled={busy} onClick={() => setWordForm(true)} style={{ background: H.green, color: "#08210a", border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>+ Order on their word</button></div>
          )}
          {wordForm && (
            <div style={{ marginTop: 12, border: `1px dashed rgba(88,201,60,.4)`, borderRadius: 12, padding: 13 }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.green, marginBottom: 8 }}>They said the word · capture the ask, it lands on the rail</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={owBlank} onChange={e => setOwBlank(e.target.value)} autoFocus placeholder="What garment? e.g. black hoodie" style={{ ...inp, flex: 2, minWidth: 160 }} />
                <input value={owQty} onChange={e => setOwQty(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="How many" style={{ ...inp, flex: 1, minWidth: 90 }} />
              </div>
              <textarea value={owNote} onChange={e => setOwNote(e.target.value)} rows={2} placeholder='Their words, e.g. "texted 8/4: wants these for the drop"' style={{ ...inp, resize: "vertical", marginTop: 8 }} />
              {owErr && <div style={{ color: H.red, fontSize: 11.5, marginTop: 7 }}>{owErr}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button disabled={busy} onClick={() => { setWordForm(false); setOwErr(""); }} style={{ ...ghostBtn, border: "none", color: H.faint }}>Cancel</button>
                <button disabled={busy || !owBlank.trim() || !(parseInt(owQty, 10) > 0)} onClick={orderOnWord} style={{ ...primaryBtn, marginLeft: "auto", background: H.green, color: "#08210a", opacity: busy || !owBlank.trim() || !(parseInt(owQty, 10) > 0) ? 0.5 : 1 }}>Take the order →</button>
              </div>
            </div>
          )}
        </div>
      ) : b.state === "killed" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, fontSize: 13, color: H.faint }}><b style={{ color: H.red }}>✕ Killed</b> by the client · kept as the record. A new pitch is a new design.</div>
      ) : (
        <>
          {b.state === "with_client" && (
            <div style={{ padding: "12px 22px", borderTop: `1px solid ${H.line}`, background: "rgba(143,199,216,.06)", fontSize: 12.5, color: H.dim }}><b style={{ color: H.blue }}>Sent — it&rsquo;s the client&rsquo;s move.</b> Reply below to keep talking, or send another draft.</div>
          )}
          <div style={{ padding: "12px 22px 8px", borderTop: `1px solid ${H.line2}` }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={vis === "client" ? "Message the client…" : "Internal note — team only…"} style={{ width: "100%", boxSizing: "border-box", background: H.surface, border: vis === "client" ? `1px solid ${H.line}` : "1px dashed rgba(244,178,43,.6)", borderRadius: 10, color: H.text, fontSize: 13, padding: "11px 13px", outline: "none", resize: "vertical", fontFamily: H.font }} />
            {stagedUrl && (
              <div style={{ display: "inline-flex", position: "relative", marginTop: 10 }}>
                <img src={stagedUrl} alt="" style={{ maxHeight: 72, borderRadius: 8, background: "#fff", border: `1px solid ${H.line}` }} />
                <button onClick={() => { setStaged(null); if (stagedUrl) URL.revokeObjectURL(stagedUrl); setStagedUrl(null); }} aria-label="Remove attachment" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: H.ink, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>Shows</span>
                <span style={{ display: "inline-flex", border: `1px solid ${H.line}`, borderRadius: 999, background: H.ink, overflow: "hidden" }}>
                  {(["client", "internal"] as const).map((k, i) => { const on = vis === k; return <button key={k} onClick={() => setVis(k)} style={{ border: "none", borderLeft: i ? `1px solid ${H.line}` : "none", background: on ? (k === "client" ? "rgba(143,199,216,.2)" : "rgba(244,178,43,.2)") : "transparent", color: on ? (k === "client" ? H.blue : H.amber) : H.faint, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "9px 14px", cursor: "pointer", fontFamily: H.font }}>{k === "client" ? "Client-visible" : "Internal"}</button>; })}
                </span>
              </span>
              <input ref={fileIn} type="file" accept="image/*,.pdf,.ai,.psd,.eps,.svg" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
              <button disabled={!!staged} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: staged ? 0.5 : 1 }}>{staged ? "✓ Attached" : "+ Attach"}</button>
              <button disabled={busy || (!note.trim() && !staged)} onClick={send} style={{ ...primaryBtn, marginLeft: "auto", padding: "12px 24px", fontSize: 11.5, opacity: busy || (!note.trim() && !staged) ? 0.5 : 1 }}>{busy ? "Sending…" : vis === "client" ? "Send to client" : "Post internal"}</button>
            </div>
          </div>
          <div style={{ padding: "0 22px 16px", fontSize: 10.5, color: H.faint, textAlign: "center", lineHeight: 1.5 }}>Send a <b style={{ color: H.dim }}>Client-visible</b> design and it&rsquo;s the client&rsquo;s move.</div>
        </>
      )}
    </>
  );
}

// ── Start something: real client picker (search-first) + title + kickoff ──
function NewDesign({ onClose, onCreated }: any) {
  const [q, setQ] = useState(""); const [results, setResults] = useState<any[]>([]);
  const [client, setClient] = useState<any>(null);
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => {
    if (!q.trim() || client) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/lab/real-clients?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => ({}));
      if (r.error) setErr(r.error); else { setErr(""); setResults(r.clients || []); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, client]);
  async function go() {
    if (!client || !title.trim()) { setErr("Pick a client and give it a title."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/studio/briefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, title: title.trim(), concept: body.trim() || null }) }).then(x => x.json());
      if (r.error) { setErr(r.error); return; }
      onCreated(r.brief.id);
    } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 480, padding: "20px 22px", color: H.text, fontFamily: H.font }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Start something</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: H.faint, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <label style={lbl}>Client</label>
        {client ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase" }}>{client.name}</span>
            {client.is_lead && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.amber }}>Lead</span>}
            <button onClick={() => { setClient(null); setQ(""); }} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, cursor: "pointer", fontFamily: H.font }}>change</button>
          </div>
        ) : (
          <>
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search your real clients…" style={inp} />
            {results.map((c: any) => (
              <button key={c.id} onClick={() => setClient(c)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, background: H.surface, border: `1px solid ${H.line2}`, borderRadius: 9, padding: "9px 12px", marginTop: 6, cursor: "pointer", fontFamily: H.font, color: H.text }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase" }}>{c.name}</span>
                {c.is_lead && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.amber }}>Lead</span>}
              </button>
            ))}
          </>
        )}
        <label style={{ ...lbl, marginTop: 12 }}>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Album Art" style={inp} />
        <label style={{ ...lbl, marginTop: 12 }}>Kickoff note <span style={{ color: H.faint }}>(optional — stays internal until you share)</span></label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="What are we making?" style={{ ...inp, resize: "vertical" }} />
        {err && <div style={{ color: H.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button disabled={busy} onClick={go} style={{ ...primaryBtn, width: "100%", marginTop: 16, padding: "13px" }}>{busy ? "Starting…" : "Start the design"}</button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: H.text, border: `1px solid ${H.line}`, borderRadius: 999, padding: "10px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 9, color: H.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: H.font };
const lbl: React.CSSProperties = { display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 6 };

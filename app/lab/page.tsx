"use client";
import { useEffect, useRef, useState } from "react";
import ThumbIcon from "@/components/ThumbIcon";

// THE LAB · STUDIO (HPD) — built to LOOK like the real studio2: a magazine feed
// of design cards → a sheet modal. Same chrome, same buttons, same composer, so
// the team learns the daily UI. Two actions in the sheet: MOVE IT / TALK.
const H = { ink: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", purple: "#fd3aa3", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const NAMES = ["Jon", "Drake", "Taylor", "Corey"];
const STATE = (s: string) => s === "with_client" ? { label: "With the client", color: H.blue } : s === "approved" ? { label: "In the bank", color: H.green } : s === "shelved" ? { label: "On the shelf", color: H.faint } : s === "killed" ? { label: "Killed", color: H.red } : { label: "Your move", color: H.amber };
// Readable process guidance per state — the lab teaches the flow, so this stays
// visible in plain words, not tiny labels (Jon, Jul 23).
const GUIDE: Record<string, { tint: string; head: string; text: string }> = {
  working: { tint: H.amber, head: "It's your move", text: "This is where you shape the design with the client. Drop a draft, or talk it through — flip a note to Internal to keep it off their screen while you and the designer work. When the artwork is right, send it over for their sign-off." },
  with_client: { tint: H.blue, head: "It's with the client", text: "The design is in front of the client, social-style. A thumbs up opens their keep sheet: order it (blank + qty land on the requests rail) or bank it. A thumbs down passes on that version, with two quiet exits for the whole idea: shelve or kill. Nothing to do but wait, or give them a nudge below." },
  shelved: { tint: H.blue, head: "The client shelved it", text: "Not now, not wrong. It's out of their view and parked here. Re-pitch it whenever: send a client-visible note or a fresh take and it lands back in their court." },
  killed: { tint: H.red, head: "The client killed it", text: "They're done exploring this one. It stays as the record. A new pitch is a new design." },
};
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
// Room 2 — what we can ask a designer for (mockups are internal, never here).
const WO_TYPES = [
  { id: "creative", label: "Creative art", blurb: "Draw it from scratch" },
  { id: "vector", label: "Vector clean-up", blurb: "Clean an existing file" },
  { id: "separations", label: "Separations", blurb: "Split into print colors" },
];
const WSTATE = (s: string) => s === "delivered" ? { label: "Delivered", color: H.blue } : s === "in_revision" ? { label: "In revision", color: H.amber } : s === "accepted" ? { label: "Accepted", color: H.green } : { label: "Out", color: H.faint };

async function uploadImage(file: File): Promise<{ url: string; name: string }> {
  const s = await fetch("/api/lab/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) });
  const j = await s.json(); if (!s.ok) throw new Error(j.error || "Upload failed");
  const put = await fetch(j.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" } });
  if (!put.ok) throw new Error("Upload failed");
  return { url: j.publicUrl, name: file.name };
}

export default function LabStudio() {
  const [me, setMe] = useState("");
  const [threads, setThreads] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [showClients, setShowClients] = useState(false);
  const [reqs, setReqs] = useState<any[]>([]);
  const [showKilled, setShowKilled] = useState(false);

  useEffect(() => { setMe(localStorage.getItem("lab_me") || "Jon"); }, []);
  useEffect(() => { if (me) localStorage.setItem("lab_me", me); }, [me]);

  async function loadList() {
    const [t, c, r] = await Promise.all([
      fetch("/api/lab/threads").then(r => r.json()).catch(() => ({})),
      fetch("/api/lab/clients").then(r => r.json()).catch(() => ({})),
      fetch("/api/lab/order-requests").then(r => r.json()).catch(() => ({})),
    ]);
    setThreads(t.threads || []); setClients(c.clients || []); setReqs(r.requests || []);
  }
  async function reqDone(id: string) {
    await fetch("/api/lab/order-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done: true }) });
    await loadList();
  }
  // THE BRIDGE — one tap runs the four hops: real client, brief promotion,
  // files to Drive, product + job in intake. Success is a LINK, never an
  // auto-open: window.open after an await has lost the click's trust and
  // browsers block it as a pop-up (Jon hit exactly that).
  const [bridging, setBridging] = useState<string | null>(null);
  const [bridged, setBridged] = useState<Record<string, { jobId: string; jobNumber: string }>>({});
  const [bridgeErr, setBridgeErr] = useState<Record<string, string>>({});
  async function startJob(id: string) {
    setBridging(id); setBridgeErr(e => ({ ...e, [id]: "" }));
    try {
      const r = await fetch("/api/lab/bridge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id }) }).then(x => x.json());
      if (r.error) { setBridgeErr(e => ({ ...e, [id]: r.error })); return; }
      setBridged(m => ({ ...m, [id]: { jobId: r.jobId, jobNumber: r.jobNumber } }));
    } finally { setBridging(null); }
  }
  async function loadDetail(id: string) { setDetail(await fetch(`/api/lab/threads/${id}`).then(r => r.json())); }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId]);
  const refresh = async () => { await loadList(); if (openId) await loadDetail(openId); };

  const buckets = [
    { key: "working", title: "Your move.", hint: "designs waiting on you", color: H.amber },
    { key: "with_client", title: "With the client.", hint: "sent, waiting on their thumbs", color: H.blue },
    { key: "approved", title: "The bank.", hint: "greenlit designs, order-ready", color: H.green },
    { key: "shelved", title: "On the shelf.", hint: "parked by the client, re-pitch whenever", color: H.faint },
  ];
  const artOf = (t: any) => t._art || null;
  const killed = threads.filter(t => t.state === "killed");
  const card = (t: any) => {
    const st = STATE(t.state); const art = artOf(t);
    return (
      <button key={t.id} className="sv-card" onClick={() => setOpenId(t.id)}>
        <div style={{ aspectRatio: "1", background: art ? "#fff" : H.surface, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
          {art ? <img src={art} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            : <span style={{ padding: 14, fontSize: 15, fontWeight: 900, textTransform: "uppercase", color: H.dim, lineHeight: 1.15 }}>{t.title}</span>}
        </div>
        <div style={{ padding: "11px 13px 13px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{t.title}</div>
          <div style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, marginTop: 4 }}>{t.lab_clients?.name || "—"}</div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: st.color, marginTop: 4 }}>{st.label}{t.initiated_by === "client" ? " · they started it" : ""}</div>
        </div>
      </button>
    );
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 20px 90px" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .sv-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px 12px}
        @media(min-width:900px){.sv-grid{grid-template-columns:repeat(4,1fr);gap:22px 16px}}
        .sv-card{background:${H.panel};border:1px solid ${H.line};border-radius:14px;overflow:hidden;cursor:pointer;text-align:left;color:${H.text};font-family:${H.font};padding:0;transition:transform .15s ease,border-color .15s ease;display:block;width:100%}
        .sv-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .sv-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:34px 14px;overflow-y:auto}
        .sv-sheet{background:${H.panel};border:1px solid ${H.line};border-radius:20px;max-width:760px;width:100%;overflow:hidden}
        @media(prefers-reduced-motion:reduce){.sv-card,.sv-card:hover{transition:none;transform:none}}
      ` }} />

      {/* header — mirrors studio2 */}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>The Lab · sandbox · internal</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "6px 0 4px" }}>
        <h1 style={{ fontSize: "clamp(34px,5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0 }}>The studio.</h1>
        <button onClick={() => setShowNew(true)} style={{ ...primaryBtn, padding: "12px 22px" }}>+ Start something</button>
        <button onClick={() => setShowClients(true)} style={{ ...ghostBtn }}>Clients &amp; links</button>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint }}>You are</span>
          {NAMES.map(n => <button key={n} onClick={() => setMe(n)} style={pill(me === n)}>{n}</button>)}
        </span>
      </div>

      {threads.length === 0 && <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>No designs yet. Start something, or share a client link and let them submit.</div>}

      {/* the Order requests rail — the ask is in; price it, quote them, mark it done */}
      {reqs.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.amber }}>Order requests.</h2>
            <span style={{ fontSize: 10.5, color: H.faint }}>the ask is in. build the job, quote it there, then clear the card</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reqs.map((r: any) => { const done = bridged[r.id]; return (
              <div key={r.id} onClick={() => setOpenId(r.lab_threads?.id || r.thread_id)} style={{ background: H.panel, border: `1px solid ${H.line}`, borderLeft: `3px solid ${done ? H.green : H.amber}`, borderRadius: 12, padding: "10px 14px 10px 10px", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#fff", flexShrink: 0 }}>
                    {r.design_file_url && <img src={r.design_file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.lab_clients?.name || "—"} · {r.lab_threads?.title || "design"}</span>
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
                      <button disabled={bridging === r.id} onClick={e => { e.stopPropagation(); startJob(r.id); }} title="Real client + brief + product + job in intake, art carried" style={{ ...primaryBtn, flexShrink: 0, background: H.green, color: "#08210a", opacity: bridging === r.id ? 0.6 : 1 }}>{bridging === r.id ? "Building…" : "Start the job →"}</button>
                      <button onClick={e => { e.stopPropagation(); reqDone(r.id); }} title="Clear without the bridge — carried over by hand" style={{ ...ghostBtn, flexShrink: 0, border: "none", color: H.faint }}>clear</button>
                    </>
                  )}
                </div>
                {bridgeErr[r.id] && <div style={{ marginTop: 8, marginLeft: 56, fontSize: 11.5, color: H.red }}>{bridgeErr[r.id]}</div>}
              </div>
            ); })}
          </div>
        </section>
      )}

      {buckets.map(bk => {
        const list = threads.filter(t => t.state === bk.key);
        if (!list.length) return null;
        return (
          <section key={bk.key} style={{ marginTop: 34 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.color }}>{bk.title}</h2>
              <span style={{ fontSize: 10.5, color: H.faint }}>{bk.hint}</span>
            </div>
            <div className="sv-grid" style={bk.key === "shelved" ? { opacity: 0.6 } : undefined}>
              {list.map(card)}
            </div>
          </section>
        );
      })}

      {/* killed — the record, collapsed to a line. No graveyard rail. */}
      {killed.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <button onClick={() => setShowKilled(v => !v)} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: 0 }}>
            <span style={{ color: H.red }}>✕</span> {killed.length} killed · {showKilled ? "hide" : "show"}
          </button>
          {showKilled && <div className="sv-grid" style={{ marginTop: 14, opacity: 0.5 }}>{killed.map(card)}</div>}
        </section>
      )}

      {detail && <div className="sv-back" onClick={e => { if (e.target === e.currentTarget) setOpenId(null); }}>
        <div className="sv-sheet"><ThreadPanel key={detail.thread.id} detail={detail} me={me} onRefresh={refresh} onClose={() => setOpenId(null)} /></div>
      </div>}

      {showNew && <NewDesign clients={clients} me={me} onClose={() => setShowNew(false)} onCreated={async (id: string) => { setShowNew(false); await loadList(); setOpenId(id); }} onNeedClients={loadList} />}
      {showClients && <ClientsPanel clients={clients} onClose={() => setShowClients(false)} onChanged={loadList} />}
    </div>
  );
}

// ── the sheet body: header · hero · thread · MOVE IT / TALK (mirrors OpsBriefSheet) ──
function ThreadPanel({ detail, me, onRefresh, onClose }: any) {
  const t = detail.thread; const msgs = detail.messages || [];
  const st = STATE(t.state);
  const orderReq = detail.orderRequest;
  const [note, setNote] = useState(""); const [vis, setVis] = useState<"client" | "internal">("client");
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const [staged, setStaged] = useState<{ url: string; name: string } | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);
  // Room 2 — designer work orders for this design.
  const [wos, setWos] = useState<any[]>([]);
  const [woBuilder, setWoBuilder] = useState(false);
  const [openWoId, setOpenWoId] = useState<string | null>(null);
  async function loadWos() { const j = await fetch(`/api/lab/work-orders?threadId=${t.id}`).then(r => r.json()).catch(() => ({})); setWos(j.workOrders || []); }
  useEffect(() => { loadWos(); /* eslint-disable-next-line */ }, [t.id]);
  // Latest drop is the hero; every earlier drop is a filmstrip thumb (old → new).
  // Images live in the strip; the thread carries the words (mirrors studio2).
  const images = msgs.filter((m: any) => m.file_url);
  const hero = images.length ? images[heroIdx == null ? images.length - 1 : Math.min(heroIdx, images.length - 1)] : null;
  const notes = msgs.filter((m: any) => m.body && m.body.trim());
  // One composer, like email: type + optionally attach → Send. Attaching stages
  // the file (a preview); Send posts the note + attachment together. Sending
  // Client-visible hands the thread to the client — the state flips server-side.
  async function send() {
    if (!note.trim() && !staged) return; setBusy(true);
    try { await fetch(`/api/lab/threads/${t.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: me, body: note.trim() || null, visibility: vis, fileUrl: staged?.url || null, fileName: staged?.name || null }) }); setNote(""); setStaged(null); setHeroIdx(null); await onRefresh(); } finally { setBusy(false); }
  }
  async function onFile(f: File) { setUploading(true); try { setStaged(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function del() { if (!confirm(`Delete "${t.title}"? This removes the design and its whole thread. Can't be undone.`)) return; await fetch(`/api/lab/threads/${t.id}`, { method: "DELETE" }); onClose(); await onRefresh(); }
  async function delAttachment(msgId: string) { if (!confirm("Delete this attachment? It comes out of the thread. Can't be undone.")) return; setBusy(true); try { await fetch(`/api/lab/messages/${msgId}`, { method: "DELETE" }); setHeroIdx(null); await onRefresh(); } finally { setBusy(false); } }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>{t.lab_clients?.name || "—"} · design</div>
          <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>{t.title}</div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: st.color, marginTop: 4 }}>{st.label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <button onClick={del} title="Delete this design" style={{ background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }} onMouseEnter={e => (e.currentTarget.style.color = H.red)} onMouseLeave={e => (e.currentTarget.style.color = H.faint)}>Delete</button>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      </div>

      {GUIDE[t.state] && (
        <div style={{ margin: "4px 22px 0", padding: "13px 15px", background: H.surface, border: `1px solid ${H.line}`, borderLeft: `3px solid ${GUIDE[t.state].tint}`, borderRadius: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: GUIDE[t.state].tint, marginBottom: 6 }}>{GUIDE[t.state].head}</div>
          <div style={{ fontSize: 13.5, color: H.dim, lineHeight: 1.55 }}>{GUIDE[t.state].text}</div>
        </div>
      )}

      {hero && (
        <div style={{ marginTop: 10 }}>
          <div style={{ background: "#fff", position: "relative" }}>
            <img src={hero.file_url} alt="" style={{ width: "100%", maxHeight: "36vh", objectFit: "contain", display: "block", margin: "0 auto" }} onError={(e: any) => { e.target.parentElement.style.display = "none"; }} />
            <span style={{ position: "absolute", right: 10, bottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.reaction === "down" ? "#b3455a" : hero.sender_role === "client" || hero.visibility === "client" || hero.reaction === "up" ? "#3c9a2e" : "#b7791f", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "4px 10px" }}>{hero.reaction === "down" ? <><ThumbIcon down size={10} color="#b3455a" strokeWidth={2.5} /> Client passed on this</> : hero.reaction === "up" ? <><ThumbIcon size={10} color="#3c9a2e" strokeWidth={2.5} /> Client liked this</> : hero.sender_role === "client" ? "From client" : hero.visibility === "client" ? "Client sees this" : "Internal only"}</span>
              <button disabled={busy} onClick={() => delAttachment(hero.id)} title="Delete this attachment" style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: H.red, border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontFamily: H.font, opacity: busy ? 0.5 : 1 }}>Delete</button>
            </span>
          </div>
          {images.length > 1 && (
            <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
              {images.map((f: any, i: number) => {
                const active = (heroIdx == null ? images.length - 1 : heroIdx) === i;
                const internal = f.visibility !== "client" && f.sender_role !== "client";
                const down = f.reaction === "down";
                return (
                  <button key={f.id} onClick={() => setHeroIdx(i)} style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : down ? 0.35 : 0.6, position: "relative" }}>
                    <img src={f.file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", filter: down ? "grayscale(70%)" : "none" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                    {internal && <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 2px rgba(244,178,43,.75)", borderRadius: 8, pointerEvents: "none" }} />}
                    {down && <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center", pointerEvents: "none" }}><ThumbIcon down size={9} color="#b3455a" strokeWidth={2.5} /></span>}
                    {f.reaction === "up" && <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center", pointerEvents: "none" }}><ThumbIcon size={9} color="#3c9a2e" strokeWidth={2.5} /></span>}
                  </button>
                );
              })}
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

      {/* Room 2 — the designer lane. Hand the design (or its refs) to a designer
          for creative / vector / separations. Reverse-ping OK: available any state. */}
      <div style={{ padding: "12px 22px", borderTop: `1px solid ${H.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint }}>Designer lane · Room 2</span>
          <button onClick={() => setWoBuilder(true)} style={{ ...ghostBtn, marginLeft: "auto", color: H.blue, borderColor: "rgba(143,199,216,.4)" }}>+ Hand to a designer</button>
        </div>
        {wos.map((w: any) => { const ws = WSTATE(w.state); const ty = WO_TYPES.find(x => x.id === w.type); return (
          <button key={w.id} onClick={() => setOpenWoId(w.id)} style={{ display: "flex", width: "100%", boxSizing: "border-box", alignItems: "center", gap: 10, background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10, padding: "10px 12px", marginTop: 8, cursor: "pointer", fontFamily: H.font, textAlign: "left" }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: H.text }}>{ty?.label || w.type}</span>
            {w.designer_name && <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint }}>{w.designer_name}</span>}
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: ws.color, marginLeft: "auto" }}>{ws.label}</span>
          </button>
        ); })}
      </div>

      {t.state === "approved" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: H.dim }}>
          <b style={{ color: H.green }}>✓ In the bank</b> · {t.approved_by} · {fmt(t.approved_at)}. Artwork locked.
          {orderReq && !orderReq.handled_at && (
            <div style={{ marginTop: 7, color: H.amber, fontWeight: 700 }}>Order request in: {orderReq.blank || "blank TBD"}{orderReq.qty ? ` × ${orderReq.qty}` : ""}{orderReq.note ? ` · "${orderReq.note}"` : ""}. Price it and get them a quote.</div>
          )}
          {orderReq?.job_id && (
            <div style={{ marginTop: 7 }}><a href={`/jobs/${orderReq.job_id}`} target="_blank" rel="noreferrer" style={{ color: H.green, fontWeight: 800, fontSize: 12.5, textDecoration: "none" }}>✓ In the pipeline · {orderReq.jobs?.job_number || "open the job"} ↗</a></div>
          )}
        </div>
      ) : t.state === "killed" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, fontSize: 13, color: H.faint }}><b style={{ color: H.red }}>✕ Killed</b> by the client · kept as the record. A new pitch is a new design.</div>
      ) : (
        <>
          {t.state === "with_client" && (
            <div style={{ padding: "12px 22px", borderTop: `1px solid ${H.line}`, background: "rgba(143,199,216,.06)", fontSize: 12.5, color: H.dim }}><b style={{ color: H.blue }}>Sent — it&rsquo;s the client&rsquo;s move.</b> Reply below to keep talking, or send another draft.</div>
          )}
          {/* One composer, like email: type, optionally attach, send. Sending
              Client-visible hands the thread to the client (their move). */}
          <div style={{ padding: "12px 22px 8px", borderTop: `1px solid ${H.line2}` }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={vis === "client" ? "Message the client…" : "Internal note — team + designer only…"} style={{ width: "100%", boxSizing: "border-box", background: H.surface, border: vis === "client" ? `1px solid ${H.line}` : "1px dashed rgba(244,178,43,.6)", borderRadius: 10, color: H.text, fontSize: 13, padding: "11px 13px", outline: "none", resize: "vertical", fontFamily: H.font }} />
            {staged && (
              <div style={{ display: "inline-flex", position: "relative", marginTop: 10 }}>
                <img src={staged.url} alt="" style={{ maxHeight: 72, borderRadius: 8, background: "#fff", border: `1px solid ${H.line}` }} />
                <button onClick={() => setStaged(null)} aria-label="Remove attachment" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: H.ink, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
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
              <button disabled={uploading || !!staged} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: uploading || staged ? 0.5 : 1 }}>{uploading ? "Attaching…" : staged ? "✓ Attached" : "+ Attach"}</button>
              <button disabled={busy || (!note.trim() && !staged)} onClick={send} style={{ ...primaryBtn, marginLeft: "auto", padding: "12px 24px", fontSize: 11.5, opacity: busy || (!note.trim() && !staged) ? 0.5 : 1 }}>{vis === "client" ? "Send to client" : "Post internal"}</button>
            </div>
          </div>
          <div style={{ padding: "0 22px 16px", fontSize: 10.5, color: H.faint, textAlign: "center", lineHeight: 1.5 }}>Send a <b style={{ color: H.dim }}>Client-visible</b> design and it&rsquo;s the client&rsquo;s move to approve.</div>
        </>
      )}

      {woBuilder && <WorkOrderBuilder threadId={t.id} me={me} images={images} onClose={() => setWoBuilder(false)} onCreated={async (id: string) => { setWoBuilder(false); await loadWos(); setOpenWoId(id); }} />}
      {openWoId && <WorkOrderPanel woId={openWoId} me={me} onClose={() => setOpenWoId(null)} onDone={loadWos} />}
    </>
  );
}

// ── Room 2: hand a design to a designer (the work order) ──
function WorkOrderBuilder({ threadId, me, images, onClose, onCreated }: any) {
  const imgs: any[] = images || [];
  const [type, setType] = useState("creative");
  const [instructions, setInstructions] = useState("");
  const [dueBy, setDueBy] = useState(""); const [designerName, setDesignerName] = useState("");
  const [busy, setBusy] = useState(false);
  // Hand over ALL the thread's images by default — references + our drafts, not
  // just the latest. Tap any to exclude.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(imgs.map((i: any) => i.file_url)));
  const toggle = (url: string) => setSelected(prev => { const n = new Set(prev); if (n.has(url)) n.delete(url); else n.add(url); return n; });
  async function go() {
    setBusy(true);
    try {
      const r = await fetch("/api/lab/work-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, type, instructions: instructions.trim() || null, dueBy: dueBy || null, designerName: designerName.trim() || null, sourceFileUrls: Array.from(selected), senderName: me }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      onCreated(j.workOrder.id);
    } catch (e: any) { alert(e.message); setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title="Hand to a designer">
      <label style={lbl}>What do we need?</label>
      <div style={{ display: "grid", gap: 8 }}>
        {WO_TYPES.map(ty => { const on = type === ty.id; return (
          <button key={ty.id} onClick={() => setType(ty.id)} style={{ textAlign: "left", background: H.surface, border: on ? "1px solid #fff" : `1px solid ${H.line}`, boxShadow: on ? "inset 0 0 0 1px #fff" : "none", borderRadius: 10, padding: "11px 13px", cursor: "pointer", fontFamily: H.font }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", color: H.text }}>{ty.label}</div>
            <div style={{ fontSize: 11, color: H.dim, marginTop: 2 }}>{ty.blurb}</div>
          </button>
        ); })}
      </div>
      <label style={{ ...lbl, marginTop: 12 }}>Instructions</label>
      <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} placeholder="What the file needs to be — colors, sizing, format…" style={{ ...inp, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Due by</label><input type="date" value={dueBy} onChange={e => setDueBy(e.target.value)} style={inp} /></div>
        <div style={{ flex: 1, minWidth: 130 }}><label style={lbl}>Designer <span style={{ color: H.faint }}>(optional)</span></label><input value={designerName} onChange={e => setDesignerName(e.target.value)} placeholder="Name" style={inp} /></div>
      </div>
      {imgs.length > 0 && <div style={{ marginTop: 12 }}>
        <label style={lbl}>Handing over · {selected.size} of {imgs.length}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {imgs.map((im: any) => { const on = selected.has(im.file_url); return (
            <button key={im.id} onClick={() => toggle(im.file_url)} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#fff", border: on ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: on ? 1 : 0.4 }}>
              <img src={im.file_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
              {on && <span style={{ position: "absolute", right: 3, top: 3, background: "#fff", color: H.ink, borderRadius: 999, fontSize: 9, fontWeight: 900, width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>}
            </button>
          ); })}
        </div>
        <div style={{ fontSize: 11, color: H.faint, marginTop: 7, lineHeight: 1.4 }}>All the references + drafts, not just the latest — tap to exclude any. The client&rsquo;s name never goes with them.</div>
      </div>}
      <button disabled={busy} onClick={go} style={{ ...primaryBtn, width: "100%", marginTop: 16, padding: "13px" }}>{busy ? "Creating…" : "Create work order"}</button>
    </Modal>
  );
}

// ── Room 2: review a work order — the designer link, deliveries, accept ──
function WorkOrderPanel({ woId, me, onClose, onDone }: any) {
  const [wo, setWo] = useState<any>(null); const [msgs, setMsgs] = useState<any[]>([]);
  const [note, setNote] = useState(""); const [staged, setStaged] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function load() { const j = await fetch(`/api/lab/work-orders/${woId}`).then(r => r.json()); if (!j.error) { setWo(j.workOrder); setMsgs(j.messages || []); } }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [woId]);
  const refresh = async () => { await load(); onDone?.(); };

  const images = msgs.filter(m => m.file_url);
  const hero = images.length ? images[heroIdx == null ? images.length - 1 : Math.min(heroIdx, images.length - 1)] : null;
  const notes = msgs.filter(m => m.body && m.body.trim());
  const hasDelivery = msgs.some(m => m.sender_role === "designer" && m.file_url);

  async function send() {
    if (!note.trim() && !staged) return; setBusy(true);
    try { await fetch(`/api/lab/work-orders/${woId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: me, body: note.trim() || null, fileUrl: staged?.url || null, fileName: staged?.name || null }) }); setNote(""); setStaged(null); setHeroIdx(null); await refresh(); } finally { setBusy(false); }
  }
  async function onFile(f: File) { setUploading(true); try { setStaged(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function accept() { if (!confirm("Accept this delivery as the production file?")) return; setBusy(true); try { const r = await fetch(`/api/lab/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", senderName: me }) }); if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Couldn't accept."); return; } await refresh(); } finally { setBusy(false); } }

  if (!wo) return <div className="sv-back" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="sv-sheet" style={{ padding: 30, color: H.faint, fontSize: 13 }}>Loading the work order…</div></div>;
  const ws = WSTATE(wo.state); const ty = WO_TYPES.find(x => x.id === wo.type);
  const link = `${origin}/lab/d/${wo.token}`; const accepted = wo.state === "accepted";

  return (
    <div className="sv-back" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sv-sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>Designer · Room 2</div>
            <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>{ty?.label || wo.type}</div>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ws.color, marginTop: 4 }}>{ws.label}{wo.due_by ? ` · due ${wo.due_by}` : ""}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ margin: "6px 22px 0", padding: "10px 12px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10 }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 6 }}>Designer link — send this, no login</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={link} onFocus={e => e.currentTarget.select()} style={{ ...inp, flex: 1, minWidth: 160, fontSize: 11, fontFamily: H.mono, padding: "8px 10px" }} />
            <button onClick={() => navigator.clipboard.writeText(link)} style={ghostBtn}>Copy</button>
            <a href={link} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>Open ↗</a>
          </div>
        </div>

        {hero && (
          <div style={{ marginTop: 12 }}>
            <div style={{ background: "#fff", position: "relative" }}>
              <img src={hero.file_url} alt="" style={{ width: "100%", maxHeight: "34vh", objectFit: "contain", display: "block", margin: "0 auto" }} onError={(e: any) => { e.target.parentElement.style.display = "none"; }} />
              <span style={{ position: "absolute", right: 10, bottom: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.sender_role === "designer" ? "#3c9a2e" : "#666", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "4px 10px" }}>{hero.sender_role === "designer" ? "Designer delivery" : "What we sent"}</span>
            </div>
            {images.length > 1 && (
              <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
                {images.map((f, i) => { const active = (heroIdx == null ? images.length - 1 : heroIdx) === i; return (
                  <button key={f.id} onClick={() => setHeroIdx(i)} style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.6 }}>
                    <img src={f.file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                  </button>
                ); })}
              </div>
            )}
          </div>
        )}

        <div style={{ padding: "14px 22px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "28vh", overflowY: "auto" }}>
          {notes.length === 0 ? <div style={{ fontSize: 13, color: H.faint }}>No words yet.</div> : notes.map((m: any) => {
            const mine = m.sender_role === "hpd"; const system = String(m.body || "").startsWith("✓");
            if (system) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.green }}>{m.body}</div>;
            return (
              <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%", background: mine ? "#fff" : H.surface, color: mine ? H.ink : H.text, borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: mine ? "rgba(10,10,10,0.45)" : H.faint, marginBottom: 3 }}>{m.sender_name || m.sender_role} · {fmt(m.created_at)}</span>
                {m.body}
              </div>
            );
          })}
        </div>

        {accepted ? (
          <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: H.dim }}><b style={{ color: H.green }}>✓ Accepted</b> · {fmt(wo.updated_at)}. This file is production-ready.</div>
        ) : (
          <>
            {hasDelivery && <div style={{ padding: "12px 22px 0" }}><button disabled={busy} onClick={accept} style={{ ...primaryBtn, width: "100%", padding: "13px", background: H.green, color: "#08210a" }}>✓ Accept — this is the file</button></div>}
            <div style={{ padding: "12px 22px 18px" }}>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reply to the designer…" style={{ ...inp, marginBottom: staged ? 10 : 0 }} />
              {staged && <div style={{ display: "inline-flex", position: "relative", marginBottom: 10 }}><img src={staged.url} alt="" style={{ maxHeight: 72, borderRadius: 8, background: "#fff", border: `1px solid ${H.line}` }} /><button onClick={() => setStaged(null)} aria-label="Remove" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: H.ink, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button></div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input ref={fileIn} type="file" accept="image/*,.pdf,.ai,.psd,.eps,.svg" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
                <button disabled={uploading || !!staged} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: uploading || staged ? 0.5 : 1 }}>{uploading ? "Attaching…" : staged ? "✓ Attached" : "+ Attach a reference"}</button>
                <button disabled={busy || (!note.trim() && !staged)} onClick={send} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || (!note.trim() && !staged) ? 0.5 : 1 }}>Send</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NewDesign({ clients, me, onClose, onCreated, onNeedClients }: any) {
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [newName, setNewName] = useState("");
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      let cid = clientId;
      if (!cid && newName.trim()) { const r = await fetch("/api/lab/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) }); cid = (await r.json()).client?.id; onNeedClients?.(); }
      if (!cid || !title.trim()) { alert("Pick or name a client, and give it a title."); setBusy(false); return; }
      const r = await fetch("/api/lab/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: cid, title: title.trim(), body: body.trim() || null, senderName: me }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      onCreated(j.thread.id);
    } catch (e: any) { alert(e.message); setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title="Start something">
      <label style={lbl}>Client</label>
      <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
        <option value="">— new client below —</option>
        {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!clientId && <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New client name" style={{ ...inp, marginTop: 8 }} />}
      <label style={{ ...lbl, marginTop: 12 }}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Album Art" style={inp} />
      <label style={{ ...lbl, marginTop: 12 }}>Kickoff note <span style={{ color: H.faint }}>(optional — stays your prep until you share)</span></label>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="What are we making?" style={{ ...inp, resize: "vertical" }} />
      <button disabled={busy} onClick={go} style={{ ...primaryBtn, width: "100%", marginTop: 16, padding: "13px" }}>{busy ? "Starting…" : "Start the design"}</button>
    </Modal>
  );
}

// Clients ride REAL identity now (decided Aug 4): pick an existing OpsHub
// client (search-first, company-scoped) or create a LEAD — a real clients row
// flagged is_lead, hidden from ops lists until their first job flips it.
function ClientsPanel({ clients, onClose, onChanged }: any) {
  const [q, setQ] = useState(""); const [results, setResults] = useState<any[]>([]);
  const [leadForm, setLeadForm] = useState(false); const [leadName, setLeadName] = useState(""); const [leadEmail, setLeadEmail] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/lab/real-clients?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => ({}));
      if (r.error) setErr(r.error); else { setErr(""); setResults(r.clients || []); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  async function link(clientId: string) {
    setBusy(true); setErr("");
    try { const r = await fetch("/api/lab/real-clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) }).then(x => x.json()); if (r.error) setErr(r.error); else { setQ(""); setResults([]); await onChanged(); } } finally { setBusy(false); }
  }
  async function addLead() {
    setBusy(true); setErr("");
    try { const r = await fetch("/api/lab/real-clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: leadName.trim(), email: leadEmail.trim() }) }).then(x => x.json()); if (r.error) setErr(r.error); else { setLeadForm(false); setLeadName(""); setLeadEmail(""); await onChanged(); } } finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title="Clients & their links">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search your real clients…" style={{ ...inp, marginBottom: 8 }} />
      {results.map((c: any) => (
        <button key={c.id} disabled={busy || c.in_lab} onClick={() => link(c.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, background: H.surface, border: `1px solid ${H.line2}`, borderRadius: 9, padding: "9px 12px", marginBottom: 6, cursor: c.in_lab ? "default" : "pointer", fontFamily: H.font, color: H.text, opacity: c.in_lab ? 0.55 : 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase" }}>{c.name}</span>
          {c.is_lead && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.amber }}>Lead</span>}
          <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: c.in_lab ? H.faint : H.blue }}>{c.in_lab ? "In the studio" : "+ Bring in"}</span>
        </button>
      ))}
      {!leadForm ? (
        <button onClick={() => setLeadForm(true)} style={{ ...ghostBtn, marginBottom: 12 }}>+ New lead</button>
      ) : (
        <div style={{ border: `1px dashed ${H.line}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 8 }}>New lead · real client, hidden from ops lists until their first job</div>
          <input value={leadName} onChange={e => setLeadName(e.target.value)} placeholder="Name" style={{ ...inp, marginBottom: 6 }} />
          <input value={leadEmail} onChange={e => setLeadEmail(e.target.value)} placeholder="Email — where the quote goes" style={{ ...inp, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setLeadForm(false)} style={{ ...ghostBtn, border: "none", color: H.faint }}>Cancel</button>
            <button disabled={busy || !leadName.trim() || !leadEmail.trim()} onClick={addLead} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || !leadName.trim() || !leadEmail.trim() ? 0.5 : 1 }}>Create the lead</button>
          </div>
        </div>
      )}
      {err && <div style={{ color: H.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {clients.length === 0 && <div style={{ color: H.faint, fontSize: 13 }}>No studio clients yet.</div>}
      {clients.map((c: any) => { const link2 = `${origin}/lab/c/${c.token}`; return (
        <div key={c.id} style={{ padding: "11px 0", borderTop: `1px solid ${H.line2}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{c.name}</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: c.client_id ? H.green : H.amber }}>{c.client_id ? "Linked" : "Sandbox only"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5, flexWrap: "wrap" }}>
            <input readOnly value={link2} style={{ ...inp, flex: 1, fontSize: 11, fontFamily: H.mono, padding: "7px 9px" }} onFocus={e => e.currentTarget.select()} />
            <button onClick={() => navigator.clipboard.writeText(link2)} style={ghostBtn}>Copy</button>
            <a href={link2} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>Open ↗</a>
          </div>
        </div>); })}
    </Modal>
  );
}

function Modal({ title, onClose, children }: any) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 480, padding: "20px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</div><button onClick={onClose} style={{ background: "none", border: "none", color: H.faint, fontSize: 22, cursor: "pointer" }}>×</button></div>
        {children}
      </div>
    </div>
  );
}

const pill = (on: boolean): React.CSSProperties => ({ borderRadius: 999, border: on ? "1px solid #fff" : `1px solid ${H.line}`, background: on ? "#fff" : "transparent", color: on ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "6px 11px", cursor: "pointer", fontFamily: H.font });
const primaryBtn: React.CSSProperties = { background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "10px 16px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: H.text, border: `1px solid ${H.line}`, borderRadius: 999, padding: "10px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
const lbl: React.CSSProperties = { display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 9, color: H.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: H.font };

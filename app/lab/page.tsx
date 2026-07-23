"use client";
import { useEffect, useRef, useState } from "react";

// THE LAB · STUDIO (HPD) — built to LOOK like the real studio2: a magazine feed
// of design cards → a sheet modal. Same chrome, same buttons, same composer, so
// the team learns the daily UI. Two actions in the sheet: MOVE IT / TALK.
const H = { ink: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", purple: "#fd3aa3", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const NAMES = ["Jon", "Drake", "Taylor", "Corey"];
const STATE = (s: string) => s === "with_client" ? { label: "With the client", color: H.blue } : s === "approved" ? { label: "Design approved", color: H.green } : { label: "Your move", color: H.amber };
// Readable process guidance per state — the lab teaches the flow, so this stays
// visible in plain words, not tiny labels (Jon, Jul 23).
const GUIDE: Record<string, { tint: string; head: string; text: string }> = {
  working: { tint: H.amber, head: "It's your move", text: "This is where you shape the design with the client. Drop a draft, or talk it through — flip a note to Internal to keep it off their screen while you and the designer work. When the artwork is right, send it over for their sign-off." },
  with_client: { tint: H.blue, head: "It's with the client", text: "The design is in front of the client to approve. They'll either lock it in — which hands the artwork straight to production — or send it back with notes and a photo. Nothing to do but wait, or give them a nudge below." },
};
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

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

  useEffect(() => { setMe(localStorage.getItem("lab_me") || "Jon"); }, []);
  useEffect(() => { if (me) localStorage.setItem("lab_me", me); }, [me]);

  async function loadList() {
    const [t, c] = await Promise.all([
      fetch("/api/lab/threads").then(r => r.json()).catch(() => ({})),
      fetch("/api/lab/clients").then(r => r.json()).catch(() => ({})),
    ]);
    setThreads(t.threads || []); setClients(c.clients || []);
  }
  async function loadDetail(id: string) { setDetail(await fetch(`/api/lab/threads/${id}`).then(r => r.json())); }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId]);
  const refresh = async () => { await loadList(); if (openId) await loadDetail(openId); };

  const buckets = [
    { key: "working", title: "Your move.", hint: "designs waiting on you", color: H.amber },
    { key: "with_client", title: "With the client.", hint: "sent — waiting on their sign-off", color: H.blue },
    { key: "approved", title: "Approved.", hint: "locked, ready for the front of production", color: H.green },
  ];
  const artOf = (t: any) => t._art || null;

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

      {buckets.map(bk => {
        const list = threads.filter(t => t.state === bk.key);
        if (!list.length) return null;
        return (
          <section key={bk.key} style={{ marginTop: 34 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.color }}>{bk.title}</h2>
              <span style={{ fontSize: 10.5, color: H.faint }}>{bk.hint}</span>
            </div>
            <div className="sv-grid">
              {list.map(t => {
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
              })}
            </div>
          </section>
        );
      })}

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
  const [note, setNote] = useState(""); const [vis, setVis] = useState<"client" | "internal">("client");
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);
  // Latest drop is the hero; every earlier drop is a filmstrip thumb (old → new).
  // Images live in the strip; the thread carries the words (mirrors studio2).
  const images = msgs.filter((m: any) => m.file_url);
  const hero = images.length ? images[heroIdx == null ? images.length - 1 : Math.min(heroIdx, images.length - 1)] : null;
  const notes = msgs.filter((m: any) => m.body && m.body.trim());

  async function post(fileUrl?: string, fileName?: string) {
    if (!note.trim() && !fileUrl) return; setBusy(true);
    try { await fetch(`/api/lab/threads/${t.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: me, body: note.trim() || null, visibility: vis, fileUrl, fileName }) }); setNote(""); setHeroIdx(null); await onRefresh(); } finally { setBusy(false); }
  }
  async function onFile(f: File) { setUploading(true); try { const u = await uploadImage(f); await post(u.url, u.name); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function act(action: string) { setBusy(true); try { await fetch(`/api/lab/threads/${t.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, senderName: me }) }); await onRefresh(); } finally { setBusy(false); } }
  async function del() { if (!confirm(`Delete "${t.title}"? This removes the design and its whole thread. Can't be undone.`)) return; await fetch(`/api/lab/threads/${t.id}`, { method: "DELETE" }); onClose(); await onRefresh(); }

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
            <span style={{ position: "absolute", right: 10, bottom: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.sender_role === "client" || hero.visibility === "client" ? "#3c9a2e" : "#b7791f", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "4px 10px" }}>{hero.sender_role === "client" ? "From client" : hero.visibility === "client" ? "Client sees this" : "Internal only"}</span>
          </div>
          {images.length > 1 && (
            <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
              {images.map((f: any, i: number) => {
                const active = (heroIdx == null ? images.length - 1 : heroIdx) === i;
                const internal = f.visibility !== "client" && f.sender_role !== "client";
                return (
                  <button key={f.id} onClick={() => setHeroIdx(i)} style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.6, position: "relative" }}>
                    <img src={f.file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                    {internal && <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 2px rgba(244,178,43,.75)", borderRadius: 8, pointerEvents: "none" }} />}
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
          const marker = String(m.body || "").startsWith("✓");
          if (marker) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.green }}>{m.body}</div>;
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

      {t.state === "approved" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: H.dim }}><b style={{ color: H.green }}>✓ Design approved</b> by {t.approved_by} · {fmt(t.approved_at)}. Locked and ready for the front of production.</div>
      ) : (
        <>
          <div style={{ padding: "15px 22px", borderTop: `1px solid ${H.line}`, background: H.surface }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginBottom: 10 }}>Your next move</div>
            {t.state === "with_client"
              ? <div style={{ fontSize: 12.5, color: H.dim }}>Sent — waiting on the client. Keep talking below if you need to.</div>
              : <><button disabled={busy} onClick={() => act("send_to_client")} style={{ ...primaryBtn, width: "100%", padding: "14px", fontSize: 12 }}>Send to client for approval →</button>
                <div style={{ fontSize: 11, color: H.faint, marginTop: 9, textAlign: "center" }}>Needs another pass? Hand it to the designer <span style={{ color: H.blue }}>(coming soon)</span></div></>}
          </div>
          <div style={{ padding: "12px 22px 18px", borderTop: `1px solid ${H.line2}` }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={vis === "client" ? "Reply to the client…" : "Internal note — team + designer only…"} style={{ width: "100%", boxSizing: "border-box", background: H.surface, border: vis === "client" ? `1px solid ${H.line}` : "1px dashed rgba(244,178,43,.6)", borderRadius: 10, color: H.text, fontSize: 13, padding: "11px 13px", outline: "none", resize: "vertical", fontFamily: H.font }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 9, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>Shows</span>
                <span style={{ display: "inline-flex", border: `1px solid ${H.line}`, borderRadius: 999, background: H.ink, overflow: "hidden" }}>
                  {(["client", "internal"] as const).map((k, i) => { const on = vis === k; return <button key={k} onClick={() => setVis(k)} style={{ border: "none", borderLeft: i ? `1px solid ${H.line}` : "none", background: on ? (k === "client" ? "rgba(143,199,216,.2)" : "rgba(244,178,43,.2)") : "transparent", color: on ? (k === "client" ? H.blue : H.amber) : H.faint, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "9px 14px", cursor: "pointer", fontFamily: H.font }}>{k === "client" ? "Client-visible" : "Internal"}</button>; })}
                </span>
              </span>
              <input ref={fileIn} type="file" accept="image/*,.pdf,.ai,.psd,.eps,.svg" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
              <button disabled={uploading} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: uploading ? 0.5 : 1 }}>{uploading ? "Uploading…" : "+ Upload a draft"}</button>
              <button disabled={busy || !note.trim()} onClick={() => post()} style={{ ...primaryBtn, marginLeft: "auto", padding: "12px 24px", fontSize: 11.5, opacity: busy || !note.trim() ? 0.5 : 1 }}>{vis === "client" ? "Send to client" : "Post internal"}</button>
            </div>
          </div>
        </>
      )}
    </>
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

function ClientsPanel({ clients, onClose, onChanged }: any) {
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  async function add() { if (!name.trim()) return; setBusy(true); try { await fetch("/api/lab/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); setName(""); await onChanged(); } finally { setBusy(false); } }
  return (
    <Modal onClose={onClose} title="Clients & their links">
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><input value={name} onChange={e => setName(e.target.value)} placeholder="New client name" style={{ ...inp, flex: 1 }} /><button disabled={busy} onClick={add} style={primaryBtn}>Add</button></div>
      {clients.length === 0 && <div style={{ color: H.faint, fontSize: 13 }}>No clients yet.</div>}
      {clients.map((c: any) => { const link = `${origin}/lab/c/${c.token}`; return (
        <div key={c.id} style={{ padding: "11px 0", borderTop: `1px solid ${H.line2}` }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{c.name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5, flexWrap: "wrap" }}>
            <input readOnly value={link} style={{ ...inp, flex: 1, fontSize: 11, fontFamily: H.mono, padding: "7px 9px" }} onFocus={e => e.currentTarget.select()} />
            <button onClick={() => navigator.clipboard.writeText(link)} style={ghostBtn}>Copy</button>
            <a href={link} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>Open ↗</a>
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

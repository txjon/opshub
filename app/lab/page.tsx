"use client";
import { useEffect, useRef, useState } from "react";

// THE LAB · STUDIO (HPD side) — the proving ground for the design ping-pong.
// Two kinds of action, never eight: MOVE IT (send to client) or TALK (note/file,
// client or internal). Pick who you are; the client link is one tap away.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", purple: "#fd3aa3", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const NAMES = ["Jon", "Drake", "Taylor", "Corey"];
const STATE = (s: string) => s === "with_client" ? { label: "With the client", color: C.blue } : s === "approved" ? { label: "Design approved", color: C.green } : { label: "Your move", color: C.amber };
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

async function uploadImage(file: File): Promise<{ url: string; name: string }> {
  const s = await fetch("/api/lab/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) });
  const j = await s.json();
  if (!s.ok) throw new Error(j.error || "Upload failed");
  const put = await fetch(j.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" } });
  if (!put.ok) throw new Error("Upload PUT failed");
  return { url: j.publicUrl, name: file.name };
}

export default function LabStudio() {
  const [me, setMe] = useState<string>("");
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
  async function loadDetail(id: string) {
    const d = await fetch(`/api/lab/threads/${id}`).then(r => r.json());
    setDetail(d);
  }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId]);

  const refresh = async () => { await loadList(); if (openId) await loadDetail(openId); };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 20px 80px" }}>
      <style dangerouslySetInnerHTML={{ __html: `.lab-grid{display:grid;grid-template-columns:1fr;gap:18px}@media(min-width:900px){.lab-grid{grid-template-columns:320px 1fr}}` }} />
      {/* header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>The Lab · sandbox</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <h1 style={{ fontSize: "clamp(30px,5vw,46px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0 }}>The studio.</h1>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>You are</span>
          {NAMES.map(n => (
            <button key={n} onClick={() => setMe(n)} style={{ ...pill(me === n), fontSize: 10 }}>{n}</button>
          ))}
        </span>
      </div>

      <div className="lab-grid">
        {/* thread list */}
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setShowNew(true)} style={{ flex: 1, ...primaryBtn }}>+ New design</button>
            <button onClick={() => setShowClients(true)} style={{ ...ghostBtn }}>Clients &amp; links</button>
          </div>
          {threads.length === 0 && <div style={{ color: C.faint, fontSize: 13, padding: "20px 4px" }}>No designs yet. Start one, or share a client link and let them submit.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {threads.map(t => {
              const st = STATE(t.state); const active = openId === t.id;
              return (
                <button key={t.id} onClick={() => setOpenId(t.id)} style={{ textAlign: "left", background: active ? C.surface : C.panel, border: `1px solid ${active ? "rgba(255,255,255,.3)" : C.line}`, borderRadius: 12, padding: "13px 15px", cursor: "pointer", fontFamily: C.font, color: C.text }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.01em", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: st.color, whiteSpace: "nowrap" }}>{st.label}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.faint, fontFamily: C.mono, marginTop: 4 }}>{t.lab_clients?.name || "—"}{t.initiated_by === "client" ? " · they started it" : ""}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* detail */}
        <div>
          {!detail ? (
            <div style={{ color: C.faint, fontSize: 13, padding: "40px 0", textAlign: "center", border: `1px dashed ${C.line}`, borderRadius: 16 }}>Pick a design to work it.</div>
          ) : <ThreadPanel key={detail.thread.id} detail={detail} me={me} onRefresh={refresh} />}
        </div>
      </div>

      {showNew && <NewDesign clients={clients} me={me} onClose={() => setShowNew(false)} onCreated={async (id: string) => { setShowNew(false); await loadList(); setOpenId(id); }} onNeedClients={loadList} />}
      {showClients && <ClientsPanel clients={clients} onClose={() => setShowClients(false)} onChanged={loadList} />}
    </div>
  );
}

// ── the working panel: thread + move-it / talk ──
function ThreadPanel({ detail, me, onRefresh }: any) {
  const t = detail.thread; const msgs = detail.messages || [];
  const st = STATE(t.state);
  const [note, setNote] = useState(""); const [vis, setVis] = useState<"client" | "internal">("client");
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const fileIn = useRef<HTMLInputElement | null>(null);
  const lastArt = [...msgs].reverse().find((m: any) => m.file_url);

  async function post(fileUrl?: string, fileName?: string) {
    if (!note.trim() && !fileUrl) return;
    setBusy(true);
    try {
      await fetch(`/api/lab/threads/${t.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: me, body: note.trim() || null, visibility: vis, fileUrl, fileName }) });
      setNote(""); await onRefresh();
    } finally { setBusy(false); }
  }
  async function onFile(f: File) { setUploading(true); try { const { url, name } = await uploadImage(f); await post(url, name); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function act(action: string) { setBusy(true); try { await fetch(`/api/lab/threads/${t.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, senderName: me }) }); await onRefresh(); } finally { setBusy(false); } }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${C.line}`, background: C.surface }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.13em", textTransform: "uppercase", color: C.faint }}>{t.lab_clients?.name || "—"} · design</div>
          <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.1, marginTop: 2 }}>{t.title}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: st.color }}>{st.label}</span>
      </div>

      {lastArt && (
        <div style={{ background: "#fff", display: "flex", justifyContent: "center", padding: "10px 0", maxHeight: "34vh", overflow: "hidden" }}>
          <img src={lastArt.file_url} alt="" style={{ maxHeight: "32vh", maxWidth: "100%", objectFit: "contain" }} />
        </div>
      )}

      {/* thread */}
      <div style={{ padding: "10px 18px", maxHeight: "36vh", overflowY: "auto" }}>
        {msgs.map((m: any) => (
          <div key={m.id} style={{ padding: "9px 0", borderBottom: `1px solid ${C.line2}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: m.sender_role === "client" ? C.purple : C.text }}>{m.sender_name || m.sender_role}</span>
              <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 999, padding: "2px 7px", color: m.visibility === "internal" ? C.amber : C.green, background: m.visibility === "internal" ? "rgba(244,178,43,.1)" : "rgba(88,201,60,.1)" }}>{m.visibility === "internal" ? "Internal" : "Client sees"}</span>
              {m.kind === "approval" && <span style={{ fontSize: 8, fontWeight: 800, color: C.green }}>◆ APPROVED</span>}
              {m.kind === "change_request" && <span style={{ fontSize: 8, fontWeight: 800, color: C.red }}>↩ CHANGE</span>}
              <span style={{ fontSize: 10, fontFamily: C.mono, color: C.faint, marginLeft: "auto" }}>{fmt(m.created_at)}</span>
            </div>
            {m.body && <div style={{ fontSize: 13.5, color: m.sender_role === "client" ? C.dim : C.text, lineHeight: 1.45 }}>{m.body}</div>}
            {m.file_url && <a href={m.file_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 7 }}><img src={m.file_url} alt="" style={{ maxHeight: 90, borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff" }} /></a>}
          </div>
        ))}
      </div>

      {t.state === "approved" ? (
        <div style={{ padding: "16px 18px", borderTop: `1px solid ${C.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: C.dim }}>
          <b style={{ color: C.green }}>✓ Design approved</b> by {t.approved_by} · {fmt(t.approved_at)}. It's locked and ready for the front of production.
        </div>
      ) : (
        <>
          {/* MOVE IT */}
          <div style={{ padding: "15px 18px", borderTop: `1px solid ${C.line}`, background: C.surface }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 10 }}>Your next move</div>
            {t.state === "with_client" ? (
              <div style={{ fontSize: 12.5, color: C.dim }}>Sent — waiting on the client to approve or send it back. Keep talking below if you need to.</div>
            ) : (
              <>
                <button disabled={busy} onClick={() => act("send_to_client")} style={{ ...primaryBtn, width: "100%", padding: "14px", fontSize: 12 }}>Send to client for approval →</button>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 9, textAlign: "center" }}>Needs another pass? Hand it to the designer <span style={{ color: C.blue }}>(coming soon)</span></div>
              </>
            )}
          </div>
          {/* TALK */}
          <div style={{ padding: "12px 18px 16px", borderTop: `1px solid ${C.line2}` }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={vis === "client" ? "Reply to the client…" : "Internal note — team only…"} style={{ width: "100%", boxSizing: "border-box", background: C.surface, border: vis === "client" ? `1px solid ${C.line}` : "1px dashed rgba(244,178,43,.6)", borderRadius: 10, color: C.text, fontSize: 13, padding: "10px 12px", outline: "none", resize: "vertical", fontFamily: C.font }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 999, overflow: "hidden" }}>
                {(["client", "internal"] as const).map((k, i) => <button key={k} onClick={() => setVis(k)} style={{ border: "none", borderLeft: i ? `1px solid ${C.line}` : "none", background: vis === k ? (k === "client" ? "rgba(143,199,216,.2)" : "rgba(244,178,43,.2)") : "transparent", color: vis === k ? (k === "client" ? C.blue : C.amber) : C.faint, fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "8px 12px", cursor: "pointer", fontFamily: C.font }}>{k === "client" ? "Client" : "Internal"}</button>)}
              </span>
              <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
              <button disabled={uploading} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: uploading ? 0.5 : 1 }}>{uploading ? "Uploading…" : "+ Upload a draft"}</button>
              <button disabled={busy || !note.trim()} onClick={() => post()} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || !note.trim() ? 0.5 : 1 }}>Post</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── new design (HPD-initiated) ──
function NewDesign({ clients, me, onClose, onCreated, onNeedClients }: any) {
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [newName, setNewName] = useState("");
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      let cid = clientId;
      if (!cid && newName.trim()) { const r = await fetch("/api/lab/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) }); const j = await r.json(); cid = j.client?.id; onNeedClients?.(); }
      if (!cid || !title.trim()) { alert("Pick or name a client, and give it a title."); setBusy(false); return; }
      const r = await fetch("/api/lab/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: cid, title: title.trim(), body: body.trim() || null, senderName: me }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      onCreated(j.thread.id);
    } catch (e: any) { alert(e.message); setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title="New design">
      <label style={lbl}>Client</label>
      <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
        <option value="">— new client below —</option>
        {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!clientId && <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New client name" style={{ ...inp, marginTop: 8 }} />}
      <label style={{ ...lbl, marginTop: 12 }}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Album Art" style={inp} />
      <label style={{ ...lbl, marginTop: 12 }}>Kickoff note <span style={{ color: C.faint }}>(optional)</span></label>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="What are we making?" style={{ ...inp, resize: "vertical" }} />
      <button disabled={busy} onClick={go} style={{ ...primaryBtn, width: "100%", marginTop: 16, padding: "13px" }}>{busy ? "Starting…" : "Start the design"}</button>
    </Modal>
  );
}

// ── clients + their magic links ──
function ClientsPanel({ clients, onClose, onChanged }: any) {
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  async function add() { if (!name.trim()) return; setBusy(true); try { await fetch("/api/lab/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); setName(""); await onChanged(); } finally { setBusy(false); } }
  return (
    <Modal onClose={onClose} title="Clients & their links">
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New client name" style={{ ...inp, flex: 1 }} />
        <button disabled={busy} onClick={add} style={primaryBtn}>Add</button>
      </div>
      {clients.length === 0 && <div style={{ color: C.faint, fontSize: 13 }}>No clients yet.</div>}
      {clients.map((c: any) => {
        const link = `${origin}/lab/c/${c.token}`;
        return (
          <div key={c.id} style={{ padding: "11px 0", borderTop: `1px solid ${C.line2}` }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{c.name}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5, flexWrap: "wrap" }}>
              <input readOnly value={link} style={{ ...inp, flex: 1, fontSize: 11, fontFamily: C.mono, padding: "7px 9px" }} onFocus={e => e.currentTarget.select()} />
              <button onClick={() => navigator.clipboard.writeText(link)} style={ghostBtn}>Copy</button>
              <a href={link} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>Open ↗</a>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function Modal({ title, onClose, children }: any) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${C.line}`, borderRadius: 18, width: "100%", maxWidth: 480, padding: "20px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.faint, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const pill = (on: boolean): React.CSSProperties => ({ borderRadius: 999, border: on ? "1px solid #fff" : `1px solid ${C.line}`, background: on ? "#fff" : "transparent", color: on ? C.bg : C.dim, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "6px 11px", cursor: "pointer", fontFamily: C.font });
const primaryBtn: React.CSSProperties = { background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "9px 16px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "9px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const lbl: React.CSSProperties = { display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, color: C.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: C.font };

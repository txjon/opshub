"use client";
import { useEffect, useRef, useState } from "react";

// THE LAB · CLIENT HUB (magic link). What the client gets: share an idea, watch
// it come together, and — when it's their move — approve the DESIGN (locks the
// art) or send it back with a photo. Client-visible only; internal never shows.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", purple: "#fd3aa3", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const STATE = (s: string) => s === "with_client" ? { label: "Your move", color: C.amber } : s === "approved" ? { label: "Approved", color: C.green } : { label: "In the works", color: C.blue };
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

async function uploadImage(file: File): Promise<{ url: string; name: string }> {
  const s = await fetch("/api/lab/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) });
  const j = await s.json(); if (!s.ok) throw new Error(j.error || "Upload failed");
  const put = await fetch(j.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" } });
  if (!put.ok) throw new Error("Upload failed");
  return { url: j.publicUrl, name: file.name };
}

export default function LabClient({ params }: { params: { token: string } }) {
  const token = params.token;
  const [client, setClient] = useState<any>(null);
  const [threads, setThreads] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [share, setShare] = useState(false);
  const [bad, setBad] = useState(false);

  async function loadList() {
    const j = await fetch(`/api/lab/threads?clientToken=${token}`).then(r => r.json());
    if (j.error) { setBad(true); return; }
    setClient(j.client); setThreads(j.threads || []);
  }
  async function loadDetail(id: string) { const d = await fetch(`/api/lab/threads/${id}?clientToken=${token}`).then(r => r.json()); setDetail(d); }
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [token]);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); /* eslint-disable-next-line */ }, [openId]);
  const refresh = async () => { await loadList(); if (openId) await loadDetail(openId); };

  if (bad) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: C.red, fontSize: 14 }}>This link isn't valid.</div>;
  if (!client) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>Opening your studio…</div>;

  if (detail) return <ClientThread detail={detail} token={token} onBack={() => setOpenId(null)} onRefresh={refresh} />;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "34px 20px 80px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Your studio</div>
        <h1 style={{ fontSize: "clamp(30px,6.5vw,54px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 18px" }}>{client.name}.</h1>
      </div>

      {share ? <ShareForm token={token} onClose={() => setShare(false)} onDone={async (id: string) => { setShare(false); await loadList(); setOpenId(id); }} />
        : <div style={{ textAlign: "center", marginBottom: 30 }}><button onClick={() => setShare(true)} style={{ ...primaryBtn, padding: "13px 26px", fontSize: 12 }}>Share something →</button></div>}

      <style dangerouslySetInnerHTML={{ __html: `.st-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px 12px}@media(min-width:600px){.st-grid{grid-template-columns:repeat(3,1fr)}}` }} />
      {threads.length === 0 && !share && <div style={{ color: C.dim, fontSize: 13.5, textAlign: "center" }}>Nothing here yet. Share an idea to get started.</div>}
      {[{ k: "with_client", t: "Your move.", c: C.amber }, { k: "working", t: "In the works.", c: C.blue }, { k: "approved", t: "Approved.", c: C.green }].map(bk => {
        const list = threads.filter(t => t.state === bk.k);
        if (!list.length) return null;
        return (
          <div key={bk.k} style={{ marginTop: 26 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.c }}>{bk.t}</h2>
            <div className="st-grid">
              {list.map(t => (
                <button key={t.id} onClick={() => setOpenId(t.id)} style={{ textAlign: "left", padding: 0, background: C.panel, border: `1px solid ${t.state === "with_client" ? "rgba(244,178,43,.5)" : C.line}`, borderRadius: 14, overflow: "hidden", cursor: "pointer", fontFamily: C.font, color: C.text, display: "block", width: "100%" }}>
                  <div style={{ aspectRatio: "1", background: t._art ? "#fff" : C.surface, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
                    {t._art ? <img src={t._art} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      : <span style={{ padding: 12, fontSize: 14, fontWeight: 900, textTransform: "uppercase", color: C.dim, lineHeight: 1.15 }}>{t.title}</span>}
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.2 }}>{t.title}</div>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: STATE(t.state).color, marginTop: 4 }}>{STATE(t.state).label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClientThread({ detail, token, onBack, onRefresh }: any) {
  const t = detail.thread; const msgs = detail.messages || [];
  const st = STATE(t.state);
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [changing, setChanging] = useState(false); const [chNote, setChNote] = useState(""); const [chFile, setChFile] = useState<{ url: string; name: string } | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null); const chIn = useRef<HTMLInputElement | null>(null);
  const art = [...msgs].reverse().find((m: any) => m.file_url);

  async function reply(fileUrl?: string, fileName?: string) {
    if (!note.trim() && !fileUrl) return; setBusy(true);
    try { await fetch(`/api/lab/threads/${t.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientToken: token, body: note.trim() || null, fileUrl, fileName }) }); setNote(""); await onRefresh(); } finally { setBusy(false); }
  }
  async function onReplyFile(f: File) { setUploading(true); try { const u = await uploadImage(f); await reply(u.url, u.name); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function approve() { if (!confirm("Approve this design? It locks the artwork for production. (Pricing and your order come after.)")) return; setBusy(true); try { await fetch(`/api/lab/threads/${t.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", clientToken: token }) }); await onRefresh(); } finally { setBusy(false); } }
  async function sendChange() { setBusy(true); try { await fetch(`/api/lab/threads/${t.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_changes", clientToken: token, note: chNote.trim() || null, fileUrl: chFile?.url || null, fileName: chFile?.name || null }) }); setChanging(false); setChNote(""); setChFile(null); await onRefresh(); } finally { setBusy(false); } }
  async function onChFile(f: File) { setUploading(true); try { setChFile(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "22px 18px 80px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: C.dim, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "4px 0", marginBottom: 8 }}>‹ your studio</button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <h1 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", margin: 0, flex: 1 }}>{t.title}</h1>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: st.color }}>{st.label}</span>
      </div>

      {art && <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", display: "flex", justifyContent: "center", padding: "12px 0", marginBottom: 14 }}><img src={art.file_url} alt="" style={{ maxWidth: "100%", maxHeight: "42vh", objectFit: "contain" }} /></div>}

      {/* your move — approve the design / request a change */}
      {t.state === "with_client" && (
        <div style={{ background: "linear-gradient(180deg,rgba(244,178,43,.09),transparent)", border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.03em", textTransform: "uppercase", color: C.amber }}>◆ Your design's ready to sign off</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>You're approving the <b style={{ color: C.text }}>artwork</b> — that it's right. Pricing and your order come next, on their own.</div>
          {!changing ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={approve} style={{ flex: 1, minWidth: 160, background: C.green, color: "#08210a", border: "none", borderRadius: 999, padding: "14px", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>✓ Approve the design</button>
              <button onClick={() => setChanging(true)} style={{ ...ghostBtn, padding: "14px 16px" }}>Request a change</button>
            </div>
          ) : (
            <div style={{ marginTop: 12, border: `1px dashed rgba(255,255,255,.22)`, borderRadius: 12, padding: 13 }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Tell us what to change</div>
              <textarea value={chNote} onChange={e => setChNote(e.target.value)} rows={2} placeholder="What would you like different?" style={{ ...inp, resize: "vertical" }} />
              {chFile && <div style={{ marginTop: 8 }}><img src={chFile.url} alt="" style={{ maxHeight: 70, borderRadius: 8, background: "#fff", border: `1px solid ${C.line}` }} /></div>}
              <input ref={chIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onChFile(f); if (chIn.current) chIn.current.value = ""; }} />
              <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                <button disabled={uploading} onClick={() => chIn.current?.click()} style={{ ...ghostBtn, color: C.blue, borderColor: "rgba(143,199,216,.4)" }}>{uploading ? "Uploading…" : "📎 Add a photo of what you mean"}</button>
                <button disabled={busy || (!chNote.trim() && !chFile)} onClick={sendChange} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || (!chNote.trim() && !chFile) ? 0.5 : 1 }}>Send it back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {t.state === "approved" && <div style={{ background: "rgba(88,201,60,.08)", border: `1px solid rgba(88,201,60,.35)`, borderRadius: 16, padding: "16px 18px", marginBottom: 16, fontSize: 13, color: C.dim }}><b style={{ color: C.green }}>✓ Design approved.</b> The artwork's locked — the team takes it from here.</div>}
      {t.state === "working" && <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 16, textAlign: "center" }}>We&rsquo;re working on this — you&rsquo;ll get a note here the moment it&rsquo;s ready for you.</div>}

      {/* the conversation */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {msgs.map((m: any) => (
          <div key={m.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.line2}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: m.sender_role === "client" ? C.purple : C.text }}>{m.sender_role === "client" ? "You" : "House Party Distro"}</span>
              {m.kind === "approval" && <span style={{ fontSize: 8, fontWeight: 800, color: C.green }}>◆ APPROVED</span>}
              {m.kind === "change_request" && <span style={{ fontSize: 8, fontWeight: 800, color: C.red }}>↩ CHANGE</span>}
              <span style={{ fontSize: 10, fontFamily: C.mono, color: C.faint, marginLeft: "auto" }}>{fmt(m.created_at)}</span>
            </div>
            {m.body && <div style={{ fontSize: 14, color: m.sender_role === "client" ? C.dim : C.text, lineHeight: 1.45 }}>{m.body}</div>}
            {m.file_url && <a href={m.file_url} target="_blank" rel="noreferrer"><img src={m.file_url} alt="" style={{ maxHeight: 100, borderRadius: 8, marginTop: 7, background: "#fff", border: `1px solid ${C.line}` }} /></a>}
          </div>
        ))}
      </div>

      {/* reply */}
      {t.state !== "approved" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reply…" style={{ ...inp, flex: 1, minWidth: 140 }} />
          <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onReplyFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
          <button disabled={uploading} onClick={() => fileIn.current?.click()} style={ghostBtn}>{uploading ? "…" : "📎"}</button>
          <button disabled={busy || !note.trim()} onClick={() => reply()} style={{ ...primaryBtn, opacity: busy || !note.trim() ? 0.5 : 1 }}>Send</button>
        </div>
      )}
    </div>
  );
}

function ShareForm({ token, onClose, onDone }: any) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const fileIn = useRef<HTMLInputElement | null>(null);
  async function pick(f: File) { setUploading(true); try { setFile(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function go() {
    if (!title.trim()) { alert("Give it a name."); return; }
    setBusy(true);
    try { const r = await fetch("/api/lab/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientToken: token, title: title.trim(), body: body.trim() || null, fileUrl: file?.url || null, fileName: file?.name || null }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); onDone(j.thread.id); } catch (e: any) { alert(e.message); setBusy(false); }
  }
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", marginBottom: 26, maxWidth: 520, margin: "0 auto 26px" }}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Calling it something…" style={{ ...inp, fontSize: 16, fontWeight: 800, border: "none", borderBottom: `1px solid ${C.line}`, borderRadius: 0, padding: "6px 0" }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="What's the vibe? references, garment, timing — anything." style={{ ...inp, border: "none", padding: "10px 0", resize: "vertical" }} />
      {file && <div style={{ marginBottom: 8 }}><img src={file.url} alt="" style={{ maxHeight: 90, borderRadius: 8, background: "#fff", border: `1px solid ${C.line}` }} /></div>}
      <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); if (fileIn.current) fileIn.current.value = ""; }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button disabled={uploading} onClick={() => fileIn.current?.click()} style={ghostBtn}>{uploading ? "Uploading…" : "+ Photo"}</button>
        <button onClick={onClose} style={{ ...ghostBtn, border: "none", color: C.faint }}>Not now</button>
        <button disabled={busy} onClick={go} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy ? 0.5 : 1 }}>{busy ? "Sending…" : "Send it"}</button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, color: C.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: C.font };

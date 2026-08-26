"use client";
import { useEffect, useRef, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp, fmtDue, ago } from "@/lib/studio-theme";
import { woState, woTypeLabel, type BriefSpec, type DesignWorkOrder } from "@/lib/design-work-orders";
import PinBrief from "@/components/studio/PinBrief";
import { useConfirm } from "@/components/useConfirm";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";

// THE WORK ORDER, our side — the designer link, the pinned brief (editable in
// place: the designer's page reads the same row), their deliveries, the
// thread, reply / revise / Accept = the file. Opening it clears the unread
// clock on the desk.
type Props = { woId: string; brief: any; onClose: () => void; onChanged?: () => void };
const thumb = (id: string, size = 900) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;

export default function WorkOrderPanel({ woId, brief, onClose, onChanged }: Props) {
  const [wo, setWo] = useState<DesignWorkOrder | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [staged, setStaged] = useState<{ f: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState("");
  const [err, setErr] = useState("");
  const [heroId, setHeroId] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ headline: string; instructions: string; dueBy: string; brief: BriefSpec } | null>(null);
  const [copied, setCopied] = useState(false);
  const fileIn = useRef<HTMLInputElement | null>(null);
  const [confirm, confirmEl] = useConfirm();

  async function load() {
    const j = await fetch(`/api/studio/work-orders/${woId}`).then(r => r.json()).catch(() => null);
    if (!j || j.error) return;
    setWo(j.workOrder); setMsgs(j.messages || []); setUrl(j.url || "");
    if (showBrief === null) setShowBrief(!(j.messages || []).some((m: any) => m.sender_role === "designer" && m.kind === "delivery"));
  }
  useEffect(() => {
    load();
    fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen" }) }).then(() => onChanged?.()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);
  const refresh = async () => { await load(); onChanged?.(); };

  const deliveries = msgs.filter(m => m.image_url && m.sender_role === "designer");
  const ours = msgs.filter(m => m.image_url && m.sender_role === "hpd");
  const files = [...deliveries, ...ours].sort((a, z) => String(a.created_at).localeCompare(String(z.created_at)));
  const hero = files.find(f => f.id === heroId) || (deliveries.length ? deliveries[deliveries.length - 1] : files[files.length - 1] || null);
  const words = msgs.filter(m => m.body && m.body.trim());

  async function uploadRef(f: File) {
    return uploadToDrive({ blob: f, fileName: f.name, mimeType: f.type || "application/octet-stream", itemId: null, clientName: brief?.clients?.name || "Studio", projectTitle: "Studio", itemName: brief?.title || wo?.title || "Design", onProgress: (p: number) => setPct(`${p}%`) });
  }
  async function send() {
    if (!note.trim() && !staged) return; setBusy(true); setErr("");
    try {
      let filePart: any = {};
      if (staged) { const up = await uploadRef(staged.f); filePart = { fileId: up.fileId, webViewLink: up.webViewLink, fileName: staged.f.name, mimeType: staged.f.type || null, fileSize: staged.f.size }; }
      const r = await fetch(`/api/studio/work-orders/${woId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: note.trim() || null, ...filePart }) }).then(x => x.json());
      if (r.error) { setErr(r.error); return; }
      if (staged) URL.revokeObjectURL(staged.url);
      setNote(""); setStaged(null); setHeroId(null); await refresh();
    } catch (e: any) { setErr(e?.message || "Didn't send — try again."); }
    finally { setBusy(false); setPct(""); }
  }
  async function accept() {
    if (!await confirm({ title: "Accept this delivery?", message: "The latest designer file becomes THE file for this design. The order closes and the designer's link goes read-only.", confirmLabel: "Accept — this is the file", confirmColor: H.green })) return;
    setBusy(true); try { const r = await fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept" }) }).then(x => x.json()); if (r.error) setErr(r.error); await refresh(); } finally { setBusy(false); }
  }
  async function kill() {
    if (!await confirm({ title: "Pull this order?", message: "The designer's link stops working. The thread stays here as the record. You can reopen it.", confirmLabel: "Pull it" })) return;
    setBusy(true); try { await fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kill" }) }); await refresh(); } finally { setBusy(false); }
  }
  async function reopen() { setBusy(true); try { await fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen" }) }); await refresh(); } finally { setBusy(false); } }
  function startEdit() { if (!wo) return; setDraft({ headline: wo.headline || "", instructions: wo.instructions || "", dueBy: wo.due_by || "", brief: JSON.parse(JSON.stringify(wo.brief || { canvases: [], extras: [] })) }); setEditing(true); setShowBrief(true); }
  async function saveEdit() {
    if (!draft) return; setBusy(true); setErr("");
    try { const r = await fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headline: draft.headline.trim() || null, instructions: draft.instructions.trim() || null, dueBy: draft.dueBy || null, brief: draft.brief }) }).then(x => x.json()); if (r.error) { setErr(r.error); return; } setEditing(false); setDraft(null); await refresh(); }
    finally { setBusy(false); }
  }
  async function uploadPinImage(f: File) { const up = await uploadRef(f); return { driveId: up.fileId as string, name: f.name }; }

  if (!wo) return <div style={{ padding: 30, color: H.faint, fontSize: 13 }}>Opening the work order…</div>;
  const st = woState(wo); const closed = wo.state === "accepted" || wo.state === "killed";
  const spec: BriefSpec = editing && draft ? draft.brief : (wo.brief || { canvases: [], extras: [] });

  return (
    <>
      {confirmEl}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={tag(H.faint, 9.5)}>Designer · Room 2</div>
          <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>{woTypeLabel(wo.type)}{wo.title ? <span style={{ color: H.dim }}> · {wo.title}</span> : null}</div>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 5 }}>
            <span style={tag(st.color)}>{st.label}</span>
            {wo.due_by && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: st.late ? H.red : H.faint }}>due {fmtDue(wo.due_by)}{st.late ? " · late" : ""}</span>}
            {(wo.designer_name || wo.designer_email) && <span style={{ fontSize: 10.5, color: H.faint }}>{wo.designer_name || wo.designer_email}{wo.sent_at ? " · emailed" : ""}</span>}
            {wo.last_designer_at && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>their last word {ago(wo.last_designer_at)}</span>}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>

      {!closed && (
        <div style={{ margin: "6px 22px 0", padding: "10px 12px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10 }}>
          <div style={{ ...tag(H.faint, 8.5), marginBottom: 6 }}>Designer link — no login. {wo.sent_at ? "Already emailed; paste it anywhere else too." : "Send it however you like."}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={url} onFocus={e => e.currentTarget.select()} style={{ ...inp, flex: 1, minWidth: 160, fontSize: 11, fontFamily: H.mono, padding: "8px 10px" }} />
            <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={ghostBtn}>{copied ? "✓ Copied" : "Copy"}</button>
            <a href={url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>Open ↗</a>
          </div>
        </div>
      )}

      {/* THE BRIEF — pinned, live-editable */}
      <div style={{ margin: "12px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setShowBrief(v => !v)} style={{ background: "none", border: "none", color: H.text, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: 0 }}>{showBrief ? "▾" : "▸"} The brief · {spec.canvases.length} canvas{spec.canvases.length === 1 ? "" : "es"} · {spec.canvases.reduce((n, c) => n + (c.pins?.length || 0), 0)} pins · {spec.extras.length} more files{(spec.conversation || []).length ? ` · ${(spec.conversation || []).length} lines of the conversation` : ""}</button>
          {!closed && !editing && <button onClick={startEdit} style={{ marginLeft: "auto", background: "none", border: "none", color: H.blue, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: 0 }}>Edit brief</button>}
          {editing && <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button disabled={busy} onClick={() => { setEditing(false); setDraft(null); }} style={{ ...ghostBtn, border: "none", color: H.faint, padding: "6px 8px" }}>Cancel</button>
            <button disabled={busy} onClick={saveEdit} style={{ ...primaryBtn, padding: "7px 14px" }}>{busy ? "Saving…" : "Save — designer sees it live"}</button>
          </span>}
        </div>
        {showBrief && (
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {editing && draft ? (
              <>
                <input value={draft.headline} onChange={e => setDraft({ ...draft, headline: e.target.value })} placeholder="The one line that rules — e.g. KEEP EXACT STYLE" style={{ ...inp, fontSize: 15, fontWeight: 800, textTransform: "uppercase" }} />
                <textarea value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} rows={2} placeholder="Notes" style={{ ...inp, resize: "vertical" }} />
                <div style={{ maxWidth: 220 }}><label style={lbl}>Due by</label><input type="date" value={draft.dueBy} onChange={e => setDraft({ ...draft, dueBy: e.target.value })} style={inp} /></div>
              </>
            ) : (
              <>
                {wo.headline && <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em" }}>{wo.headline}</div>}
                {wo.instructions && <div style={{ fontSize: 13, color: H.dim, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{wo.instructions}</div>}
              </>
            )}
            {spec.canvases.map((c, i) => (
              <div key={c.id} style={{ padding: 12, background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 14 }}>
                <div style={{ ...tag(H.amber, 9), marginBottom: 8 }}>Canvas {i + 1}</div>
                <PinBrief canvas={c} imgSrc={(id, size) => thumb(id, size || 900)} readOnly={!editing} onChange={next => draft && setDraft({ ...draft, brief: { ...draft.brief, canvases: draft.brief.canvases.map(x => x.id === c.id ? next : x) } })} onUploadImage={uploadPinImage} />
              </div>
            ))}
            {(spec.conversation || []).length > 0 && !editing && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={tag(H.faint, 8.5)}>The conversation they got · roles only</span>
                {(spec.conversation || []).map((l, i) => <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.45 }}><span style={{ ...tag(l.role === "client" ? H.blue : H.dim, 8.5), flexShrink: 0, width: 44, paddingTop: 2 }}>{l.role === "client" ? "Client" : "Us"}</span><span style={{ whiteSpace: "pre-wrap", color: H.dim }}>{l.text}</span></div>)}
              </div>
            )}
            {spec.extras.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={tag(H.faint, 8.5)}>Also handed over</span>
                {spec.extras.map(e => <span key={e.driveId} style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#fff" }}><img src={thumb(e.previewId || e.driveId, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(ev: any) => { ev.target.style.opacity = 0.2; }} /></span>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* deliveries + our references — latest delivery big */}
      {hero && (
        <div style={{ marginTop: 14 }}>
          <div style={{ background: "#fff", position: "relative" }}>
            <img src={hero.image_url} alt="" referrerPolicy="no-referrer" style={{ width: "100%", maxHeight: "40vh", objectFit: "contain", display: "block", margin: "0 auto" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
            <span style={{ position: "absolute", left: 10, bottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ ...tag(hero.sender_role === "designer" ? "#3c9a2e" : "#666", 8.5), background: "rgba(255,255,255,0.92)", borderRadius: 6, padding: "4px 9px" }}>{hero.sender_role === "designer" ? "Designer delivery" : "Our reference"}{hero.file_name ? ` · ${hero.file_name}` : ""}</span>
              {hero.download_url && <a href={hero.download_url} style={{ ...tag(H.green, 8.5), background: H.ink, borderRadius: 6, padding: "4px 9px", textDecoration: "none" }}>↓ Download</a>}
              {wo.accepted_file_id && hero.file_id === wo.accepted_file_id && <span style={{ ...tag(H.green, 8.5), background: H.ink, borderRadius: 6, padding: "4px 9px" }}>✓ The file</span>}
            </span>
          </div>
          {files.length > 1 && (
            <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", overflowX: "auto" }}>
              {files.map(f => { const active = f.id === hero.id; return (
                <button key={f.id} onClick={() => setHeroId(f.id)} style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.6, position: "relative" }}>
                  <img src={f.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  {f.sender_role === "designer" && <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 2px rgba(88,201,60,.75)", borderRadius: 8, pointerEvents: "none" }} />}
                </button>
              ); })}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "14px 22px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "30vh", overflowY: "auto" }}>
        {words.length === 0 ? <div style={{ fontSize: 13, color: H.faint }}>No words yet.</div> : words.map((m: any) => {
          const mine = m.sender_role === "hpd"; const sys = /^[✓✕↩]/.test(String(m.body || ""));
          if (sys) return <div key={m.id} style={{ alignSelf: "center", ...tag(String(m.body).startsWith("✓") ? H.green : H.faint, 10) }}>{m.body}</div>;
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%", background: mine ? "#fff" : H.surface, color: mine ? H.ink : H.text, borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              <span style={{ display: "block", ...tag(mine ? "rgba(10,10,10,0.45)" : H.faint, 8.5), marginBottom: 3 }}>{m.sender_name || m.sender_role} · {fmtStamp(m.created_at)}{m.kind === "delivery" ? " · delivered a file" : m.kind === "revision" ? " · revision asked" : ""}</span>
              {m.body}
            </div>
          );
        })}
      </div>

      {wo.state === "accepted" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: H.dim }}><b style={{ color: H.green }}>✓ Accepted</b> · {fmtStamp(wo.updated_at)}. The file is on the design (internal until you share it with the client).</div>
      ) : wo.state === "killed" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, fontSize: 13, color: H.faint, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}><span><b style={{ color: H.faint }}>✕ Pulled</b> · the link is dead.</span><button disabled={busy} onClick={reopen} style={{ ...ghostBtn, padding: "7px 12px" }}>↩ Reopen</button></div>
      ) : (
        <>
          {deliveries.length > 0 && <div style={{ padding: "12px 22px 0" }}><button disabled={busy} onClick={accept} style={{ ...primaryBtn, width: "100%", padding: "13px", background: H.green, color: "#08210a" }}>✓ Accept — this is the file</button></div>}
          <div style={{ padding: "12px 22px 6px" }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={deliveries.length ? "What to change, or a question…" : "Message the designer…"} style={{ ...inp, resize: "vertical", marginBottom: staged ? 10 : 0 }} />
            {staged && <div style={{ display: "inline-flex", position: "relative", marginBottom: 10 }}><img src={staged.url} alt="" style={{ maxHeight: 72, borderRadius: 8, background: "#fff", border: `1px solid ${H.line}` }} onError={(e: any) => { e.target.style.minWidth = "56px"; e.target.style.minHeight = "56px"; }} /><button onClick={() => { URL.revokeObjectURL(staged.url); setStaged(null); }} aria-label="Remove" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: H.ink, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button></div>}
            {err && <div style={{ fontSize: 12, color: H.red, marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={fileIn} type="file" accept="image/*,.pdf,.ai,.psd,.eps,.svg" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) setStaged({ f, url: URL.createObjectURL(f) }); if (fileIn.current) fileIn.current.value = ""; }} />
              <button disabled={!!staged} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: staged ? 0.5 : 1 }}>{staged ? "✓ Attached" : "+ Attach a reference"}</button>
              <button disabled={busy} onClick={kill} style={{ background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Pull the order</button>
              <button disabled={busy || (!note.trim() && !staged)} onClick={send} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || (!note.trim() && !staged) ? 0.5 : 1 }}>{busy ? (pct ? `Sending… ${pct}` : "Sending…") : deliveries.length && wo.state === "delivered" ? "Ask for changes" : "Send"}</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

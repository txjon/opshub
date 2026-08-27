"use client";
import { useEffect, useRef, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp, fmtDue, ago } from "@/lib/studio-theme";
import { woState, woTypeLabel, woWho, newPinId, type BriefSpec, type DesignWorkOrder, type WoTarget } from "@/lib/design-work-orders";
import { createClient } from "@/lib/supabase/client";
import PinBrief from "@/components/studio/PinBrief";
import Lightbox, { type LightboxItem } from "@/components/studio/Lightbox";
import { useConfirm } from "@/components/useConfirm";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";

// THE WORK ORDER, our side — the designer link, the pinned brief (editable in
// place: the designer's page reads the same row), their deliveries, the
// thread, reply / revise / Accept = the file. Opening it clears the unread
// clock on the desk.
type Note = { id: string; sender_role: string; body: string; visibility?: string; created_at: string };
// inline = rendered as a TAB inside the brief sheet (no own header/close; the
// sheet owns those). onDirty lets the sheet refuse tab switches / backdrop
// clicks while there's unsaved work here.
type Props = { woId: string; target: WoTarget; notes?: Note[]; inline?: boolean; onClose: () => void; onChanged?: () => void; onDirty?: (d: boolean) => void };
const thumb = (id: string, size = 900) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;

export default function WorkOrderPanel({ woId, target, notes = [], inline, onClose, onChanged, onDirty }: Props) {
  const uploadOpts = { itemId: target.kind === "item" ? target.id : null, clientName: target.clientName || "Studio", projectTitle: target.kind === "item" ? (target.jobTitle || "Project") : "Studio", itemName: target.title || "Design" };
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
  const [copiedSlack, setCopiedSlack] = useState(false);
  const [resent, setResent] = useState("");
  // A paste-ready blurb for Slack (the interim pointer): what, when, the link.
  // Never the client's name.
  function slackCopy(): string {
    if (!wo) return "";
    const what = `${woTypeLabel(wo.type)} · ${wo.title || "design"}${target.jobNumber ? ` (${target.jobNumber})` : ""}`;
    const lines = [
      `Work order — ${what}${wo.due_by ? ` · due ${fmtDue(wo.due_by)}` : ""}`,
      wo.headline ? wo.headline : null,
      `Brief, files and delivery are all at the link (no login):`,
      url,
      `Deliver the file on that page — it lands on our side instantly.`,
    ].filter(Boolean);
    return lines.join("\n");
  }
  async function resend() {
    setBusy(true); setErr(""); setResent("");
    try { const r = await fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend" }) }).then(x => x.json()); if (r.error) { setErr(r.error); return; } setResent(`Sent to ${wo?.designer_email}`); setTimeout(() => setResent(""), 4000); await refresh(); }
    finally { setBusy(false); }
  }
  const fileIn = useRef<HTMLInputElement | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const [lit, setLit] = useState<LightboxItem | null>(null);
  const [copiedLine, setCopiedLine] = useState<string | null>(null);
  const [addingRef, setAddingRef] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const refIn = useRef<HTMLInputElement | null>(null);
  const lines = notes.filter(n => n.body && n.body.trim() && !/^[✓✕↩]/.test(n.body.trim()) && !/^(Handed to a designer|Pulled back into the works)/.test(n.body.trim()));
  const dlOf = (id: string, name?: string | null) => `/api/files/view/${encodeURIComponent(name || "file")}?id=${id}&download=1`;

  async function load() {
    const j = await fetch(`/api/studio/work-orders/${woId}`).then(r => r.json()).catch(() => null);
    if (!j || j.error) return;
    setWo(j.workOrder); setMsgs(j.messages || []); setUrl(j.url || "");
    if (showBrief === null) setShowBrief(!(j.messages || []).some((m: any) => m.sender_role === "designer" && m.kind === "delivery" && m.image_url));
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
    return uploadToDrive({ blob: f, fileName: f.name, mimeType: f.type || "application/octet-stream", ...uploadOpts, onProgress: (p: number) => setPct(`${p}%`) });
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
  // A pulled order can be deleted outright (declutter): the order and its
  // thread go; any file already filed on the design / item stays.
  async function deleteOrder() {
    if (!await confirm({ title: "Delete this order?", message: "The order and its thread are removed for good. Files it already delivered stay on the design. The link is already dead.", confirmLabel: "Delete order" })) return;
    setBusy(true); try { await fetch(`/api/studio/work-orders/${woId}`, { method: "DELETE" }); onChanged?.(); onClose(); } finally { setBusy(false); }
  }
  function startEdit() { if (!wo) return; setDraft({ headline: wo.headline || "", instructions: wo.instructions || "", dueBy: wo.due_by || "", brief: JSON.parse(JSON.stringify(wo.brief || { canvases: [], extras: [] })) }); setEditing(true); setShowBrief(true); }
  async function saveEdit() {
    if (!draft) return; setBusy(true); setErr("");
    try { const r = await fetch(`/api/studio/work-orders/${woId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headline: draft.headline.trim() || null, instructions: draft.instructions.trim() || null, dueBy: draft.dueBy || null, brief: draft.brief }) }).then(x => x.json()); if (r.error) { setErr(r.error); return; } setEditing(false); setDraft(null); await refresh(); }
    finally { setBusy(false); }
  }
  async function uploadPinImage(f: File) { const up = await uploadRef(f); return { driveId: up.fileId as string, name: f.name }; }
  // × only (the backdrop never closes this), and × asks first when there's
  // an unsaved brief edit or an unsent reply.
  const dirty = editing || !!note.trim() || !!staged;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  async function requestClose() {
    if (busy) return;
    if (dirty && !await confirm({ title: "Leave this order?", message: editing ? "Your brief edits haven't been saved. Leaving throws them away." : "Your reply hasn't been sent. Leaving throws it away.", confirmLabel: "Throw it away" })) return;
    onClose();
  }
  // A NEW reference to pin on: browser → Drive, registered as a real (internal)
  // brief file so it lives with the design, then it's a canvas.
  async function addReference(f: File) {
    if (!draft) return; setAddingRef(true); setErr("");
    try {
      const up = await uploadRef(f);
      let fileId: string | null = null;
      if (target.kind === "item") { const { data } = await createClient().from("item_files").insert({ item_id: target.id, file_name: f.name, stage: "client_art", drive_file_id: up.fileId, drive_link: up.webViewLink, mime_type: f.type || null, file_size: f.size, approval: "none" } as any).select("id").single(); fileId = (data as any)?.id || null; }
      else { const reg = await fetch(`/api/studio/briefs/${target.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: up.fileId, webViewLink: up.webViewLink, fileName: f.name, mimeType: f.type || null, fileSize: f.size, visibility: "internal" }) }).then(r => r.json()).catch(() => ({})); fileId = reg?.fileRowId || null; }
      setDraft(d => d ? { ...d, brief: { ...d.brief, canvases: [...d.brief.canvases, { id: newPinId(), fileId, driveId: up.fileId, previewId: null, name: f.name, note: "", pins: [] }] } } : d);
    } catch (e: any) { setErr(e?.message || "Couldn't add that reference."); }
    finally { setAddingRef(false); setPct(""); }
  }
  const promote = (driveId: string) => setDraft(d => { if (!d) return d; const ex = d.brief.extras.find(e => e.driveId === driveId); if (!ex) return d; return { ...d, brief: { ...d.brief, extras: d.brief.extras.filter(e => e.driveId !== driveId), canvases: [...d.brief.canvases, { id: newPinId(), fileId: ex.fileId, driveId: ex.driveId, previewId: ex.previewId, name: ex.name, note: "", pins: [] }] } }; });
  const demote = (canvasId: string) => setDraft(d => { if (!d) return d; const c = d.brief.canvases.find(x => x.id === canvasId); if (!c) return d; return { ...d, brief: { ...d.brief, canvases: d.brief.canvases.filter(x => x.id !== canvasId), extras: [...d.brief.extras, { fileId: c.fileId, driveId: c.driveId, previewId: c.previewId, name: c.name }] } }; });
  const lineOn = (n: Note) => !!draft?.brief.conversation?.some(l => l.text === n.body.trim());
  const toggleLine = (n: Note) => setDraft(d => { if (!d) return d; const conv = d.brief.conversation || []; const text = n.body.trim(); const has = conv.some(l => l.text === text); return { ...d, brief: { ...d.brief, conversation: has ? conv.filter(l => l.text !== text) : [...conv, { role: (n.sender_role === "client" ? "client" : "us") as "client" | "us", text, at: n.created_at }].sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))) } }; });
  async function copyLine(n: Note) { try { await navigator.clipboard.writeText(n.body.trim()); setCopiedLine(n.id); setTimeout(() => setCopiedLine(null), 1200); } catch {} }

  if (!wo) return <div style={{ padding: 30, color: H.faint, fontSize: 13 }}>Opening the work order…</div>;
  const st = woState(wo); const closed = wo.state === "accepted" || wo.state === "killed";
  const spec: BriefSpec = editing && draft ? draft.brief : (wo.brief || { canvases: [], extras: [] });

  return (
    <>
      {confirmEl}
      <Lightbox item={lit} onClose={() => setLit(null)} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: inline ? "12px 22px 4px" : "18px 22px 6px" }}>
        <div style={{ minWidth: 0 }}>
          {!inline && <div style={tag(H.faint, 9.5)}>Designer · Room 2</div>}
          <div style={{ fontSize: inline ? 14 : 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>{inline ? <>{woWho(wo)} <span style={{ color: H.dim }}>· {woTypeLabel(wo.type)}</span></> : <>{woTypeLabel(wo.type)}{wo.title ? <span style={{ color: H.dim }}> · {wo.title}</span> : null}</>}</div>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 5 }}>
            <span style={tag(st.color)}>{st.label}</span>
            {wo.due_by && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: st.late ? H.red : H.faint }}>due {fmtDue(wo.due_by)}{st.late ? " · late" : ""}</span>}
            {(wo.designer_name || wo.designer_email) && <span style={{ fontSize: 10.5, color: H.faint }}>{wo.designer_name || wo.designer_email}{wo.sent_at ? " · emailed" : ""}</span>}
            {wo.last_designer_at && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>their last word {ago(wo.last_designer_at)}</span>}
          </div>
        </div>
        {!inline && <button onClick={requestClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>}
      </div>

      {!closed && (
        <div style={{ margin: "6px 22px 0", padding: "10px 12px", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10 }}>
          <div style={{ ...tag(H.faint, 8.5), marginBottom: 6 }}>Designer link — no login. {wo.sent_at ? "Already emailed; paste it anywhere else too." : "Send it however you like."}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={url} onFocus={e => e.currentTarget.select()} style={{ ...inp, flex: 1, minWidth: 160, fontSize: 11, fontFamily: H.mono, padding: "8px 10px" }} />
            <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={ghostBtn}>{copied ? "✓ Copied" : "Copy"}</button>
            <a href={url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>Open ↗</a>
            <a href={`${url.replace(/\/designer\//, "/api/designer/")}/packet`} target="_blank" rel="noreferrer" title="The brief as a PDF (what the designer's Download package includes)" style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>PDF</a>
            <button onClick={() => { navigator.clipboard.writeText(slackCopy()); setCopiedSlack(true); setTimeout(() => setCopiedSlack(false), 1500); }} title="A paste-ready message with the link" style={ghostBtn}>{copiedSlack ? "✓ Copied" : "Copy for Slack"}</button>
            {wo.designer_email && <button disabled={busy} onClick={resend} title={`Email the link again to ${wo.designer_email}`} style={{ ...ghostBtn, color: H.blue, borderColor: "rgba(143,199,216,.4)", opacity: busy ? 0.6 : 1 }}>{resent ? `✓ ${resent}` : "Resend link"}</button>}
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
                <div>
                  <label style={lbl}>Pin on · tap a handed-over image to make it a canvas, or add a new reference</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {draft.brief.extras.map(e => (
                      <button key={e.driveId} type="button" onClick={() => promote(e.driveId)} title="Make this a canvas" style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#fff", border: `1px solid ${H.line}`, padding: 0, cursor: "pointer", position: "relative" }}>
                        <img src={thumb(e.previewId || e.driveId, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(ev: any) => { ev.target.style.opacity = 0.2; }} />
                        <span style={{ position: "absolute", right: 3, bottom: 3, background: H.ink, color: H.amber, borderRadius: 6, fontSize: 9, fontWeight: 900, padding: "2px 5px" }}>📌</span>
                      </button>
                    ))}
                    <input ref={refIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) addReference(f); if (refIn.current) refIn.current.value = ""; }} />
                    <button type="button" disabled={addingRef} onClick={() => refIn.current?.click()} style={{ ...ghostBtn, color: H.blue, borderColor: "rgba(143,199,216,.4)", opacity: addingRef ? 0.6 : 1 }}>{addingRef ? (pct ? `Uploading ${pct}` : "Uploading…") : "+ New reference to pin on"}</button>
                  </div>
                </div>
                {lines.length > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowChat(v => !v)} style={{ ...lbl, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", fontFamily: H.font }}>{showChat ? "▾" : "▸"} The conversation · {lines.length} lines{(draft.brief.conversation || []).length ? ` · ${(draft.brief.conversation || []).length} go with it` : ""} · select any text, or copy a whole line</button>
                    {showChat && <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                      {lines.map(n => { const on = lineOn(n); const client = n.sender_role === "client"; return (
                        <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: H.surface, border: `1px solid ${on ? H.line : H.line2}`, borderRadius: 10, padding: "7px 10px", opacity: on ? 1 : 0.55 }}>
                          <span style={{ ...tag(client ? H.blue : n.visibility === "internal" ? H.amber : H.dim, 8.5), flexShrink: 0, width: 46, paddingTop: 2 }}>{client ? "Client" : n.visibility === "internal" ? "Internal" : "Us"}</span>
                          <span style={{ flex: 1, color: H.text, fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap", userSelect: "text", cursor: "text" }}>{n.body}</span>
                          <button type="button" onClick={() => copyLine(n)} title="Copy the whole line" style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", ...tag(copiedLine === n.id ? H.green : H.faint, 9), fontFamily: H.font }}>{copiedLine === n.id ? "✓ copied" : "copy"}</button>
                          <button type="button" onClick={() => toggleLine(n)} title={on ? "Goes with the order — tap to leave it out" : "Stays here — tap to hand it over"} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", ...tag(on ? H.green : H.faint, 9), fontFamily: H.font }}>{on ? "✓ sent" : "hand over"}</button>
                        </div>
                      ); })}
                    </div>}
                  </div>
                )}
              </>
            ) : (
              <>
                {wo.headline && <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em" }}>{wo.headline}</div>}
                {wo.instructions && <div style={{ fontSize: 13, color: H.dim, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{wo.instructions}</div>}
              </>
            )}
            {spec.canvases.map((c, i) => (
              <div key={c.id} style={{ padding: 12, background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={tag(H.amber, 9)}>Canvas {i + 1}</span>
                  {editing && <button type="button" onClick={() => demote(c.id)} style={{ marginLeft: "auto", background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Not a canvas</button>}
                </div>
                <PinBrief canvas={c} imgSrc={(id, size) => thumb(id, size || 900)} readOnly={!editing} onOpenImage={(id, name, caption) => setLit({ src: thumb(id, 1600), downloadHref: dlOf(id, name), name, caption })} onChange={next => draft && setDraft({ ...draft, brief: { ...draft.brief, canvases: draft.brief.canvases.map(x => x.id === c.id ? next : x) } })} onUploadImage={uploadPinImage} />
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
            <img src={hero.image_url} alt="" referrerPolicy="no-referrer" onClick={() => setLit({ src: hero.image_url, downloadHref: hero.download_url, name: hero.file_name, caption: hero.sender_role === "designer" ? "Designer delivery" : "Our reference" })} style={{ width: "100%", maxHeight: "40vh", objectFit: "contain", display: "block", margin: "0 auto", cursor: "zoom-in" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
            <span style={{ position: "absolute", left: 10, bottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ ...tag(hero.sender_role === "designer" ? "#3c9a2e" : "#666", 8.5), background: "rgba(255,255,255,0.92)", borderRadius: 6, padding: "4px 9px" }}>{hero.sender_role === "designer" ? "Designer delivery" : "Our reference"}{hero.file_name ? ` · ${hero.file_name}` : ""}</span>
              {hero.download_url && <a href={hero.download_url} style={{ ...tag(H.green, 8.5), background: H.ink, borderRadius: 6, padding: "4px 9px", textDecoration: "none" }}>↓ Download</a>}
              {((wo.accepted_file_id && hero.file_id === wo.accepted_file_id) || (wo.accepted_item_file_id && hero.item_file_id === wo.accepted_item_file_id)) && <span style={{ ...tag(H.green, 8.5), background: H.ink, borderRadius: 6, padding: "4px 9px" }}>✓ The file</span>}
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
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, background: "rgba(88,201,60,.06)", fontSize: 13, color: H.dim }}><b style={{ color: H.green }}>✓ Accepted</b> · {fmtStamp(wo.updated_at)}. {target.kind === "item" ? "It's the item's print-ready file now — it rides the PO." : "The file is on the design (internal until you share it with the client)."}</div>
      ) : wo.state === "killed" ? (
        <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${H.line}`, fontSize: 13, color: H.faint, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}><span><b style={{ color: H.faint }}>✕ Pulled</b> · the link is dead.</span><button disabled={busy} onClick={reopen} style={{ ...ghostBtn, padding: "7px 12px" }}>↩ Reopen</button><button disabled={busy} onClick={deleteOrder} style={{ background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }} onMouseEnter={e => (e.currentTarget.style.color = H.red)} onMouseLeave={e => (e.currentTarget.style.color = H.faint)}>Delete order</button></div>
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

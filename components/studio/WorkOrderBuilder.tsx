"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag } from "@/lib/studio-theme";
import { WO_TYPES, EMPTY_BRIEF, newPinId, isProductionType, STAGE_LABEL, PRODUCTION_STAGES, type BriefCanvas, type BriefExtra, type BriefSpec, type WoType, type WoTarget } from "@/lib/design-work-orders";
import { createClient } from "@/lib/supabase/client";
import PinBrief from "@/components/studio/PinBrief";
import { useConfirm } from "@/components/useConfirm";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";

// HAND TO A DESIGNER — the builder. Pick what we need made, pin the brief on
// the design's own references (tap a thumbnail → it becomes a canvas), add the
// one-line rule + notes, hand over the rest of the images, send. The client's
// name never leaves this sheet. Replaces Freeform → PDF → Slack.
type Img = { id: string; file_id: string | null; drive_file_id: string | null; file_url: string; file_name: string | null; reaction?: string | null; stage?: string | null };
type Note = { id: string; sender_role: string; body: string; visibility?: string; created_at: string };
// target = the design (art_brief) or the item (a job's run) this order hangs
// off. Runs default to separations; designs to creative.
type Props = { target: WoTarget; images: Img[]; notes?: Note[]; onClose: () => void; onCreated: (r: { id: string; url: string; emailSent: boolean; emailSkipped?: string | null }) => void };

const thumb = (id: string, size = 900) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const previewIdOf = (im: Img) => { const m = /[?&]id=([^&]+)/.exec(im.file_url || ""); const id = m ? decodeURIComponent(m[1]) : null; return id && id !== im.drive_file_id ? id : null; };

export default function WorkOrderBuilder({ target, images, notes = [], onClose, onCreated }: Props) {
  const imgs = useMemo(() => images.filter(i => i.drive_file_id), [images]);
  const uploadOpts = { itemId: target.kind === "item" ? target.id : null, clientName: target.clientName || "Studio", projectTitle: target.kind === "item" ? (target.jobTitle || "Project") : "Studio", itemName: target.title || "Design" };
  const createUrl = target.kind === "item" ? "/api/studio/work-orders" : `/api/studio/briefs/${target.id}/work-orders`;
  // A fresh reference must be REGISTERED on the target so the create route's
  // ownership check accepts it: brief file (internal) or item file (client art).
  async function registerReference(up: any, f: File): Promise<string | null> {
    if (target.kind === "item") {
      const { data } = await createClient().from("item_files").insert({ item_id: target.id, file_name: f.name, stage: "client_art", drive_file_id: up.fileId, drive_link: up.webViewLink, mime_type: f.type || null, file_size: f.size, approval: "none" } as any).select("id").single();
      return (data as any)?.id || null;
    }
    const reg = await fetch(`/api/studio/briefs/${target.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: up.fileId, webViewLink: up.webViewLink, fileName: f.name, mimeType: f.type || null, fileSize: f.size, visibility: "internal" }) }).then(r => r.json()).catch(() => ({}));
    return reg?.fileRowId || null;
  }
  // The conversation: folded, and NOTHING rides along unless tapped on (Jon,
  // Aug 26: "we'll just grab pertinent text to drop in pins"). Tap text = copy.
  const lines = useMemo(() => notes.filter(n => n.body && n.body.trim() && !/^[✓✕↩]/.test(n.body.trim()) && !/^(Handed to a designer|Pulled back into the works)/.test(n.body.trim())), [notes]);
  const [handLines, setHandLines] = useState<Set<string>>(() => new Set());
  const [showChat, setShowChat] = useState(true);
  const toggleLine = (id: string) => setHandLines(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Creative art is STUDIO-only (it bakes into the design); vector clean-up and
  // separations are RUN-only (they live on the item). The picker only shows
  // where there's a choice.
  const typeChoices = target.kind === "item" ? WO_TYPES.filter(t => t.id !== "creative") : WO_TYPES.filter(t => t.id === "creative");
  const [type, setType] = useState<WoType>(target.kind === "item" ? "separations" : "creative");
  // PRODUCTION MODE (seps / vector on a run): the graphic is final. No pins —
  // the item's files by stage (print file · proof · mockup pre-checked) + one
  // note written from the proof spec.
  const production = target.kind === "item" && isProductionType(type);
  const [prodFiles, setProdFiles] = useState<Set<string>>(() => new Set(imgs.filter(i => PRODUCTION_STAGES.includes(i.stage || "")).map(i => i.drive_file_id!)));
  const [prodNote, setProdNote] = useState("");
  const [prodNoteLoaded, setProdNoteLoaded] = useState(false);
  useEffect(() => {
    if (!production || prodNoteLoaded || target.kind !== "item") return;
    fetch(`/api/studio/work-orders/prefill?itemId=${target.id}`).then(r => r.json()).then(j => { if (j.note && !prodNote) setProdNote(j.note); }).catch(() => {}).finally(() => setProdNoteLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production]);
  const toggleProdFile = (id: string) => setProdFiles(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Nothing is pre-selected: what goes to the designer is exactly what you tap
  // (Jon, Aug 26: a hidden default set "could cause sending the wrong things").
  const [spec, setSpec] = useState<BriefSpec>(() => ({ ...EMPTY_BRIEF, canvases: [], extras: [] }));
  const [headline, setHeadline] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueBy, setDueBy] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [designerEmail, setDesignerEmail] = useState("");
  const [known, setKnown] = useState<{ name: string; email: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [addingRef, setAddingRef] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirm, confirmEl] = useConfirm();
  // Work in progress = pins, words, a date, a designer. Closing is × only —
  // never a stray click on the backdrop — and × asks first when there's work.
  const dirty = spec.canvases.some(c => c.pins.length > 0 || (c.note || "").trim()) || !!headline.trim() || !!instructions.trim() || !!dueBy || !!designerName.trim() || !!designerEmail.trim();
  async function requestClose() {
    if (busy) return;
    if (dirty && !await confirm({ title: "Leave this work order?", message: "Your pins and notes here haven't been sent. Leaving throws them away.", confirmLabel: "Throw it away" })) return;
    onClose();
  }
  const refIn = useRef<HTMLInputElement | null>(null);
  // A brand-new reference (not in the thread yet): browser → Drive, registered
  // as a real internal brief file, then it's a canvas.
  async function addReference(f: File) {
    setAddingRef(true); setErr("");
    try {
      const up = await uploadToDrive({ blob: f, fileName: f.name, mimeType: f.type || "image/png", ...uploadOpts, onProgress: undefined });
      const fileId = await registerReference(up, f);
      setSpec(s => ({ ...s, canvases: [...s.canvases, { id: newPinId(), fileId, driveId: up.fileId, previewId: null, name: f.name, note: "", pins: [] }] }));
    } catch (e: any) { setErr(e?.message || "Couldn't add that reference."); }
    finally { setAddingRef(false); }
  }
  async function copyLine(n: Note) { try { await navigator.clipboard.writeText(n.body.trim()); setCopied(n.id); setTimeout(() => setCopied(null), 1200); } catch {} }

  // Designers we've used before — one tap fills both fields.
  useEffect(() => {
    fetch("/api/studio/work-orders").then(r => r.json()).then(j => {
      const seen = new Map<string, { name: string; email: string }>();
      for (const w of (j.workOrders || []) as any[]) if (w.designer_email && !seen.has(w.designer_email)) seen.set(w.designer_email, { name: w.designer_name || "", email: w.designer_email });
      setKnown(Array.from(seen.values()));
    }).catch(() => {});
  }, []);

  const isCanvas = (driveId: string) => spec.canvases.some(c => c.driveId === driveId);
  function toggleCanvas(im: Img) {
    const id = im.drive_file_id!;
    if (isCanvas(id)) setSpec(s => ({ ...s, canvases: s.canvases.filter(c => c.driveId !== id) }));
    else setSpec(s => ({ ...s, canvases: [...s.canvases, { id: newPinId(), fileId: im.file_id, driveId: id, previewId: previewIdOf(im), name: im.file_name, note: "", pins: [] }] }));
  }
  async function uploadPinImage(f: File) {
    const up = await uploadToDrive({ blob: f, fileName: f.name, mimeType: f.type || "image/png", ...uploadOpts, onProgress: undefined });
    return { driveId: up.fileId as string, name: f.name };
  }
  async function go() {
    setErr("");
    if (production) {
      if (!prodFiles.size) { setErr("Pick at least one file to hand over."); return; }
      setBusy(true);
      try {
        const extras = imgs.filter(i => prodFiles.has(i.drive_file_id!)).map(i => ({ fileId: i.file_id, driveId: i.drive_file_id!, previewId: previewIdOf(i), name: i.file_name, label: STAGE_LABEL[i.stage || ""] || null }));
        const r = await fetch(createUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: target.id, type, headline: null, instructions: prodNote.trim() || null, brief: { canvases: [], extras, conversation: [] }, dueBy: dueBy || null, designerName: designerName.trim() || null, designerEmail: designerEmail.trim() || null }) }).then(x => x.json());
        if (r.error) { setErr(r.error); return; }
        onCreated({ id: r.workOrder.id, url: r.url, emailSent: !!r.emailSent, emailSkipped: r.emailSkipped || null });
      } finally { setBusy(false); }
      return;
    }
    if (!spec.canvases.length) { setErr("Tap at least one image to send."); return; }
    const emptyPins = spec.canvases.some(c => c.pins.some(p => !p.text.trim() && !p.driveId));
    if (emptyPins) { setErr("A pin has nothing on it — give it words or an image, or remove it."); return; }
    setBusy(true);
    try {
      const conversation = lines.filter(n => handLines.has(n.id)).map(n => ({ role: n.sender_role === "client" ? "client" : "us", text: n.body.trim(), at: n.created_at }));
      const r = await fetch(createUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(target.kind === "item" ? { itemId: target.id } : {}), type, headline: headline.trim() || null, instructions: instructions.trim() || null, brief: { ...spec, conversation }, dueBy: dueBy || null, designerName: designerName.trim() || null, designerEmail: designerEmail.trim() || null }) }).then(x => x.json());
      if (r.error) { setErr(r.error); return; }
      onCreated({ id: r.workOrder.id, url: r.url, emailSent: !!r.emailSent, emailSkipped: r.emailSkipped || null });
    } finally { setBusy(false); }
  }

  const handing = spec.canvases.length;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 10px", overflowY: "auto" }}>
      <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 20, width: "100%", maxWidth: 860, color: H.text, fontFamily: H.font, overflow: "hidden" }}>
        {confirmEl}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
          <div>
            <div style={tag(H.faint, 9.5)}>Designer · Room 2</div>
            <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginTop: 2 }}>Send to designer</div>
            <div style={{ fontSize: 11.5, color: H.faint, marginTop: 4 }}>{target.title || "Design"}{target.jobNumber ? ` · ${target.jobNumber}` : ""} · the client&rsquo;s name stays here</div>
          </div>
          <button onClick={requestClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {typeChoices.length > 1 && <div style={{ padding: "8px 22px 0" }}>
          <label style={lbl}>What do we need?</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            {typeChoices.map(ty => { const on = type === ty.id; return (
              <button key={ty.id} type="button" onClick={() => setType(ty.id)} style={{ textAlign: "left", background: H.surface, border: on ? "1px solid #fff" : `1px solid ${H.line}`, boxShadow: on ? "inset 0 0 0 1px #fff" : "none", borderRadius: 10, padding: "11px 13px", cursor: "pointer", fontFamily: H.font }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", color: H.text }}>{ty.label}</div>
                <div style={{ fontSize: 11, color: H.dim, marginTop: 2 }}>{ty.blurb}</div>
              </button>
            ); })}
          </div>
        </div>}

        {production ? (
          <>
            <div style={{ padding: "16px 22px 0" }}>
              <label style={lbl}>Files for the designer · {prodFiles.size} of {imgs.length} · the graphic is final, they need the print file, proof and mockup</label>
              {imgs.length === 0 ? <div style={{ fontSize: 12.5, color: H.faint }}>No files on this item yet — upload the print file in Product Builder first.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...PRODUCTION_STAGES, ...Array.from(new Set(imgs.map(i => i.stage || "other"))).filter(st => !PRODUCTION_STAGES.includes(st))].map(st => {
                    const group = imgs.filter(i => (i.stage || "other") === st); if (!group.length) return null;
                    return group.map(im => { const on = prodFiles.has(im.drive_file_id!); return (
                      <button key={im.id} type="button" onClick={() => toggleProdFile(im.drive_file_id!)} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: on ? H.surface : "transparent", border: `1px solid ${on ? H.line : H.line2}`, borderRadius: 10, padding: "7px 10px", cursor: "pointer", color: H.text, fontFamily: H.font, opacity: on ? 1 : 0.5 }}>
                        <span style={{ width: 40, height: 40, borderRadius: 7, overflow: "hidden", background: "#fff", flexShrink: 0 }}><img src={thumb(im.drive_file_id!, 200)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} /></span>
                        <span style={{ ...tag(PRODUCTION_STAGES.includes(st) ? H.green : H.faint, 8.5), width: 64, flexShrink: 0 }}>{STAGE_LABEL[st] || "File"}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: H.mono, color: H.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{im.file_name}</span>
                        <span style={{ flexShrink: 0, ...tag(on ? H.green : H.faint, 9) }}>{on ? "✓" : "off"}</span>
                      </button>
                    ); });
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: "16px 22px 0" }}>
              <label style={lbl}>The note · written from the proof, edit anything</label>
              <textarea value={prodNote} onChange={e => setProdNote(e.target.value)} rows={Math.min(14, Math.max(6, prodNote.split("\n").length + 1))} placeholder={prodNoteLoaded ? "Locations, sizes, placement, ink count, anything the designer needs…" : "Reading the proof…"} style={{ ...inp, resize: "vertical", fontFamily: H.mono, fontSize: 12.5, lineHeight: 1.5 }} />
            </div>
          </>
        ) : (
          <>
        <div style={{ padding: "16px 22px 0" }}>
          <label style={lbl}>What goes to the designer · {spec.canvases.length ? `${spec.canvases.length} image${spec.canvases.length === 1 ? "" : "s"}` : "tap to add"} · pins are optional</label>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, alignItems: "center" }}>
              {imgs.map(im => { const on = isCanvas(im.drive_file_id!); return (
                <button key={im.id} type="button" onClick={() => toggleCanvas(im)} title={on ? "Going to the designer — tap to take it out" : "Tap to send this one"} style={{ position: "relative", flexShrink: 0, width: 64, height: 64, borderRadius: 9, overflow: "hidden", background: "#fff", border: on ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: on ? 1 : 0.55 }}>
                  <img src={thumb(im.drive_file_id!, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  {on && <span style={{ position: "absolute", right: 3, top: 3, background: H.amber, color: H.ink, borderRadius: 999, fontSize: 9, fontWeight: 900, width: 16, height: 16, display: "grid", placeItems: "center" }}>📌</span>}
                </button>
              ); })}
              {spec.canvases.filter(c => !imgs.some(im => im.drive_file_id === c.driveId)).map(c => (
                <span key={c.id} style={{ position: "relative", flexShrink: 0, width: 64, height: 64, borderRadius: 9, overflow: "hidden", background: "#fff", border: "2px solid #fff" }}>
                  <img src={thumb(c.driveId, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <span style={{ position: "absolute", right: 3, top: 3, background: H.amber, color: H.ink, borderRadius: 999, fontSize: 9, fontWeight: 900, width: 16, height: 16, display: "grid", placeItems: "center" }}>📌</span>
                </span>
              ))}
              <input ref={refIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) addReference(f); if (refIn.current) refIn.current.value = ""; }} />
              <button type="button" disabled={addingRef} onClick={() => refIn.current?.click()} style={{ ...ghostBtn, flexShrink: 0, color: H.blue, borderColor: "rgba(143,199,216,.4)", opacity: addingRef ? 0.6 : 1 }}>{addingRef ? "Uploading…" : "+ New reference"}</button>
          </div>
        </div>

        {spec.canvases.map((c, i) => (
          <div key={c.id} style={{ margin: "14px 22px 0", padding: 12, background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={tag(H.amber, 9)}>Image {i + 1}</span>
              <span style={{ fontSize: 10.5, color: H.faint }}>{c.pins.length ? `${c.pins.length} pin${c.pins.length === 1 ? "" : "s"}` : "tap the image to drop a pin, or send it as-is"}</span>
              <button type="button" onClick={() => setSpec(s => ({ ...s, canvases: s.canvases.filter(x => x.id !== c.id) }))} style={{ marginLeft: "auto", background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Take it out</button>
            </div>
            <PinBrief canvas={c} imgSrc={(id, size) => thumb(id, size || 900)} onChange={next => setSpec(s => ({ ...s, canvases: s.canvases.map(x => x.id === c.id ? next : x) }))} onUploadImage={uploadPinImage} />
          </div>
        ))}

        <div style={{ padding: "16px 22px 0" }}>
          <label style={lbl}>The one line that rules <span style={{ color: H.faint }}>(optional)</span></label>
          <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="e.g. KEEP EXACT STYLE" style={{ ...inp, fontSize: 15, fontWeight: 800, textTransform: "uppercase" }} />
          <label style={{ ...lbl, marginTop: 12 }}>Notes <span style={{ color: H.faint }}>(optional)</span></label>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} placeholder="Anything the pins don't say — vibe, colors, format…" style={{ ...inp, resize: "vertical" }} />
        </div>

        {lines.length > 0 && (
          <div style={{ padding: "16px 22px 0" }}>
            <button type="button" onClick={() => setShowChat(v => !v)} style={{ ...lbl, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", fontFamily: H.font }}>{showChat ? "▾" : "▸"} The conversation · {lines.length} lines{handLines.size ? ` · ${handLines.size} go with it` : ""} · select any text, or copy a whole line</button>
            {showChat && <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {lines.map(n => { const on = handLines.has(n.id); const client = n.sender_role === "client"; const whisper = n.visibility === "internal"; return (
                <div key={n.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: on ? H.surface : "transparent", border: `1px ${whisper ? "dashed" : "solid"} ${on ? H.line : H.line2}`, borderRadius: 10, padding: "8px 11px", fontFamily: H.font, color: H.text, opacity: on ? 1 : 0.55 }}>
                  <span style={{ ...tag(client ? H.blue : whisper ? H.amber : H.dim, 8.5), flexShrink: 0, width: 46, paddingTop: 2 }}>{client ? "Client" : whisper ? "Internal" : "Us"}</span>
                  <span style={{ flex: 1, color: H.text, fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap", userSelect: "text", cursor: "text" }}>{n.body}</span>
                  <button type="button" onClick={() => copyLine(n)} title="Copy the whole line" style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", ...tag(copied === n.id ? H.green : H.faint, 9), fontFamily: H.font }}>{copied === n.id ? "✓ copied" : "copy"}</button>
                  <button type="button" onClick={() => toggleLine(n.id)} title={on ? "Goes with the order — tap to leave it out" : "Stays here — tap to hand it over"} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", ...tag(on ? H.green : H.faint, 9), fontFamily: H.font }}>{on ? "✓ sent" : "hand over"}</button>
                </div>
              ); })}
            </div>}
          </div>
        )}
          </>
        )}

        <div style={{ padding: "16px 22px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div><label style={lbl}>Due by</label><input type="date" value={dueBy} onChange={e => setDueBy(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>Designer</label><input value={designerName} onChange={e => setDesignerName(e.target.value)} placeholder="Name" style={inp} list="wo-designer-names" /></div>
          <div><label style={lbl}>Email <span style={{ color: H.faint }}>(sends the link)</span></label><input type="email" value={designerEmail} onChange={e => setDesignerEmail(e.target.value)} placeholder="designer@…" style={inp} list="wo-designer-emails" /></div>
          <datalist id="wo-designer-names">{known.map(k => <option key={k.email} value={k.name} />)}</datalist>
          <datalist id="wo-designer-emails">{known.map(k => <option key={k.email} value={k.email} />)}</datalist>
        </div>
        {known.length > 0 && (
          <div style={{ padding: "8px 22px 0", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={tag(H.faint, 8.5)}>Recent</span>
            {known.slice(0, 6).map(k => <button key={k.email} type="button" onClick={() => { setDesignerName(k.name); setDesignerEmail(k.email); }} style={{ ...ghostBtn, padding: "5px 10px", fontSize: 9.5, textTransform: "none", letterSpacing: 0 }}>{k.name || k.email}</button>)}
          </div>
        )}

        {err && <div style={{ padding: "12px 22px 0", fontSize: 12, color: H.red }}>{err}</div>}
        <div style={{ padding: "16px 22px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: H.faint }}>{production ? `${prodFiles.size} file${prodFiles.size === 1 ? "" : "s"} · one note` : `${handing} image${handing === 1 ? "" : "s"} · ${spec.canvases.reduce((n, c) => n + c.pins.length, 0)} pins`}</span>
          <button disabled={busy} onClick={go} style={{ ...primaryBtn, marginLeft: "auto", padding: "13px 24px", opacity: busy ? 0.6 : 1 }}>{busy ? "Sending…" : designerEmail.trim() ? "Send the work order →" : "Create + copy the link →"}</button>
        </div>
      </div>
    </div>
  );
}

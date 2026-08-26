"use client";
import { useEffect, useMemo, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag } from "@/lib/studio-theme";
import { WO_TYPES, EMPTY_BRIEF, newPinId, type BriefCanvas, type BriefExtra, type BriefSpec, type WoType } from "@/lib/design-work-orders";
import PinBrief from "@/components/studio/PinBrief";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";

// HAND TO A DESIGNER — the builder. Pick what we need made, pin the brief on
// the design's own references (tap a thumbnail → it becomes a canvas), add the
// one-line rule + notes, hand over the rest of the images, send. The client's
// name never leaves this sheet. Replaces Freeform → PDF → Slack.
type Img = { id: string; file_id: string | null; drive_file_id: string | null; file_url: string; file_name: string | null; reaction?: string | null };
type Note = { id: string; sender_role: string; body: string; visibility?: string; created_at: string };
type Props = { brief: any; images: Img[]; notes?: Note[]; onClose: () => void; onCreated: (r: { id: string; url: string; emailSent: boolean }) => void };

const thumb = (id: string, size = 900) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const previewIdOf = (im: Img) => { const m = /[?&]id=([^&]+)/.exec(im.file_url || ""); const id = m ? decodeURIComponent(m[1]) : null; return id && id !== im.drive_file_id ? id : null; };

export default function WorkOrderBuilder({ brief, images, notes = [], onClose, onCreated }: Props) {
  const imgs = useMemo(() => images.filter(i => i.drive_file_id), [images]);
  // The conversation: client-visible lines ride along by default (that IS the
  // direction, in the client's own words); internal notes are off unless tapped.
  const lines = useMemo(() => notes.filter(n => n.body && n.body.trim() && !/^[✓✕↩]/.test(n.body.trim())), [notes]);
  const [handLines, setHandLines] = useState<Set<string>>(() => new Set(lines.filter(n => n.visibility !== "internal").map(n => n.id)));
  const toggleLine = (id: string) => setHandLines(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [type, setType] = useState<WoType>("creative");
  const [spec, setSpec] = useState<BriefSpec>(() => {
    // The latest live image is the first canvas — the brief usually pins on it.
    const live = imgs.filter(i => i.reaction !== "down");
    const first = live[live.length - 1] || imgs[imgs.length - 1];
    const canvases: BriefCanvas[] = first ? [{ id: newPinId(), fileId: first.file_id, driveId: first.drive_file_id!, previewId: previewIdOf(first), name: first.file_name, note: "", pins: [] }] : [];
    const extras: BriefExtra[] = imgs.filter(i => i !== first).map(i => ({ fileId: i.file_id, driveId: i.drive_file_id!, previewId: previewIdOf(i), name: i.file_name }));
    return { ...EMPTY_BRIEF, canvases, extras };
  });
  const [headline, setHeadline] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueBy, setDueBy] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [designerEmail, setDesignerEmail] = useState("");
  const [known, setKnown] = useState<{ name: string; email: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Designers we've used before — one tap fills both fields.
  useEffect(() => {
    fetch("/api/studio/work-orders").then(r => r.json()).then(j => {
      const seen = new Map<string, { name: string; email: string }>();
      for (const w of (j.workOrders || []) as any[]) if (w.designer_email && !seen.has(w.designer_email)) seen.set(w.designer_email, { name: w.designer_name || "", email: w.designer_email });
      setKnown(Array.from(seen.values()));
    }).catch(() => {});
  }, []);

  const isCanvas = (driveId: string) => spec.canvases.some(c => c.driveId === driveId);
  const isExtra = (driveId: string) => spec.extras.some(e => e.driveId === driveId);
  function toggleCanvas(im: Img) {
    const id = im.drive_file_id!;
    if (isCanvas(id)) setSpec(s => ({ ...s, canvases: s.canvases.filter(c => c.driveId !== id), extras: [...s.extras, { fileId: im.file_id, driveId: id, previewId: previewIdOf(im), name: im.file_name }] }));
    else setSpec(s => ({ ...s, extras: s.extras.filter(e => e.driveId !== id), canvases: [...s.canvases, { id: newPinId(), fileId: im.file_id, driveId: id, previewId: previewIdOf(im), name: im.file_name, note: "", pins: [] }] }));
  }
  function toggleExtra(im: Img) {
    const id = im.drive_file_id!;
    if (isExtra(id)) setSpec(s => ({ ...s, extras: s.extras.filter(e => e.driveId !== id) }));
    else setSpec(s => ({ ...s, extras: [...s.extras, { fileId: im.file_id, driveId: id, previewId: previewIdOf(im), name: im.file_name }] }));
  }
  async function uploadPinImage(f: File) {
    const up = await uploadToDrive({ blob: f, fileName: f.name, mimeType: f.type || "image/png", itemId: null, clientName: brief?.clients?.name || "Studio", projectTitle: "Studio", itemName: brief?.title || "Design", onProgress: undefined });
    return { driveId: up.fileId as string, name: f.name };
  }
  async function go() {
    setErr("");
    if (!spec.canvases.length && !spec.extras.length) { setErr("Hand over at least one image."); return; }
    const emptyPins = spec.canvases.some(c => c.pins.some(p => !p.text.trim() && !p.driveId));
    if (emptyPins) { setErr("A pin has nothing on it — give it words or an image, or remove it."); return; }
    setBusy(true);
    try {
      const conversation = lines.filter(n => handLines.has(n.id)).map(n => ({ role: n.sender_role === "client" ? "client" : "us", text: n.body.trim(), at: n.created_at }));
      const r = await fetch(`/api/studio/briefs/${brief.id}/work-orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, headline: headline.trim() || null, instructions: instructions.trim() || null, brief: { ...spec, conversation }, dueBy: dueBy || null, designerName: designerName.trim() || null, designerEmail: designerEmail.trim() || null }) }).then(x => x.json());
      if (r.error) { setErr(r.error); return; }
      onCreated({ id: r.workOrder.id, url: r.url, emailSent: !!r.emailSent });
    } finally { setBusy(false); }
  }

  const handing = spec.canvases.length + spec.extras.length;
  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 10px", overflowY: "auto" }}>
      <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 20, width: "100%", maxWidth: 860, color: H.text, fontFamily: H.font, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
          <div>
            <div style={tag(H.faint, 9.5)}>Designer · Room 2</div>
            <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginTop: 2 }}>Hand to a designer</div>
            <div style={{ fontSize: 11.5, color: H.faint, marginTop: 4 }}>{brief?.title || "Design"} · the client&rsquo;s name stays here</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "8px 22px 0" }}>
          <label style={lbl}>What do we need?</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            {WO_TYPES.map(ty => { const on = type === ty.id; return (
              <button key={ty.id} type="button" onClick={() => setType(ty.id)} style={{ textAlign: "left", background: H.surface, border: on ? "1px solid #fff" : `1px solid ${H.line}`, boxShadow: on ? "inset 0 0 0 1px #fff" : "none", borderRadius: 10, padding: "11px 13px", cursor: "pointer", fontFamily: H.font }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", color: H.text }}>{ty.label}</div>
                <div style={{ fontSize: 11, color: H.dim, marginTop: 2 }}>{ty.blurb}</div>
              </button>
            ); })}
          </div>
        </div>

        <div style={{ padding: "16px 22px 0" }}>
          <label style={lbl}>Pin the brief · tap a reference to pin on it</label>
          {imgs.length === 0 ? <div style={{ fontSize: 12.5, color: H.faint }}>No images on this design yet — drop a reference in the thread first.</div> : (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
              {imgs.map(im => { const on = isCanvas(im.drive_file_id!); return (
                <button key={im.id} type="button" onClick={() => toggleCanvas(im)} title={on ? "Pinned canvas — tap to drop it" : "Tap to pin on this"} style={{ position: "relative", flexShrink: 0, width: 64, height: 64, borderRadius: 9, overflow: "hidden", background: "#fff", border: on ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: on ? 1 : 0.55 }}>
                  <img src={thumb(im.drive_file_id!, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  {on && <span style={{ position: "absolute", right: 3, top: 3, background: H.amber, color: H.ink, borderRadius: 999, fontSize: 9, fontWeight: 900, width: 16, height: 16, display: "grid", placeItems: "center" }}>📌</span>}
                </button>
              ); })}
            </div>
          )}
        </div>

        {spec.canvases.map((c, i) => (
          <div key={c.id} style={{ margin: "14px 22px 0", padding: 12, background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={tag(H.amber, 9)}>Canvas {i + 1}</span>
              <span style={{ fontSize: 10.5, color: H.faint }}>{c.pins.length ? `${c.pins.length} pin${c.pins.length === 1 ? "" : "s"}` : "tap the image to drop pins"}</span>
              <button type="button" onClick={() => setSpec(s => ({ ...s, canvases: s.canvases.filter(x => x.id !== c.id), extras: [...s.extras, { fileId: c.fileId, driveId: c.driveId, previewId: c.previewId, name: c.name }] }))} style={{ marginLeft: "auto", background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Not a canvas</button>
            </div>
            <PinBrief canvas={c} imgSrc={(id, size) => thumb(id, size || 900)} onChange={next => setSpec(s => ({ ...s, canvases: s.canvases.map(x => x.id === c.id ? next : x) }))} onUploadImage={uploadPinImage} />
          </div>
        ))}

        <div style={{ padding: "16px 22px 0" }}>
          <label style={lbl}>The one line that rules <span style={{ color: H.faint }}>(optional)</span></label>
          <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="e.g. KEEP EXACT STYLE" style={{ ...inp, fontSize: 15, fontWeight: 800, textTransform: "uppercase" }} />
          <label style={{ ...lbl, marginTop: 12 }}>Notes <span style={{ color: H.faint }}>(optional)</span></label>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} placeholder="Anything the pins don't say — colors, sizing, format, print method…" style={{ ...inp, resize: "vertical" }} />
        </div>

        {lines.length > 0 && (
          <div style={{ padding: "16px 22px 0" }}>
            <label style={lbl}>The conversation · {handLines.size} of {lines.length} lines go with it · names stripped</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {lines.map(n => { const on = handLines.has(n.id); const client = n.sender_role === "client"; const whisper = n.visibility === "internal"; return (
                <button key={n.id} type="button" onClick={() => toggleLine(n.id)} style={{ textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start", background: on ? H.surface : "transparent", border: `1px ${whisper ? "dashed" : "solid"} ${on ? H.line : H.line2}`, borderRadius: 10, padding: "8px 11px", cursor: "pointer", fontFamily: H.font, color: H.text, opacity: on ? 1 : 0.45 }}>
                  <span style={{ ...tag(client ? H.blue : whisper ? H.amber : H.dim, 8.5), flexShrink: 0, width: 46, paddingTop: 2 }}>{client ? "Client" : whisper ? "Internal" : "Us"}</span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap", flex: 1 }}>{n.body}</span>
                  <span style={{ flexShrink: 0, ...tag(on ? H.green : H.faint, 9) }}>{on ? "✓" : "off"}</span>
                </button>
              ); })}
            </div>
          </div>
        )}

        {imgs.some(im => !isCanvas(im.drive_file_id!)) && (
          <div style={{ padding: "16px 22px 0" }}>
            <label style={lbl}>Also hand over · {spec.extras.length} more</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {imgs.filter(im => !isCanvas(im.drive_file_id!)).map(im => { const on = isExtra(im.drive_file_id!); return (
                <button key={im.id} type="button" onClick={() => toggleExtra(im)} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#fff", border: on ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: on ? 1 : 0.35 }}>
                  <img src={thumb(im.drive_file_id!, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  {on && <span style={{ position: "absolute", right: 3, top: 3, background: "#fff", color: H.ink, borderRadius: 999, fontSize: 9, fontWeight: 900, width: 15, height: 15, display: "grid", placeItems: "center" }}>✓</span>}
                </button>
              ); })}
            </div>
            <div style={{ fontSize: 11, color: H.faint, marginTop: 7 }}>The rest of the thread&rsquo;s references + drafts, for context. Tap to exclude any.</div>
          </div>
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
          <span style={{ fontSize: 11, color: H.faint }}>{handing} image{handing === 1 ? "" : "s"} · {spec.canvases.reduce((n, c) => n + c.pins.length, 0)} pins</span>
          <button disabled={busy} onClick={go} style={{ ...primaryBtn, marginLeft: "auto", padding: "13px 24px", opacity: busy ? 0.6 : 1 }}>{busy ? "Sending…" : designerEmail.trim() ? "Send the work order →" : "Create + copy the link →"}</button>
        </div>
      </div>
    </div>
  );
}

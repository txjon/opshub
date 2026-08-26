"use client";
import { useEffect, useRef, useState } from "react";
import { H, ghostBtn, inp, tag } from "@/lib/studio-theme";
import { newPinId, type BriefCanvas, type BriefPin } from "@/lib/design-work-orders";

// THE PINNED BRIEF — one reference image as the canvas, numbered pins on it,
// each pin = a short directive + an optional swap-in image ("replace the
// hammer with THIS"). ONE spec (BriefCanvas), rendered editable (our builder /
// panel) or read-only (the designer's page) by the same component, so what we
// see is exactly what they get. Pin x/y are percentages of the image box.
//
// Edit: tap the image to drop a pin, drag a pin to move it, type in its card,
// "+ image" attaches the swap-in. Read: tap a pin or its card to light both.
type Props = {
  canvas: BriefCanvas;
  imgSrc: (driveId: string, size?: number) => string;   // how THIS viewer reaches an image
  readOnly?: boolean;
  onChange?: (c: BriefCanvas) => void;
  onUploadImage?: (file: File) => Promise<{ driveId: string; name: string }>;
  downloadHref?: string | null;                          // designer side: the original, full-res
  downloadSrc?: (driveId: string) => string;             // designer side: full-res link for a pin's swap-in
  onOpenImage?: (driveId: string, name?: string | null, caption?: string | null) => void;  // read-only tap → lightbox
};
export default function PinBrief({ canvas, imgSrc, readOnly, onChange, onUploadImage, downloadHref, downloadSrc, onOpenImage }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const fileFor = useRef<string | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);
  const pins = canvas.pins || [];
  const set = (pinsNext: BriefPin[]) => onChange?.({ ...canvas, pins: pinsNext });

  const pct = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect(); if (!r) return null;
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };
  function addPin(e: React.MouseEvent) {
    if (readOnly) { onOpenImage?.(canvas.driveId, canvas.name, "The reference"); return; }
    const p = pct(e); if (!p) return;
    const pin: BriefPin = { id: newPinId(), x: +p.x.toFixed(2), y: +p.y.toFixed(2), text: "" };
    set([...pins, pin]); setActive(pin.id);
    setTimeout(() => document.getElementById(`pin-txt-${pin.id}`)?.focus(), 30);
  }
  function onMarkerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation(); setActive(id);
    if (readOnly) { document.getElementById(`pin-card-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    drag.current = { id, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMarkerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = pct(e); if (!p) return;
    drag.current.moved = true;
    set(pins.map(x => x.id === drag.current!.id ? { ...x, x: +p.x.toFixed(2), y: +p.y.toFixed(2) } : x));
  }
  function onMarkerUp() { drag.current = null; }
  async function pickImage(pinId: string, f: File | null) {
    if (!f || !onUploadImage) return;
    setUploadingFor(pinId);
    try { const up = await onUploadImage(f); set(pins.map(x => x.id === pinId ? { ...x, driveId: up.driveId, name: up.name } : x)); }
    catch (e: any) { alert(e?.message || "Couldn't attach that image."); }
    finally { setUploadingFor(null); }
  }
  useEffect(() => { if (active && !pins.some(p => p.id === active)) setActive(null); }, [pins, active]);

  const marker = (p: BriefPin, i: number) => {
    const on = active === p.id;
    return (
      <button key={p.id} type="button" onPointerDown={e => onMarkerDown(e, p.id)} onPointerMove={onMarkerMove} onPointerUp={onMarkerUp} onPointerCancel={onMarkerUp} onClick={e => e.stopPropagation()}
        aria-label={`Pin ${i + 1}`}
        style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-50%)", width: 26, height: 26, borderRadius: 999, background: on ? H.amber : H.ink, color: on ? H.ink : "#fff", border: "2px solid #fff", boxShadow: "0 1px 6px rgba(0,0,0,.45)", fontSize: 12, fontWeight: 900, fontFamily: H.mono, display: "grid", placeItems: "center", cursor: readOnly ? "pointer" : "grab", touchAction: "none", padding: 0, zIndex: on ? 3 : 2 }}>
        {i + 1}
      </button>
    );
  };

  return (
    <div className="pb-wrap" style={{ display: "grid", gap: 12 }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .pb-wrap{grid-template-columns:1fr}
        @media(min-width:760px){.pb-wrap{grid-template-columns:minmax(0,1.35fr) minmax(220px,1fr)}}
      ` }} />
      <div>
        <div ref={boxRef} onClick={addPin} style={{ position: "relative", background: "#fff", borderRadius: 12, overflow: "hidden", cursor: readOnly ? (onOpenImage ? "zoom-in" : "default") : "crosshair", userSelect: "none", lineHeight: 0 }}>
          <img src={imgSrc(canvas.previewId || canvas.driveId, 1200)} alt="" draggable={false} referrerPolicy="no-referrer" style={{ width: "100%", display: "block", pointerEvents: "none" }} />
          {pins.map(marker)}
          {!readOnly && pins.length === 0 && <span style={{ position: "absolute", left: 10, bottom: 10, ...tag("#666", 9), background: "rgba(255,255,255,.92)", borderRadius: 6, padding: "5px 9px" }}>Tap the image to drop a pin</span>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          {canvas.name && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{canvas.name}</span>}
          {downloadHref && <a href={downloadHref} style={{ ...tag(H.green, 9.5), textDecoration: "none", marginLeft: "auto" }}>↓ Download original</a>}
        </div>
        {!readOnly ? (
          <input value={canvas.note || ""} onChange={e => onChange?.({ ...canvas, note: e.target.value })} placeholder="Note on this image (optional) — e.g. keep exact style" style={{ ...inp, marginTop: 8, fontSize: 12.5 }} />
        ) : canvas.note ? (
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.02em", color: H.text }}>{canvas.note}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pins.length === 0 && readOnly && <div style={{ fontSize: 12.5, color: H.faint }}>No pins on this one — see the notes.</div>}
        {pins.map((p, i) => {
          const on = active === p.id;
          return (
            <div key={p.id} id={`pin-card-${p.id}`} onClick={() => setActive(p.id)} style={{ display: "flex", gap: 10, background: H.surface, border: `1px solid ${on ? H.amber : H.line}`, borderRadius: 12, padding: "10px 11px", cursor: "pointer" }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: on ? H.amber : H.ink, color: on ? H.ink : "#fff", border: "2px solid #fff", fontSize: 11, fontWeight: 900, fontFamily: H.mono, display: "grid", placeItems: "center" }}>{i + 1}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                {readOnly ? (
                  <div style={{ fontSize: 14, fontWeight: 700, color: H.text, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{p.text || (p.driveId ? "Use this image here." : "")}</div>
                ) : (
                  <textarea id={`pin-txt-${p.id}`} value={p.text} onChange={e => set(pins.map(x => x.id === p.id ? { ...x, text: e.target.value } : x))} rows={2} placeholder={`What happens here? e.g. "Replace hammer with this pistol"`} style={{ ...inp, fontSize: 13, padding: "7px 9px", resize: "vertical", background: H.ink }} onClick={e => e.stopPropagation()} />
                )}
                {p.driveId && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <a href={readOnly && downloadSrc ? downloadSrc(p.driveId) : undefined} onClick={e => { e.stopPropagation(); if (readOnly && onOpenImage) { e.preventDefault(); onOpenImage(p.driveId!, p.name, `Pin ${i + 1} · use this`); return; } if (!readOnly || !downloadSrc) e.preventDefault(); }} style={{ display: "block", width: 84, height: 84, borderRadius: 8, overflow: "hidden", background: "#fff", flexShrink: 0, cursor: readOnly ? "zoom-in" : "default" }}>
                      <img src={imgSrc(p.driveId, 300)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                    </a>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...tag(H.blue, 9) }}>{readOnly ? "Use this" : "Swap-in image"}</div>
                      {readOnly && downloadSrc && <a href={downloadSrc(p.driveId)} onClick={e => e.stopPropagation()} style={{ ...tag(H.green, 9), textDecoration: "none", display: "inline-block", marginTop: 3 }}>↓ Download</a>}
                      {p.name && <div style={{ fontSize: 10, fontFamily: H.mono, color: H.faint, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>}
                      {!readOnly && <button type="button" onClick={e => { e.stopPropagation(); set(pins.map(x => x.id === p.id ? { ...x, driveId: null, name: null } : x)); }} style={{ background: "none", border: "none", color: H.faint, fontSize: 10.5, cursor: "pointer", fontFamily: H.font, padding: 0, marginTop: 4 }}>remove image</button>}
                    </div>
                  </div>
                )}
                {!readOnly && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    {!p.driveId && onUploadImage && <button type="button" disabled={uploadingFor === p.id} onClick={e => { e.stopPropagation(); fileFor.current = p.id; fileIn.current?.click(); }} style={{ ...ghostBtn, padding: "6px 11px", fontSize: 9.5 }}>{uploadingFor === p.id ? "Attaching…" : "+ image"}</button>}
                    <button type="button" onClick={e => { e.stopPropagation(); set(pins.filter(x => x.id !== p.id)); }} style={{ marginLeft: "auto", background: "none", border: "none", color: H.red, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, padding: "4px 2px" }}>Remove</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!readOnly && <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0] || null; const id = fileFor.current; if (id) pickImage(id, f); if (fileIn.current) fileIn.current.value = ""; }} />}
      </div>
    </div>
  );
}

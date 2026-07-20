"use client";
// Web wrapper around the shared, pure ProofDocBody. Its ONLY job is the
// interactive mockup crop widget (MockupFrame — measured + drag-pan, so it
// needs client hooks). Everything else — the whole proof document layout — is
// ProofDocBody, which also renders the PDF server-side (renderToStaticMarkup →
// Browserless). One source of layout; the PDF can't drift. Signature is
// unchanged so all callers (ArtTab editor/preview, proofs tab, client portal)
// are unaffected.
import React from "react";
import { computeMockupLayout, MOCKUP_FRAME_ASPECT } from "@/lib/mockup-crop";
import ProofDocBody from "@/components/ProofDocBody";

// Mockup in a fixed-aspect frame with a non-destructive crop (zoom + drag-pan in
// edit mode). The crop is CSS-applied here for the web proof + portal; the PDF
// renders the pre-cropped image (baked client-side) as a plain contained image.
function MockupFrame({ url, crop, edit }) {
  const frameRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [dim, setDim] = React.useState(null);
  const [fw, setFw] = React.useState(0);
  React.useEffect(() => {
    if (!url) { setDim(null); return; }
    const im = new Image();
    im.onload = () => setDim({ w: im.naturalWidth, h: im.naturalHeight });
    im.src = url;
  }, [url]);
  React.useEffect(() => {
    const el = frameRef.current; if (!el) return;
    const upd = () => setFw(el.clientWidth);
    upd();
    const RO = typeof ResizeObserver !== "undefined" ? new ResizeObserver(upd) : null;
    if (RO) RO.observe(el);
    return () => { if (RO) RO.disconnect(); };
  }, []);
  const editable = !!(edit && edit.onCrop);
  const A = MOCKUP_FRAME_ASPECT;
  const fh = fw / A;
  const layout = (dim && fw) ? computeMockupLayout(dim.w, dim.h, fw, fh, crop) : null;
  const zoom = Math.max(1, (crop && crop.zoom) || 1);
  const canPan = !!(layout && (layout.overflowX > 0.5 || layout.overflowY > 0.5));

  const onDown = (e) => {
    if (!editable || !canPan) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, ox: (crop && crop.offsetX) || 0, oy: (crop && crop.offsetY) || 0, ovX: layout.overflowX, ovY: layout.overflowY, zoom };
    const move = (ev) => {
      const d = dragRef.current; if (!d) return;
      const nx = d.ovX ? Math.max(-1, Math.min(1, d.ox + (ev.clientX - d.x) / (d.ovX / 2))) : 0;
      const ny = d.ovY ? Math.max(-1, Math.min(1, d.oy + (ev.clientY - d.y) / (d.ovY / 2))) : 0;
      edit.onCrop({ zoom: d.zoom, offsetX: nx, offsetY: ny });
    };
    const up = () => { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

  return (
    <div style={{ padding: "16px 0 12px" }}>
      <div ref={frameRef} onMouseDown={onDown}
        style={{ position: "relative", width: "100%", aspectRatio: `${A}`, overflow: "hidden", borderRadius: 10, background: "#fff", border: editable ? "1px dashed #d4d4da" : "none", cursor: editable && canPan ? "grab" : "default" }}>
        {url && layout ? (
          <img src={url} alt="" draggable={false} style={{ position: "absolute", left: layout.left, top: layout.top, width: layout.dispW, height: layout.dispH, maxWidth: "none", userSelect: "none" }} />
        ) : url ? (
          <img src={url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#c3c3cc", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em" }}>MOCKUP</div>
        )}
        {edit && edit.onReplaceMockup && (
          <label style={{ position: "absolute", top: 8, right: 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#6b6b78", background: "#fff", border: "1px solid #dcdce0", borderRadius: 8, padding: "5px 12px", cursor: edit.mockupReplacing ? "default" : "pointer", opacity: edit.mockupReplacing ? 0.6 : 1, boxShadow: "0 1px 2px rgba(0,0,0,.06)" }}>
            {edit.mockupReplacing ? "Uploading…" : "↻ Replace mockup"}
            <input type="file" accept="image/*" disabled={edit.mockupReplacing} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) edit.onReplaceMockup(f); }} />
          </label>
        )}
      </div>
      {editable && url && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.06em" }}>Zoom</span>
          <input type="range" min={1} max={3} step={0.02} value={zoom}
            onChange={(e) => edit.onCrop({ zoom: Number(e.target.value), offsetX: (crop && crop.offsetX) || 0, offsetY: (crop && crop.offsetY) || 0 })}
            style={{ flex: 1, maxWidth: 240 }} />
          {(zoom > 1.001 || (crop && (crop.offsetX || crop.offsetY))) && <button onClick={() => edit.onCrop({ zoom: 1, offsetX: 0, offsetY: 0 })} style={{ fontSize: 10, fontWeight: 600, color: "#6b6b78", background: "#fff", border: "1px solid #dcdce0", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>Reset</button>}
          <span style={{ fontSize: 10, color: "#a0a0ad" }}>{canPan ? "drag to pan" : ""}</span>
        </div>
      )}
    </div>
  );
}

export default function ProofDocView({
  spec,
  mockupUrl,
  clientName = "",
  itemName = "",
  brandName = "",
  logoSvg = "",
  edit = null,
  font = "Inter, system-ui, sans-serif",
  mono = "ui-monospace, 'SF Mono', Menlo, monospace",
}) {
  const s = spec || {};
  const E = edit || null;
  const mockupSlot = (mockupUrl || E?.onReplaceMockup)
    ? <MockupFrame url={mockupUrl} crop={s.mockupCrop || null}
        edit={E ? { onCrop: E.setMockupCrop, onReplaceMockup: E.onReplaceMockup, mockupReplacing: E.mockupReplacing } : null} />
    : null;
  return (
    <ProofDocBody spec={spec} mockupSlot={mockupSlot} clientName={clientName} itemName={itemName}
      brandName={brandName} logoSvg={logoSvg} edit={edit} font={font} mono={mono} />
  );
}

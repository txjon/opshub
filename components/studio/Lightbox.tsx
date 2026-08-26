"use client";
import { useEffect } from "react";
import { H, primaryBtn, tag } from "@/lib/studio-theme";

// A tap on any image opens it big, with ONE obvious download. Shared by the
// designer's page and our work-order panel.
export type LightboxItem = { src: string; downloadHref?: string | null; name?: string | null; caption?: string | null };
export default function Lightbox({ item, onClose }: { item: LightboxItem | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [item, onClose]);
  if (!item) return null;
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,.94)", display: "flex", flexDirection: "column", fontFamily: H.font, color: H.text }}>
      <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {item.caption && <div style={tag(H.faint, 9)}>{item.caption}</div>}
          {item.name && <div style={{ fontSize: 12, fontFamily: H.mono, color: H.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>}
        </div>
        {item.downloadHref && <a href={item.downloadHref} style={{ ...primaryBtn, background: H.green, color: "#08210a", textDecoration: "none", padding: "11px 18px", flexShrink: 0 }}>↓ Download original</a>}
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 30, cursor: "pointer", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px 16px" }}>
        <img src={item.src} alt="" referrerPolicy="no-referrer" onClick={e => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", background: "#fff", borderRadius: 8 }} />
      </div>
    </div>
  );
}

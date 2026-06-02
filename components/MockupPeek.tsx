"use client";
import { useEffect } from "react";
import { DriveThumb } from "@/components/DriveThumb";
import { T, font } from "@/lib/theme";

// Small click-to-peek mockup modal used by the production + receiving list
// views. Distinct from DriveThumb's full-screen lightbox — this is a compact
// popover so the receiver/producer can glance at the art without leaving the
// list. Click-outside or Esc closes.
export function MockupPeek({
  driveFileId,
  name,
  onClose,
}: {
  driveFileId: string | null;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, width: "min(440px, 100%)", display: "flex", flexDirection: "column", gap: 10, fontFamily: font, color: T.text }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ background: T.surface, borderRadius: 8, minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {driveFileId ? (
            <DriveThumb driveFileId={driveFileId} style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", display: "block" }}
              fallback={<span style={{ fontSize: 12, color: T.faint, padding: 40 }}>No mockup preview</span>} />
          ) : (
            <span style={{ fontSize: 12, color: T.faint, padding: 40 }}>No mockup for this item</span>
          )}
        </div>
      </div>
    </div>
  );
}

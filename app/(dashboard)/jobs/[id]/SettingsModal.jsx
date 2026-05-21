"use client";
import { useEffect } from "react";
import { T, font } from "@/lib/theme";

// Centered modal for in-card editors (Setup Fees, Specialty, Custom
// Costs, Blanks). Replaces inline expansion so the page height stays
// constant when the user dives in to tweak a field. Esc + backdrop
// click dismiss. Used by the costing card surfaces.
export function SettingsModal({ open, onClose, title, summary, children, width = 480 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(10,10,14,0.55)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(12px, 3vw, 24px)", fontFamily: font,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          width: `min(${width}px, 100%)`, maxHeight: "86vh",
          background: T.card, borderRadius: 12,
          border: `1px solid ${T.border}`,
          boxShadow: "0 24px 64px rgba(0,0,0,0.24)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
        <header style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: "-0.01em" }}>{title}</div>
            {summary && <div style={{ fontSize: 11, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</div>}
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: "transparent", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px", minHeight: 32, lineHeight: 1 }}>
            ×
          </button>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

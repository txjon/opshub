"use client";
import { useEffect } from "react";
import { T, font } from "@/lib/theme";

/**
 * Shared PDF preview modal — dark backdrop, centered panel with iframe.
 * ESC / backdrop-click to close. Optional Download button in the header.
 * Matches the lightbox visual language of DriveThumb's image viewer.
 */
export function PdfPreviewModal({
  src,
  title,
  downloadHref,
  onClose,
}: {
  src: string;
  title?: string;
  downloadHref?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handler);
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000, padding: 32, fontFamily: font,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(1000px, 95vw)",
          height: "90vh",
          background: T.card,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{
          padding: "12px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          gap: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "Preview"}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {downloadHref && (
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: `1px solid ${T.border}`,
                  background: "transparent",
                  color: T.muted,
                  fontSize: 11,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >Download</a>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                background: T.accent,
                color: "#fff",
                border: "none",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
              }}
            >Close</button>
          </div>
        </div>
        <div style={{ flex: 1, background: "#fff", overflow: "hidden" }}>
          <iframe src={src} title={title || "Preview"} style={{ width: "100%", height: "100%", border: "none" }} />
        </div>
      </div>
    </div>
  );
}

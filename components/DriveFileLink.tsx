"use client";
import { useState, useEffect, ReactNode } from "react";

type Props = {
  /** Drive file id. When absent the wrapper renders children as-is. */
  driveFileId?: string | null;
  /** Optional display name for the modal header. */
  fileName?: string | null;
  /** Mime type — used only for the "download" vs "preview in iframe" decision.
   *  When absent we always iframe, which handles nearly every Drive file type. */
  mimeType?: string | null;
  /** Click target — whatever needs to become clickable (thumbnail, row, button). */
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Optional title attribute */
  title?: string;
};

/**
 * Wrap any clickable element with this to preview a Drive file in-app.
 * Replaces `<a href={drive_link} target="_blank">` patterns across OpsHub
 * so users / clients / designers never navigate out to drive.google.com.
 *
 * Kept minimal: click → modal with Drive's own /preview iframe. No
 * "Open in Drive" fallback link (per product direction).
 *
 * Excluded surfaces (still use external links directly):
 *   - PO PDF (/api/pdf/po/*)
 *   - Vendor / decorator portal (/portal/vendor/*)
 */
export function DriveFileLink({
  driveFileId, fileName, mimeType, children, className, style, title,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!driveFileId) return <>{children}</>;

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title={title || fileName || "Preview"}
        className={className}
        style={{ cursor: "pointer", display: "inline-block", ...style }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        {children}
      </span>
      {open && (
        <DriveFileModal
          driveFileId={driveFileId}
          fileName={fileName}
          mimeType={mimeType}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DriveFileModal({
  driveFileId, fileName, mimeType, onClose,
}: {
  driveFileId: string;
  fileName?: string | null;
  mimeType?: string | null;
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

  // For images, use the thumbnail proxy (crisp, fast, no Drive chrome).
  // For everything else, embed Drive's own preview iframe — handles PDFs,
  // PSDs, docs, sheets, videos, etc.
  const isImage = !!mimeType && mimeType.startsWith("image/");
  const thumbSrc = `/api/files/thumbnail?id=${driveFileId}`;
  const iframeSrc = `https://drive.google.com/file/d/${driveFileId}/preview`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
        zIndex: 10000, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      {/* Header bar — filename + close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1200px, 96vw)", color: "#fff", fontSize: 13,
          display: "flex", alignItems: "center", gap: 12, marginBottom: 10,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <div style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fileName || "Preview"}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "#fff", color: "#000", border: "none",
            fontSize: 20, fontWeight: 700, lineHeight: 1,
            cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
          }}
        >×</button>
      </div>

      {/* Viewer */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1200px, 96vw)", height: "min(78vh, 900px)",
          background: "#0a0a0a", borderRadius: 10, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {isImage ? (
          <img
            src={thumbSrc}
            alt={fileName || ""}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <iframe
            src={iframeSrc}
            title={fileName || "Drive preview"}
            style={{ width: "100%", height: "100%", border: "none", background: "#000" }}
            allow="autoplay"
          />
        )}
      </div>
    </div>
  );
}

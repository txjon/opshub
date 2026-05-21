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

  // Single toolbar style shared by Download + Close so they read as
  // a paired set instead of a button next to a floating circled ×.
  const headerBtn: React.CSSProperties = {
    height: 32, padding: "0 14px", borderRadius: 8,
    background: "rgba(255,255,255,0.10)", color: "#fff",
    fontSize: 12, fontWeight: 600, textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.18)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    transition: "background 0.15s",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,10,14,0.86)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        zIndex: 10000, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      {/* Header bar — filename + Download + Close. All same height, all
          part of a quiet toolbar so nothing floats over the image. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1200px, 96vw)", color: "#fff", fontSize: 13,
          display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <div style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fileName || "Preview"}
        </div>
        {/* Download — hits the thumbnail endpoint with dl=1 so the
            response comes back as Content-Disposition: attachment with
            the original filename and bytes (not the preview PNG). Works
            for any file type including PSD/AI/EPS. */}
        <a
          href={`/api/files/thumbnail?id=${driveFileId}&dl=1`}
          download
          onClick={(e) => e.stopPropagation()}
          style={headerBtn}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.18)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.10)"; }}
        >Download</a>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ ...headerBtn, width: 32, padding: 0, fontSize: 18, fontWeight: 400, lineHeight: 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
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

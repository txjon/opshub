"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { T, font } from "@/lib/theme";

type Props = {
  driveFileId: string | null | undefined;
  alt?: string;
  style?: React.CSSProperties;
  className?: string;
  /** Fallback rendered when the image can't load after all retries. null = render nothing. */
  fallback?: React.ReactNode;
  /** When true, click opens a full-size lightbox modal. */
  enlargeable?: boolean;
  /** Optional Drive link shown as a button in the lightbox. */
  driveLink?: string | null;
  /** Optional title shown in the lightbox header. */
  title?: string;
  maxRetries?: number;
  retryDelayMs?: number;
};

/**
 * Renders a Google Drive thumbnail via /api/files/thumbnail.
 * Retries transient load failures with a short delay instead of
 * permanently hiding the element on the first error.
 *
 * Pass `enlargeable` to make the thumbnail open a full-size lightbox
 * modal on click (unified viewing behavior across Product Builder,
 * Costing, Art, and Processing tabs).
 */
export function DriveThumb({
  driveFileId,
  alt = "",
  style,
  className,
  fallback,
  enlargeable,
  driveLink,
  title,
  maxRetries = 2,
  retryDelayMs = 1500,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [driveFileId]);

  if (!driveFileId) {
    return fallback !== undefined ? <>{fallback}</> : null;
  }

  if (failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", background: T.surface, color: T.faint, fontSize: 10 }}>
        No preview
      </div>
    );
  }

  const src = `/api/files/thumbnail?id=${driveFileId}${attempt > 0 ? `&r=${attempt}` : ""}`;

  const img = (
    <img
      key={attempt}
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => {
        if (attempt < maxRetries) {
          timer.current = setTimeout(() => setAttempt(a => a + 1), retryDelayMs);
        } else {
          setFailed(true);
        }
      }}
    />
  );

  if (!enlargeable) return img;

  return (
    <>
      <span
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        style={{ cursor: "zoom-in", display: "inline-block", lineHeight: 0 }}
      >
        {img}
      </span>
      {open && (
        <ImageLightbox
          driveFileId={driveFileId}
          title={title}
          driveLink={driveLink}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Full-screen image viewer — dark glass backdrop, title + Download +
 * Close header. Exported for surfaces that render their own <img> but
 * want the same click-to-enlarge chrome (e.g. the client portal item
 * modal). Rendered via portal to document.body so it escapes any
 * transformed/overflow-clipped ancestor (vaul's bottom sheet animates
 * Drawer.Content with translate3d, which would otherwise become the
 * containing block for this fixed overlay and trap it inside the
 * sheet). Pointer events stop at the root so an enclosing drawer's
 * drag-to-dismiss never sees them.
 */
export function ImageLightbox({
  driveFileId,
  title,
  driveLink,
  onClose,
}: {
  driveFileId: string;
  title?: string;
  driveLink?: string | null;
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

  // driveLink prop retained on the signature for backwards compatibility,
  // but we no longer render an external link out — all Drive viewing stays
  // in-app per product direction. DriveFileLink is the more general wrapper.
  const hasHeader = !!title;

  // Single header row at the top of the modal: title on the left,
  // Download + Close on the right. Both buttons share the same height
  // + radius so they read as a coherent action group instead of the
  // old "floating circled ×" that sat outside the image.
  const headerBtn: React.CSSProperties = {
    height: 32, padding: "0 14px", borderRadius: 8,
    background: "rgba(255,255,255,0.10)", color: "#fff",
    fontSize: 12, fontWeight: 600, textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.18)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", fontFamily: font,
    transition: "background 0.15s",
  };

  return createPortal(
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      // Stop pointer/touch events at the root so React-tree ancestors
      // (clickable rows, vaul drag handlers) never receive them.
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,10,14,0.86)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        zIndex: 10000, padding: "24px 16px", fontFamily: font,
        // Radix/vaul modals set pointer-events:none on <body> while
        // open — re-enable for this body-level portal explicitly.
        pointerEvents: "auto",
      }}
    >
      {/* Header bar — same width as the image area below so the row
          reads like a proper toolbar, not floating chrome. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          display: "flex", alignItems: "center", gap: 12,
          color: "#fff", marginBottom: 12,
        }}
      >
        {hasHeader && (
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
        )}
        {/* Download — hits the thumbnail endpoint with dl=1 so it
            returns the original file (Content-Disposition: attachment),
            not the preview PNG. Works for any file type: PSD/AI/EPS
            download their native bytes, images as the original raster. */}
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

      {/* Image */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flex: "0 1 auto",
        }}
      >
        <img
          src={`/api/files/thumbnail?id=${driveFileId}&size=1600`}
          alt={title || ""}
          style={{ maxWidth: "100%", maxHeight: "calc(92vh - 60px)", objectFit: "contain", borderRadius: 10, display: "block" }}
        />
      </div>
    </div>,
    document.body
  );
}

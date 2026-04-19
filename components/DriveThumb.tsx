"use client";
import { useState, useEffect, useRef } from "react";
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
        <Lightbox
          driveFileId={driveFileId}
          title={title}
          driveLink={driveLink}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Lightbox({
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

  const hasHeader = !!(title || driveLink);

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
        style={{ position: "relative", maxWidth: "92vw", maxHeight: "92vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
      >
        {hasHeader && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#fff", fontSize: 12 }}>
            {title && <span style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</span>}
            {driveLink && (
              <a
                href={driveLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: "#7fc7ff", textDecoration: "underline", fontSize: 11 }}
              >Open in Drive ↗</a>
            )}
          </div>
        )}
        <img
          src={`/api/files/thumbnail?id=${driveFileId}`}
          alt={title || ""}
          style={{ maxWidth: "100%", maxHeight: hasHeader ? "calc(92vh - 40px)" : "92vh", objectFit: "contain", borderRadius: 8, display: "block" }}
        />
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: -14, right: -14, width: 36, height: 36, borderRadius: "50%",
            background: "#fff", color: "#000", border: "none", fontSize: 20, cursor: "pointer",
            fontWeight: 700, lineHeight: 1, boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
          }}
        >×</button>
      </div>
    </div>
  );
}

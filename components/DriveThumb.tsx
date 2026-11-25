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
  /** Portal link token (client hub / vendor / designer). Staff surfaces omit it. */
  token?: string | null;
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
  token,
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

  // token: portal surfaces pass their link token so the file routes can tell
  // who is asking (lib/file-access); staff surfaces rely on the session.
  const src = `/api/files/thumbnail?id=${driveFileId}${attempt > 0 ? `&r=${attempt}` : ""}${token ? `&t=${encodeURIComponent(token)}` : ""}`;

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
          token={token}
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
  token,
  more,
  preview,
}: {
  driveFileId: string;
  title?: string;
  driveLink?: string | null;
  onClose: () => void;
  /** Portal link token (client hub / vendor / designer). */
  token?: string | null;
  /** Further views of the same piece (front/back), paged with arrows/dots. */
  more?: string[];
  /** Show a 1600px white-backed preview, no Download (line sheet proposals:
   *  the client sees the mockup, it doesn't take the original file). */
  preview?: boolean;
}) {
  const t = token ? `&t=${encodeURIComponent(token)}` : "";
  const ids = [driveFileId, ...(more || [])];
  const [at, setAt] = useState(0);
  const fileId = ids[Math.min(at, ids.length - 1)];
  const step = (d: number) => setAt(i => (i + d + ids.length) % ids.length);

  // Pinch / double-tap / drag to look closer, on the image alone (pages that
  // lock page zoom, useNoPageZoom, still get a close look here). Transform is
  // written straight to the element: no re-render per touchmove. Touches are
  // read on the whole overlay, so a pinch with a finger off the image works.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const z = useRef({ s: 1, x: 0, y: 0, d0: 0, s0: 1, mx: 0, my: 0, x0: 0, y0: 0, cx: 0, cy: 0, lastTap: 0, moved: false });
  const paint = () => {
    const el = imgRef.current; if (!el) return;
    el.style.transform = `translate(${z.current.x}px, ${z.current.y}px) scale(${z.current.s})`;
  };
  const resetZoom = () => { Object.assign(z.current, { s: 1, x: 0, y: 0 }); paint(); };
  useEffect(() => { resetZoom(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fileId]);
  useEffect(() => {
    const el = imgRef.current, root = rootRef.current; if (!el || !root) return;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    // the image's untransformed centre: zoom keeps the point under the fingers fixed
    const centre = () => { const r = el.getBoundingClientRect(); z.current.cx = r.left + r.width / 2 - z.current.x; z.current.cy = r.top + r.height / 2 - z.current.y; };
    const start = (e: TouchEvent) => {
      const c = z.current; c.moved = false;
      if (e.touches.length === 2) {
        centre();
        c.d0 = dist(e.touches); c.s0 = c.s;
        c.mx = (e.touches[0].clientX + e.touches[1].clientX) / 2; c.my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        c.x0 = c.x; c.y0 = c.y;
      } else if (e.touches.length === 1) {
        c.mx = e.touches[0].clientX; c.my = e.touches[0].clientY; c.x0 = c.x; c.y0 = c.y;
      }
    };
    const move = (e: TouchEvent) => {
      const c = z.current;
      if (e.touches.length === 2 && c.d0) {
        e.preventDefault(); c.moved = true;
        c.s = Math.min(5, Math.max(1, c.s0 * dist(e.touches) / c.d0));
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const k = c.s / c.s0;   // image point under the start midpoint stays under the current one
        c.x = mx - c.cx - k * (c.mx - c.cx - c.x0); c.y = my - c.cy - k * (c.my - c.cy - c.y0);
        paint();
      } else if (e.touches.length === 1 && c.s > 1) {
        e.preventDefault(); c.moved = true;
        c.x = c.x0 + (e.touches[0].clientX - c.mx); c.y = c.y0 + (e.touches[0].clientY - c.my);
        paint();
      }
    };
    const end = (e: TouchEvent) => {
      const c = z.current;
      // one finger lifted mid-pinch: carry on as a pan. Still a gesture, never a tap.
      if (e.touches.length) { start(e); c.moved = true; return; }
      c.d0 = 0;
      if (c.s < 1.05) resetZoom();
      // only a tap on the image's frame counts toward a double-tap (a backdrop tap closes)
      if (!c.moved && frameRef.current?.contains(e.target as Node)) {
        const now = Date.now();
        if (now - c.lastTap < 300) {               // double-tap: 2.5x, or back out
          if (c.s > 1) resetZoom();
          else { const t = e.changedTouches[0]; centre(); c.s = 2.5; c.x = -1.5 * (t.clientX - c.cx); c.y = -1.5 * (t.clientY - c.cy); paint(); }
          c.lastTap = 0; c.moved = true;
          e.preventDefault();
        } else c.lastTap = now;
      }
    };
    const cancel = () => { z.current.d0 = 0; z.current.moved = true; if (z.current.s < 1.05) resetZoom(); };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", end, { passive: false });
    root.addEventListener("touchcancel", cancel);
    return () => {
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (ids.length > 1 && e.key === "ArrowRight") step(1);
      if (ids.length > 1 && e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, ids.length]);

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
      ref={rootRef}
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
        touchAction: "none",   // pinches here zoom the image (handlers above), never the page
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
        {!preview && <a
          href={`/api/files/thumbnail?id=${fileId}&dl=1${t}`}
          download
          onClick={(e) => e.stopPropagation()}
          style={headerBtn}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.18)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.10)"; }}
        >Download</a>}
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
        ref={frameRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flex: "0 1 auto",
          overflow: "hidden", borderRadius: 10,   // a zoomed image stays inside its frame, off the header
        }}
      >
        <img
          key={fileId}
          src={`/api/files/thumbnail?id=${fileId}&size=1600${preview ? "&thumb=1" : ""}${t}`}
          alt={title || ""}
          ref={imgRef}
          style={{ touchAction: "none", maxWidth: "100%", maxHeight: `calc(92vh - ${ids.length > 1 ? 96 : 60}px)`, objectFit: "contain", borderRadius: 10, display: "block", background: preview ? "#fff" : undefined }}
        />
      </div>
      {ids.length > 1 && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
          <button onClick={() => step(-1)} aria-label="Previous view" style={{ ...headerBtn, width: 36, padding: 0, fontSize: 16 }}>‹</button>
          {ids.map((id, i) => (
            <button key={id + i} onClick={() => setAt(i)} aria-label={`View ${i + 1}`}
              style={{ width: 8, height: 8, borderRadius: 4, padding: 0, border: "none", cursor: "pointer", background: i === at ? "#fff" : "rgba(255,255,255,0.3)" }} />
          ))}
          <button onClick={() => step(1)} aria-label="Next view" style={{ ...headerBtn, width: 36, padding: 0, fontSize: 16 }}>›</button>
        </div>
      )}
    </div>,
    document.body
  );
}

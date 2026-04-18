"use client";
import { useState, useEffect, useRef } from "react";
import { T } from "@/lib/theme";

type Props = {
  driveFileId: string | null | undefined;
  alt?: string;
  style?: React.CSSProperties;
  className?: string;
  /** Fallback rendered when the image can't load after all retries. null = render nothing. */
  fallback?: React.ReactNode;
  maxRetries?: number;
  retryDelayMs?: number;
};

/**
 * Renders a Google Drive thumbnail via /api/files/thumbnail.
 * Retries transient load failures with a short delay instead of
 * permanently hiding the element on the first error (the old
 * onError={display:"none"} pattern made thumbnails vanish).
 */
export function DriveThumb({
  driveFileId,
  alt = "",
  style,
  className,
  fallback,
  maxRetries = 2,
  retryDelayMs = 1500,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
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

  // Append cache-busting param on retry so the browser actually refetches.
  const src = `/api/files/thumbnail?id=${driveFileId}${attempt > 0 ? `&r=${attempt}` : ""}`;

  return (
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
}

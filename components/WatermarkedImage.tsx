"use client";
import { CSSProperties, useId } from "react";

// Client-side proof watermark — the casual "screenshot and post on
// Instagram" path is broken because the overlay sits in the same
// pixel space as the image. DevTools can strip it; that's beyond
// scope (would need a server-burned watermark — Phase 3 of the proof
// plan, not yet built).
//
// Pairs with anti-save handlers (no right-click, no drag, no select)
// so the obvious "save image as" / drag-to-desktop paths are gone too.
// Doesn't attempt to block screenshots — accepted per spec.

export type WatermarkedImageProps = {
  src: string;
  alt?: string;
  style?: CSSProperties;
  imgStyle?: CSSProperties;
  /** When true, overlay the proof watermark + block right-click/drag.
   *  Caller decides which images deserve protection. */
  watermark?: boolean;
  /** Override the watermark text (default: "HOUSE PARTY PROOF · NOT FOR USE"). */
  watermarkText?: string;
  onClick?: () => void;
  onError?: (e: any) => void;
};

const DEFAULT_TEXT = "HOUSE PARTY PROOF · NOT FOR USE";

export function WatermarkedImage({
  src,
  alt = "",
  style,
  imgStyle,
  watermark = false,
  watermarkText = DEFAULT_TEXT,
  onClick,
  onError,
}: WatermarkedImageProps) {
  // Stable per-instance pattern id so multiple WatermarkedImage components
  // on a page each render their own SVG pattern.
  const patternId = `wm-${useId().replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", ...style }}
      onClick={onClick}
      onContextMenu={watermark ? (e) => e.preventDefault() : undefined}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={watermark ? false : undefined}
        onDragStart={watermark ? (e) => e.preventDefault() : undefined}
        onError={onError}
        style={{
          maxWidth: "100%", maxHeight: "100%",
          objectFit: "contain",
          display: "block",
          ...(watermark ? { userSelect: "none", WebkitUserSelect: "none" as any } : {}),
          ...imgStyle,
        }}
      />
      {watermark && (
        <svg
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="360" height="130" patternTransform="rotate(-25)">
              <text
                x="0"
                y="80"
                fontFamily="Arial, sans-serif"
                fontSize="18"
                fontWeight="800"
                fill="rgba(255,255,255,0.55)"
                stroke="rgba(0,0,0,0.25)"
                strokeWidth="0.4"
              >
                {watermarkText}
              </text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
      )}
    </div>
  );
}

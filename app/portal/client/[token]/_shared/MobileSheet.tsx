"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import { C } from "./theme";

// Mobile-first modal that slides up from the bottom on phone-sized
// screens and presents as a centered modal on desktop. Apple-style:
// drag handle at the top, swipe-down to dismiss on mobile, click
// backdrop or × to dismiss anywhere.
//
// Mobile vs desktop is media-query gated via inline <style> rather
// than viewport JS so SSR + first paint match what the client sees.
// The body element gets `data-portal-sheet-open` for the duration so
// background scroll can be locked without jumping to top.
//
// Used for the Item detail surface; can wrap any other detail panel
// later (Order detail, Design preview) for a consistent feel.

export function MobileSheet({
  open,
  onClose,
  title,
  subtitle,
  rightAccessory,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  rightAccessory?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // Touch-drag dismiss state. Tracks vertical movement of the sheet
  // so the user can flick it down to close on iOS-style.
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const onTouchStart = (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragY > 100) onClose();
    setDragY(0);
    startY.current = null;
  };

  return (
    <div onClick={onClose}
      className="portal-mobile-sheet-root"
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.45)",
        display: "flex", justifyContent: "center",
        fontFamily: C.font,
      }}>
      <style>{`
        .portal-mobile-sheet-root { align-items: center; padding: clamp(12px, 3vw, 32px); }
        .portal-mobile-sheet-card {
          background: ${C.card}; border-radius: 14px;
          width: min(720px, 100%); max-height: 94vh;
          display: flex; flex-direction: column; overflow: hidden;
          transform: translateY(0);
          transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .portal-mobile-sheet-handle { display: none; }
        @media (max-width: 640px) {
          .portal-mobile-sheet-root { align-items: flex-end; padding: 0; }
          .portal-mobile-sheet-card {
            border-radius: 18px 18px 0 0;
            width: 100%; max-height: 92vh;
            padding-bottom: env(safe-area-inset-bottom);
            animation: portal-sheet-up 0.28s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .portal-mobile-sheet-handle {
            display: flex; justify-content: center; padding: 8px 0 4px;
            background: ${C.card};
          }
          .portal-mobile-sheet-handle::before {
            content: ""; display: block; width: 38px; height: 4px;
            background: ${C.border}; border-radius: 2px;
          }
        }
        @keyframes portal-sheet-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
      <div className="portal-mobile-sheet-card"
        onClick={e => e.stopPropagation()}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? "none" : undefined }}>
        {/* Drag handle (mobile only via CSS). Swipe-down dismiss. */}
        <div className="portal-mobile-sheet-handle"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />

        {(title || subtitle || rightAccessory) && (
          <div style={{
            padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div style={{
                  fontSize: 16, fontWeight: 700, color: C.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{title}</div>
              )}
              {subtitle && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
            {rightAccessory}
            <button onClick={onClose}
              aria-label="Close"
              style={{
                background: "none", border: "none", color: C.muted,
                fontSize: 22, cursor: "pointer", padding: "4px 8px",
                lineHeight: 1, minWidth: 44, minHeight: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>×</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {children}
        </div>

        {footer && (
          <div style={{
            padding: "12px 20px",
            borderTop: `1px solid ${C.border}`,
            display: "flex", gap: 10, justifyContent: "flex-end",
            flexWrap: "wrap",
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

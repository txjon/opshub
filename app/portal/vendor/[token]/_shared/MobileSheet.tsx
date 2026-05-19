"use client";
import { ReactNode, useEffect, useState } from "react";
import { Drawer } from "vaul";
import { C } from "./theme";

// Detail surface — independent copy of the client portal's MobileSheet
// so the vendor and client portals can evolve without entangling.
//
// Mobile uses vaul's Drawer (iOS-grade bottom sheet: drag-from-anywhere,
// overscroll-to-dismiss, momentum, focus trap, safe-area aware).
// Desktop falls back to a centered card modal — bottom-sheet on a wide
// screen feels off when the user expects a dialog. Both share the same
// content layout + slot props so callers don't need to know which
// variant rendered.

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
  // Same media-query swap the client portal uses. SSR-safe: starts at
  // desktop, flips on mount once we can read innerWidth.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Esc closes on every viewport (desktop fallback also wires it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const buildBody = (useDrawerTitle: boolean) => {
    const titleNode = title && (
      <div style={{
        fontSize: 16, fontWeight: 700, color: C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{title}</div>
    );
    return (
      <>
        {(title || subtitle || rightAccessory) && (
          <div style={{
            padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (useDrawerTitle
                ? <Drawer.Title asChild>{titleNode}</Drawer.Title>
                : titleNode
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
      </>
    );
  };

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <Drawer.Portal>
          <Drawer.Overlay style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1099,
          }} />
          <Drawer.Content
            aria-describedby={undefined}
            style={{
              position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1100,
              background: C.card,
              borderRadius: "18px 18px 0 0",
              maxHeight: "92vh",
              display: "flex", flexDirection: "column",
              outline: "none",
              fontFamily: C.font,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}>
            <div style={{
              display: "flex", justifyContent: "center", padding: "10px 0 6px",
              flexShrink: 0,
            }}>
              <div style={{
                width: 38, height: 4, borderRadius: 2, background: C.border,
              }} />
            </div>
            {buildBody(true)}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.45)",
        display: "flex", justifyContent: "center", alignItems: "center",
        padding: "clamp(12px, 3vw, 32px)",
        fontFamily: C.font,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 14,
          width: "min(820px, 100%)", maxHeight: "94vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
        {buildBody(false)}
      </div>
    </div>
  );
}

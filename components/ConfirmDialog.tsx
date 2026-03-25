"use client";
import { useEffect, useRef } from "react";
import { T, font } from "@/lib/theme";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  confirmColor = T.red,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          padding: "24px", width: 380, maxWidth: "90vw",
          fontFamily: font, color: T.text,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5, marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              background: "transparent", border: `1px solid ${T.border}`, borderRadius: 7,
              color: T.muted, fontSize: 12, fontFamily: font, fontWeight: 600,
              padding: "7px 16px", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: confirmColor, border: "none", borderRadius: 7,
              color: "#fff", fontSize: 12, fontFamily: font, fontWeight: 600,
              padding: "7px 16px", cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

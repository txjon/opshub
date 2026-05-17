"use client";
import { C } from "./theme";
import { STATE_LABELS, type ItemState } from "@/lib/item-status";

// Soft-tinted status pill — Apple-style. Rounded background in the
// state's color family at ~15% opacity, label in the saturated color.
// Replaces the uppercase mono text status that read like a CLI flag
// rather than a glanceable badge.
//
// Used everywhere a per-item status surfaces on the client portal —
// item cards, order row hover-expand, item detail sheet. Internal
// surfaces (worksheet, /production) keep the OpsHub T palette and have
// their own equivalents.

const META: Record<ItemState, { color: string; bg: string }> = {
  setup:         { color: C.muted,   bg: C.surface },
  in_production: { color: C.blue,    bg: C.blueBg },
  shipped:       { color: C.purple,  bg: C.purpleBg },
  in_stock:      { color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  complete:      { color: C.green,   bg: C.greenBg },
  archived:      { color: C.faint,   bg: C.surface },
  on_hold:       { color: C.amber,   bg: C.amberBg },
  cancelled:     { color: C.red,     bg: C.redBg },
};

export function StatusPill({ status, size = "md" }: { status: ItemState; size?: "sm" | "md" }) {
  const m = META[status];
  const pad = size === "sm" ? "2px 8px" : "4px 10px";
  const fs = size === "sm" ? 10 : 11;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: pad, borderRadius: 999,
      background: m.bg, color: m.color,
      fontSize: fs, fontWeight: 700, lineHeight: 1.2,
      letterSpacing: "0.01em", whiteSpace: "nowrap",
      fontFamily: C.font,
    }}>
      {STATE_LABELS[status]}
    </span>
  );
}

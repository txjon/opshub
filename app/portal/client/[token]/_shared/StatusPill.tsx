"use client";
import { C } from "./theme";
import { STATE_LABELS, type ItemState } from "@/lib/item-status";

// Uppercase color-text status label. NOT a pill — Jon's standing rule
// across OpsHub is no pill-style chips anywhere. Same vocabulary
// (lib/item-status STATE_LABELS) the worksheet and items tab use.
// Component name kept as `StatusPill` so existing imports still work,
// but the visual is a flat uppercase label with the state's color.
//
// Used wherever a per-item status surfaces on the client portal —
// item rows, order detail, items list, hover summaries. Internal
// surfaces (worksheet, /production) use the same pattern with the
// OpsHub T palette.

const COLORS: Record<ItemState, string> = {
  setup:         C.muted,
  in_production: C.blue,
  shipped:       C.purple,
  in_stock:      "#14b8a6",
  complete:      C.green,
  archived:      C.faint,
  on_hold:       C.amber,
  cancelled:     C.red,
};

export function StatusPill({ status, size = "md" }: { status: ItemState; size?: "sm" | "md" }) {
  const color = COLORS[status];
  const fs = size === "sm" ? 9 : 10;
  return (
    <span style={{
      color,
      fontSize: fs, fontWeight: 700, lineHeight: 1.2,
      letterSpacing: "0.06em", textTransform: "uppercase",
      whiteSpace: "nowrap", fontFamily: C.font,
    }}>
      {STATE_LABELS[status]}
    </span>
  );
}

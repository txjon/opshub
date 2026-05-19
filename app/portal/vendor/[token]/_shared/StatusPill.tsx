"use client";
import { C } from "./theme";

// Vendor-side status vocabulary. Not pulled from lib/item-status
// because the vendor cares about a tighter subset of states
// (PO Received → In Production → Shipped → Complete) and "received at
// HPD" or "in stock" are HPD-internal — the vendor's involvement ends
// when they hand the package to the carrier.
//
// Visual treatment: uppercase color-text label (no pill). Same rule
// the client portal follows, kept consistent here so the two portals
// feel like the same product.

export type VendorState = "pending" | "in_production" | "shipped" | "complete";

export const VENDOR_STATE_LABELS: Record<VendorState, string> = {
  pending: "PO Received",
  in_production: "In Production",
  shipped: "Shipped",
  complete: "Complete",
};

const COLORS: Record<VendorState, string> = {
  pending: C.muted,
  in_production: C.blue,
  shipped: C.purple,
  complete: C.green,
};

// Maps the raw items.pipeline_stage (which can be null pre-PO,
// "in_production", "shipped", "complete", "strike_off", etc.) into
// the four-state vendor vocabulary. Anything we don't recognize
// falls back to pending — the vendor sees the PO as theirs to act on.
export function vendorStageFor(rawStage: string | null | undefined): VendorState {
  if (rawStage === "shipped") return "shipped";
  if (rawStage === "complete") return "complete";
  if (rawStage === "in_production" || rawStage === "strike_off") return "in_production";
  return "pending";
}

// Roll up the per-item states into a single "where is the order
// overall" label. Used on order rows so the vendor can scan their
// list and see which orders need work without expanding each one.
export function rollupOrderStatus(stages: VendorState[]): VendorState {
  if (stages.length === 0) return "pending";
  if (stages.every(s => s === "complete")) return "complete";
  if (stages.every(s => s === "shipped" || s === "complete")) return "shipped";
  if (stages.some(s => s === "in_production")) return "in_production";
  return "pending";
}

export function StatusPill({ status, size = "md" }: { status: VendorState; size?: "sm" | "md" }) {
  const color = COLORS[status];
  const fs = size === "sm" ? 9 : 10;
  return (
    <span style={{
      color,
      fontSize: fs, fontWeight: 700, lineHeight: 1.2,
      letterSpacing: "0.06em", textTransform: "uppercase",
      whiteSpace: "nowrap", fontFamily: C.font,
    }}>
      {VENDOR_STATE_LABELS[status]}
    </span>
  );
}

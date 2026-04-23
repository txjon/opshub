import { C } from "./theme";
import type { Brief, ClientStateMeta } from "./types";

// Collapses internal brief states into client-facing buckets.
// See also: app/(dashboard)/art-studio for HPD's fuller state vocabulary.
export function clientStateFor(b: Brief): ClientStateMeta {
  if (b.intake_requested) {
    return { label: "Needs your input", bucket: "action", color: C.amber, bg: C.amberBg, border: C.amberBorder };
  }
  const s = b.state;
  if (s === "draft") {
    return { label: "Planning", bucket: "progress", color: C.muted, bg: C.surface, border: C.border };
  }
  if (s === "sent" || s === "in_progress" || s === "wip_review") {
    return { label: "In design", bucket: "progress", color: C.blue, bg: C.blueBg, border: C.blueBorder };
  }
  if (s === "client_review") {
    return { label: "Needs your review", bucket: "action", color: C.purple, bg: C.purpleBg, border: C.purpleBorder };
  }
  if (s === "revisions") {
    return { label: "In revision", bucket: "progress", color: C.blue, bg: C.blueBg, border: C.blueBorder };
  }
  if (s === "final_approved" || s === "pending_prep" || s === "production_ready") {
    return { label: "Approved", bucket: "done", color: C.green, bg: C.greenBg, border: C.greenBorder };
  }
  if (s === "delivered") {
    return { label: "Delivered", bucket: "done", color: C.green, bg: C.greenBg, border: C.greenBorder };
  }
  return { label: s, bucket: "progress", color: C.muted, bg: C.surface, border: C.border };
}

// "Done from client's POV" = they've already approved the design, no unread
// external activity. Auto-hides from the active feed; re-surfaces if HPD or
// designer acts after.
const DONE_STATES = ["final_approved", "pending_prep", "production_ready", "delivered"];
export const isDoneForClient = (b: Brief) =>
  DONE_STATES.includes(b.state) && !b.has_unread_external;

// Client-facing job phase → label mapping (confirmed with Jon Apr 22).
export function clientPhaseFor(phase: string): { label: string; color: string; bg: string } {
  // intake, pending, ready, production → In Production
  // receiving, fulfillment → Shipping
  // complete → Delivered
  // on_hold → Paused (visible, not hidden)
  // cancelled → hidden (caller filters out)
  if (phase === "complete") return { label: "Delivered", color: C.green, bg: C.greenBg };
  if (phase === "receiving" || phase === "fulfillment") return { label: "Shipping", color: C.amber, bg: C.amberBg };
  if (phase === "on_hold") return { label: "Paused", color: C.muted, bg: C.surface };
  return { label: "In Production", color: C.blue, bg: C.blueBg };
}

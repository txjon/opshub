import { C } from "./theme";
import type { Brief, ClientStateMeta } from "./types";

// Collapses brief states into client-facing buckets. FIVE-STATE model
// (mig 159): whose court is it, not which step.
export function clientStateFor(b: Brief): ClientStateMeta {
  const s = b.state;
  if (s === "with_client") {
    return { label: "Needs your review", bucket: "action", color: C.purple, bg: C.purpleBg, border: C.purpleBorder };
  }
  if (s === "approved") {
    return { label: "Approved", bucket: "done", color: C.green, bg: C.greenBg, border: C.greenBorder };
  }
  if (s === "shelved") {
    return { label: "On hold", bucket: "progress", color: C.muted, bg: C.surface, border: C.border };
  }
  if (s === "killed") {
    return { label: "Closed", bucket: "done", color: C.muted, bg: C.surface, border: C.border };
  }
  // working (and anything unknown): the default hum.
  return { label: "In design", bucket: "progress", color: C.blue, bg: C.blueBg, border: C.blueBorder };
}

// "Done from client's POV" = they've already approved the design, no unread
// external activity. Auto-hides from the active feed; re-surfaces if HPD or
// designer acts after.
const DONE_STATES = ["approved"];
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
  // Synthetic phase used by ShipStation sales reports surfaced as invoices.
  if (phase === "fulfillment_invoice") return { label: "Fulfillment", color: C.purple, bg: C.purpleBg };
  return { label: "In Production", color: C.blue, bg: C.blueBg };
}

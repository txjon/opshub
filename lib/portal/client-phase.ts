// Client-safe phase vocabulary — THE single source for how order + item state
// reads on client surfaces (hub order page, per-job portal, emails later).
// Locked with Jon 2026-07-20: In progress / Awaiting your approval /
// Approved · preparing / In production / Shipping / Delivered.
//
// Everything derives from the SAME fields the internal phase engine reads
// (pipeline_stage, received/forwarded/entered, route, proof approvals) — never
// a parallel state machine. Route resolution: item route overrides job route.

export type ClientTone = "warn" | "move" | "done" | "dim";

export type ClientItemPhase = { label: string; tone: ClientTone };

// Per-item, using the portal payload's item shape (see /api/portal/[token]).
export function itemClientPhase(it: {
  pipelineStage?: string | null;
  shippingRoute?: string | null;
  receivedAtHpd?: boolean;
  forwardedAt?: string | null;
  webstoreEnteredAt?: string | null;
  internalApproved?: boolean;
  noProofNeeded?: boolean; // artwork_status n_a — nothing for the client to approve
  proofSentAt?: string | null;   // the proof was sent to the client (proof_spec render; no PDF needed)
  proofs?: { stage: string; approval: string }[];
}): ClientItemPhase {
  const route = it.shippingRoute || "ship_through";
  const done =
    route === "drop_ship" ? it.pipelineStage === "shipped"
    : route === "stage" ? !!it.webstoreEnteredAt
    : !!it.forwardedAt;
  if (done) return { label: "Delivered", tone: "done" };
  if (it.receivedAtHpd) {
    // Stage-route goods received at HPD ARE the client's inventory — say
    // "In stock" (matching the Pipeline sheet; POMG's samples read
    // "Shipping" for 3 months, Sep 2). A ship_through hop keeps "Shipping":
    // that warehouse stop is transient and not part of the client's story.
    if (route === "stage") return { label: "In stock", tone: "done" };
    return { label: "Shipping", tone: "move" };
  }
  if (it.pipelineStage === "shipped") return { label: "Shipping", tone: "move" };
  if (it.pipelineStage === "in_production") return { label: "In production", tone: "move" };

  if (it.noProofNeeded) return { label: "No proof needed", tone: "dim" };
  const proofs = (it.proofs || []).filter(p => p.stage === "proof");
  if (proofs.some(p => p.approval === "revision_requested")) return { label: "Revising your proof", tone: "warn" };
  const allApproved = proofs.length > 0 && proofs.every(p => p.approval === "approved");
  if (allApproved || it.internalApproved) return { label: "Approved · preparing", tone: "done" };
  // A sent proof is awaiting the client's approval — even before any PDF is baked,
  // the client approves the live proof_spec doc in the hub.
  if (proofs.length > 0 || it.proofSentAt) return { label: "Awaiting your approval", tone: "warn" };
  return { label: "In progress", tone: "dim" };
}

// Order-level rail: which step is current. Steps are fixed; the route decides
// whether "Shipping" exists as a distinct leg for the client.
export const CLIENT_RAIL = ["Approved", "In production", "Shipping", "Delivered"] as const;

export function orderRailIndex(phase: string | null | undefined, quoteApproved: boolean): number {
  // -1 = nothing lit yet (pre-approval)
  switch (phase) {
    case "complete": return 3;
    case "receiving":
    case "shipping":
    case "fulfillment": return 2;
    case "production": return 1;
    default: return quoteApproved ? 0 : -1;
  }
}

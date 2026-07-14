// The phase model — LOCKED 2026-07-14. Three maps that marry item → job → client.
// Replaces lib/lifecycle.ts (a priority cascade over legacy fields that forced one
// label to serve ops, items, AND the client). This is a PURE function: give it the
// gates + each item's ledger-derived position, get back all three views. No DB here
// — the loader resolves the inputs (payment-per-terms, proofs, po_sent, derivation).
//
//   ① OPS/JOB  — coarse gate spine (dynamic "Pending" label) + a fulfillment meter.
//   ② ITEM     — per-item track; PO-sent = Pre-Production → In production.
//   ③ CLIENT   — plain, gated; only the two "to-client" ship legs ever surface.

export type Route = "drop_ship" | "ship_through" | "stage";

export type PhaseGate = {
  quoteApproved: boolean;
  paymentReceived: boolean;   // resolved per terms by the caller
  proofsApproved: boolean;    // all items' proofs approved
};

export type PhaseItem = {
  route: Route;
  poSent: boolean;            // PO out to this item's vendor → it's "in production"
  shippedTotal: number;      // from the ledger derivation
  receivedTotal: number;
  forwardedTotal: number;
  enteredTotal: number;
  done: boolean;             // derivation routeDone (reached its route's endpoint)
};

// ── ② item track position ────────────────────────────────────────────────
export type ItemStage = "pre_production" | "in_production" | "shipped" | "at_hpd" | "out";
export const ITEM_STAGE_LABEL: Record<ItemStage, string> = {
  pre_production: "Pre-Production", in_production: "In production", shipped: "Shipped", at_hpd: "At HPD", out: "Out to client",
};

export function itemStage(it: PhaseItem): ItemStage {
  if (it.route === "drop_ship") {
    if (it.shippedTotal > 0) return "out";     // drop_ship ships straight to the client
    return it.poSent ? "in_production" : "pre_production";
  }
  // ship_through / stage — furthest leg reached
  if (it.forwardedTotal > 0 || it.enteredTotal > 0) return "out";
  if (it.receivedTotal > 0) return "at_hpd";
  if (it.shippedTotal > 0) return "shipped";   // in transit to HPD (internal)
  return it.poSent ? "in_production" : "pre_production";
}

// Has this item reached a leg the CLIENT is told about? (#2 drop_ship→client, #3 forward→client)
export function outToClient(it: PhaseItem): boolean {
  if (it.route === "drop_ship") return it.shippedTotal > 0;
  if (it.route === "ship_through") return it.forwardedTotal > 0;
  return false; // stage = webstore, no customer
}

// ── ① job phase (dynamic gate spine) ─────────────────────────────────────
export type JobPhaseKey = "intake" | "pending" | "cleared" | "in_production" | "complete";
export type JobPhase = { key: JobPhaseKey; label: string; detail?: string };

export function jobPhase(gate: PhaseGate, items: PhaseItem[]): JobPhase {
  // Once ANY item has started (PO out / shipped / beyond), the gates are behind us —
  // a job that's already producing can't be "Pending Payment". Gates only govern the
  // pre-production phases.
  const started = items.some(it => itemStage(it) !== "pre_production");
  if (started) {
    if (items.length > 0 && items.every(it => it.done)) return { key: "complete", label: "Complete" };
    return { key: "in_production", label: "In production" };
  }
  if (!gate.quoteApproved) return { key: "intake", label: "Intake" };
  if (!(gate.paymentReceived && gate.proofsApproved)) {
    // dynamic: name what's actually outstanding
    if (!gate.paymentReceived && !gate.proofsApproved) return { key: "pending", label: "Pending Client", detail: "payment + proofs" };
    if (!gate.paymentReceived) return { key: "pending", label: "Pending Payment", detail: "awaiting payment" };
    return { key: "pending", label: "Pending Approval", detail: "awaiting proofs" };
  }
  return { key: "cleared", label: "Cleared for production" };
}

// ── ③ client status (plain + gated) ──────────────────────────────────────
export type ClientStatus = "none" | "order_received" | "in_production" | "partially_shipped" | "shipped";
export const CLIENT_LABEL: Record<ClientStatus, string> = {
  none: "—", order_received: "Order received", in_production: "In production", partially_shipped: "Partially shipped", shipped: "Shipped",
};

export function clientStatus(gate: PhaseGate, items: PhaseItem[], noticeSent: boolean): ClientStatus {
  const started = items.some(it => itemStage(it) !== "pre_production");
  if (!started) return gate.quoteApproved ? "order_received" : "none";
  const cust = items.filter(it => it.route !== "stage"); // stage = webstore, no customer
  if (!cust.length) return "none";
  const out = cust.filter(outToClient).length;
  if (out === 0 || !noticeSent) return "in_production";     // gated — never auto-announce "shipped"
  return out === cust.length ? "shipped" : "partially_shipped";
}

// ── the whole model in one call ──────────────────────────────────────────
export type PhaseResult = {
  job: JobPhase;
  fulfillment: { out: number; total: number };  // "N of M out the door" — the internal partial signal
  client: ClientStatus;
  itemStages: ItemStage[];
};

export function computePhase(input: { gate: PhaseGate; items: PhaseItem[]; noticeSent?: boolean }): PhaseResult {
  const { gate, items } = input;
  return {
    job: jobPhase(gate, items),
    fulfillment: { out: items.filter(it => it.done).length, total: items.length },
    client: clientStatus(gate, items, !!input.noticeSent),
    itemStages: items.map(itemStage),
  };
}

// ── helper: resolve the payment gate from terms + payments (mirrors the old engine)
export function paymentGateMet(terms: string | null, payments: { amount: number; status: string }[]): boolean {
  const t = terms || "";
  if (t === "net_15" || t === "net_30") return true;
  if (t === "prepaid") return payments.filter(p => p.status === "paid").reduce((a, p) => a + p.amount, 0) > 0;
  if (t === "deposit_balance") return payments.some(p => p.status === "paid" || p.status === "partial");
  return false;
}

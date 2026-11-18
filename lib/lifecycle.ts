/**
 * Job lifecycle v2 — auto-calculated from item data.
 * Phase labels are READ-ONLY, never manually set (except on_hold).
 */
import { isItemInProduction } from "./item-status";
import { proofSatisfied } from "./proof-gate";
import { NON_GARMENT } from "./pricing";

export type LifecycleInput = {
  job: {
    job_type: string;
    shipping_route: string | null; // drop_ship, ship_through, stage
    payment_terms: string | null;
    quote_approved: boolean;
    phase: string;
    fulfillment_status: string | null;
    // isClosedOut(job): complete, and closed outside the ledger. Stays complete.
    closed_out?: boolean;
  };
  items: {
    id: string;
    pipeline_stage: string | null;
    // Was a PO sent to this item's vendor? Reliable "in production" signal,
    // independent of the racy pipeline_stage advance. Callers resolve it via
    // poSentToItem() in lib/item-status. Optional — when omitted, behavior is
    // unchanged (raw pipeline_stage only), so existing callers don't regress.
    po_sent?: boolean;
    blanks_order_number: string | null;
    blanks_order_cost: number | null;
    ship_tracking: string | null;
    received_at_hpd: boolean;
    artwork_status?: string | null;
    garment_type?: string | null;
    // Per-item route override (migration 076). NULL = use job default.
    // When set, this item follows its own route through the lifecycle:
    // a drop_ship item on a stage job never returns to HPD; a
    // ship_through item on a drop_ship job DOES return to HPD.
    shipping_route?: string | null;
    // Stage-route Shopify handoff timestamp (migration 078). NULL =
    // received but not yet keyed into Shopify; set = handed off to
    // Shopify/ShipStation and OpsHub considers it done.
    webstore_entered_at?: string | null;
    // Outbound HPD → client forward (migration 097). Set = this ship_through
    // item has been forwarded to the client (its completion event).
    forwarded_at?: string | null;
    // Ledger truth (optional; job-phase-recalc supplies it): this item still
    // has OWED units at the decorator — an open partial wave. The flat
    // mirrors can't represent "1900 received, 100 still producing"
    // (received_at_hpd=true means caught-up-to-shipped, and pipeline_stage
    // stays in_production), so without this signal a wave item falls through
    // every physical branch and the job wrongly drops to a gate phase
    // (Eagle Patch bug, 2026-07-16).
    ledger_open?: boolean;
    // Item closed out of the job (worksheet archive after Shopify entry, or
    // moved to another job). Archived items never gate a phase; a job whose
    // every item is archived is complete, not intake (HPD-2606-047, 2026-08-24).
    archived_at?: string | null;
    // Ledger truth (loadLedgerFlags): every received unit was pulled (samples),
    // so nothing is left to forward or enter. Counts as handed off on any route
    // that comes to HPD, or the item holds the job open forever (HPD-2608-004).
    pulled_out?: boolean;
  }[];
  payments: {
    amount: number;
    status: string;
  }[];
  proofStatus: Record<string, { allApproved: boolean }>; // keyed by item id
  poSentVendors: string[];
  costingVendors?: string[]; // unique vendor short codes from costing
};

export type LifecycleResult = {
  phase: string;
  itemProgress: string;
};

// A complete job closed out by hand (type_meta.closed_out). Jobs finished
// before box tracking have gaps in their ledger (receipts partly logged, no
// forwards), which the rules read as open work, so every recalc flipped them
// back to shipping/receiving (HPD-2603-011 and four others, Nov 2026). Like
// on_hold/cancelled, no engine moves a closed-out job. Every phase writer and
// the derived view check this.
export function isClosedOut(job: { phase?: string | null; type_meta?: any } | null | undefined): boolean {
  return job?.phase === "complete" && !!job?.type_meta?.closed_out;
}

export function calculatePhase(input: LifecycleInput): LifecycleResult {
  const { job, items: allItems, payments, proofStatus, poSentVendors, costingVendors } = input;

  // Manual locks
  if (job.phase === "on_hold" || job.phase === "cancelled") {
    return { phase: job.phase, itemProgress: "" };
  }
  if (job.phase === "complete" && job.closed_out) {
    return { phase: "complete", itemProgress: "Closed out" };
  }

  // Archived items are closed out — they never hold a job in an earlier phase.
  // Every item archived = the job is done (11 historic jobs sit exactly here).
  const items = allItems.filter(it => !it.archived_at);
  if (allItems.length > 0 && items.length === 0) {
    return { phase: "complete", itemProgress: `${allItems.length}/${allItems.length} complete` };
  }

  if (items.length === 0) {
    return { phase: "intake", itemProgress: "" };
  }

  const total = items.length;
  const route = job.shipping_route || "ship_through";

  // Per-item effective route — item override wins over job default.
  // Lets a single item on a multi-route job follow its own path.
  const effectiveRoute = (it: any) => it.shipping_route || route;

  // Drop-ship items and "to-HPD" items get counted in separate buckets
  // because their completion criteria are fundamentally different.
  // Drop-ship: done when shipped from decorator (never received at HPD).
  // ship_through/stage: done when received at HPD (then forwarded /
  // fulfilled).
  const dropShipItems = items.filter(it => effectiveRoute(it) === "drop_ship");
  const toHpdItems = items.filter(it => effectiveRoute(it) !== "drop_ship");

  // Count item states. "At decorator" counts items whose pipeline_stage says
  // in_production OR whose vendor got a PO (po_sent) but the stage advance was
  // missed — so a PO-sent item never silently falls out of the production count.
  const atDecorator = items.filter(it => it.ledger_open || isItemInProduction({ pipeline_stage: it.pipeline_stage, received_at_hpd: it.received_at_hpd, poSent: !!it.po_sent })).length;
  const shippedFromDecorator = items.filter(it => it.pipeline_stage === "shipped").length;
  // For receive checks, only "to-HPD" items can satisfy the gate —
  // drop-ship items leave the HPD-side accounting once they ship.
  const receivedAtHpd = toHpdItems.filter(it => it.received_at_hpd).length;
  const dropShipShipped = dropShipItems.filter(it => it.pipeline_stage === "shipped").length;
  // Match BlanksTab + ProjectProgress: only real garments need blanks.
  // "Ordered" signal is a NON-NULL order total — an explicit 0 marks free /
  // client-supplied blanks as ordered, so null (never entered) is the only
  // not-ordered state.
  const apparelItems = items.filter(it => !NON_GARMENT.includes(it.garment_type || ""));
  const blanksOrdered = apparelItems.filter(it => it.blanks_order_cost != null).length;
  const allProofsApproved = items.every(it => proofSatisfied(it, proofStatus[it.id]));

  // Each item's handoff: a stage item is done once keyed into Shopify
  // (ShipStation owns the rest), a ship_through item once forwarded. A fully
  // pulled item has nothing left to hand off on either route.
  const entered = (it: any) => !!it.webstore_entered_at || !!it.pulled_out;
  const forwarded = (it: any) => !!it.forwarded_at || !!it.pulled_out;

  // ── COMPLETE — every item satisfies ITS OWN route's completion event:
  //  - drop_ship: shipped from decorator.
  //  - ship_through: forwarded to client (forwarded_at — migration 097).
  //  - stage: received at HPD AND keyed into Shopify.
  // Resolved per item, so a mixed-route job completes only when each bucket is
  // truly done (a received-but-not-forwarded ship_through item no longer
  // false-completes the job).
  const stItems = toHpdItems.filter(it => effectiveRoute(it) === "ship_through");
  const stageItems = toHpdItems.filter(it => effectiveRoute(it) === "stage");
  const dropShipDone = dropShipItems.length === 0 || dropShipShipped === dropShipItems.length;
  const stDone = stItems.length === 0 || stItems.every(forwarded);
  const stageDone = stageItems.length === 0 || stageItems.every(it => it.received_at_hpd && entered(it));
  const toHpdDone = toHpdItems.length === 0 || (stDone && stageDone);
  if (dropShipDone && toHpdDone && (dropShipItems.length + toHpdItems.length) > 0) {
    return { phase: "complete", itemProgress: `${total}/${total} complete` };
  }

  // ── FULFILLMENT (stage route, all to-HPD items received at HPD)
  // Two sub-states:
  //   1. Received but not yet entered into Shopify — needs warehouse action.
  //   2. All entered, awaiting ShipStation fulfillment — out of OpsHub scope
  //      (shouldn't happen now that we auto-complete on entry, but kept
  //      for safety in case the user hasn't run migration 078 yet).
  //  A stale fulfillment_status "shipped" (an earlier ship-out on the same job)
  //  never hides units still waiting for Shopify: HPD-2605-047's pre-order
  //  landed after its samples shipped out, dropped to "production", and so
  //  never reached the staging board (Nov 2026).
  if (route === "stage"
      && toHpdItems.length > 0
      && receivedAtHpd === toHpdItems.length) {
    // Over STAGE items only: a ship_through override on a stage job finishes
    // by being forwarded, never entered, and belongs to the shipping branch.
    if (!stageItems.every(entered)) {
      const enteredCount = stageItems.filter(entered).length;
      return { phase: "fulfillment", itemProgress: `${enteredCount}/${stageItems.length} entered in Shopify` };
    }
    // ...and only once nothing is left to forward: an unforwarded ship_through
    // override belongs to the shipping branch below.
    if (job.fulfillment_status !== "shipped" && stItems.every(forwarded)) {
      const status = job.fulfillment_status || "staged";
      return { phase: "fulfillment", itemProgress: status };
    }
  }

  // ── SHIPPING (wave-based) — any ship_through item has landed (received) and
  // not all are forwarded yet. Resolved per item, so a mixed drop_ship job with
  // a ship_through item lands here too. The awaiting count surfaces items still
  // in transit; "ship what's landed" while the rest catch up.
  if (stItems.length > 0) {
    const stReceived = stItems.filter(it => it.received_at_hpd).length;
    const stForwarded = stItems.filter(forwarded).length;
    if (stReceived > 0 && stForwarded < stItems.length) {
      const awaiting = stItems.length - stReceived;
      return { phase: "shipping", itemProgress: awaiting > 0 ? `${stForwarded}/${stItems.length} forwarded · ${awaiting} awaiting` : `${stForwarded}/${stItems.length} forwarded` };
    }
  }

  // ── RECEIVING (any to-HPD item shipped from decorator, coming to HPD)
  if (toHpdItems.length > 0) {
    const toHpdShippedFromDecorator = toHpdItems.filter(it => it.pipeline_stage === "shipped").length;
    if (toHpdShippedFromDecorator > 0) {
      const pending = toHpdShippedFromDecorator - receivedAtHpd;
      if (pending > 0 || (receivedAtHpd > 0 && receivedAtHpd < toHpdItems.length)) {
        return { phase: "receiving", itemProgress: `${receivedAtHpd}/${toHpdShippedFromDecorator} received` };
      }
    }
  }

  // ── PRODUCTION (any item at decorator or shipped from decorator, OR all POs sent + blanks ordered)
  if (atDecorator > 0 || shippedFromDecorator > 0) {
    const inProd = atDecorator + shippedFromDecorator;
    return { phase: "production", itemProgress: `${inProd}/${total} at decorator` };
  }

  // POs sent + blanks ordered = production (waiting on decorator)
  const vendors = costingVendors || [];
  const allPosSent = vendors.length > 0 && vendors.every((v: string) => (poSentVendors || []).includes(v));
  const allBlanksOrdered = apparelItems.length === 0 || blanksOrdered === apparelItems.length;
  if (allPosSent && allBlanksOrdered) {
    return { phase: "production", itemProgress: "At decorator — awaiting completion" };
  }

  // ── READY (all gates met, need to order blanks / send POs)
  if (job.quote_approved && allProofsApproved) {
    const terms = job.payment_terms || "";
    let paymentGateMet = false;
    if (terms === "net_15" || terms === "net_30") {
      paymentGateMet = true;
    } else if (terms === "prepaid") {
      paymentGateMet = payments.filter(p => p.status === "paid").reduce((a, p) => a + p.amount, 0) > 0;
    } else if (terms === "deposit_balance") {
      paymentGateMet = payments.some(p => p.status === "paid" || p.status === "partial");
    } else {
      paymentGateMet = false;
    }

    if (paymentGateMet) {
      if (blanksOrdered > 0) {
        return { phase: "ready", itemProgress: `${blanksOrdered}/${apparelItems.length} blanks ordered` };
      }
      return { phase: "ready", itemProgress: "Order blanks & send POs" };
    }
  }

  // ── PENDING (quote approved but waiting on payment/proofs)
  if (job.quote_approved) {
    const pending: string[] = [];
    if (!allProofsApproved) pending.push("proofs");
    const terms = job.payment_terms || "";
    if (terms !== "net_15" && terms !== "net_30") {
      const hasPaid = payments.some(p => p.status === "paid" || p.status === "partial");
      if (!hasPaid) pending.push("payment");
    }
    if (pending.length > 0) {
      return { phase: "pending", itemProgress: `Waiting on ${pending.join(" + ")}` };
    }
    // If quote approved and no pending items, fall to ready
    return { phase: "ready", itemProgress: "Order blanks & send POs" };
  }

  // ── INTAKE (default)
  return { phase: "intake", itemProgress: "" };
}

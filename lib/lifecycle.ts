/**
 * Job lifecycle v2 — auto-calculated from item data.
 * Phase labels are READ-ONLY, never manually set (except on_hold).
 */
import { isItemInProduction } from "./item-status";

export type LifecycleInput = {
  job: {
    job_type: string;
    shipping_route: string | null; // drop_ship, ship_through, stage
    payment_terms: string | null;
    quote_approved: boolean;
    phase: string;
    fulfillment_status: string | null;
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

export function calculatePhase(input: LifecycleInput): LifecycleResult {
  const { job, items, payments, proofStatus, poSentVendors, costingVendors } = input;

  // Manual locks
  if (job.phase === "on_hold" || job.phase === "cancelled") {
    return { phase: job.phase, itemProgress: "" };
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
  const atDecorator = items.filter(it => isItemInProduction({ pipeline_stage: it.pipeline_stage, received_at_hpd: it.received_at_hpd, poSent: !!it.po_sent })).length;
  const shippedFromDecorator = items.filter(it => it.pipeline_stage === "shipped").length;
  // For receive checks, only "to-HPD" items can satisfy the gate —
  // drop-ship items leave the HPD-side accounting once they ship.
  const receivedAtHpd = toHpdItems.filter(it => it.received_at_hpd).length;
  const dropShipShipped = dropShipItems.filter(it => it.pipeline_stage === "shipped").length;
  // Match BlanksTab + ProjectProgress: only real garments need blanks.
  // "Ordered" signal is order total > 0 (entered after ordering externally) —
  // the order # field was removed from the UI.
  const NON_GARMENT = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];
  const apparelItems = items.filter(it => !NON_GARMENT.includes(it.garment_type || ""));
  const blanksOrdered = apparelItems.filter(it => (it.blanks_order_cost ?? 0) > 0).length;
  const allProofsApproved = items.every(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved");

  // Stage-route "done" requires both received AND webstore_entered on
  // every to-HPD item. The webstore handoff is the OpsHub completion
  // event for stage — once items are keyed into Shopify, ShipStation
  // owns the rest. Without this check, stage jobs piled up forever in
  // the "fulfillment" phase. drop_ship + ship_through ignore this flag.
  const allStageWebstoreEntered = route !== "stage"
    || toHpdItems.length === 0
    || toHpdItems.every(it => !!it.webstore_entered_at);

  // ── COMPLETE
  // Both buckets must satisfy their own completion criteria:
  //  - drop-ship items: all shipped from decorator
  //  - to-HPD items: route-appropriate fulfillment done
  const dropShipDone = dropShipItems.length === 0 || dropShipShipped === dropShipItems.length;
  const toHpdDone = toHpdItems.length === 0
    || (route === "drop_ship"
        // Mixed-route exception: job-level drop_ship with some
        // ship_through/stage items. Those items still need to reach HPD,
        // then go out — but the job has no fulfillment_status to gate on
        // (drop_ship jobs don't carry one). Use "all received at HPD" as
        // the proxy. /shipping won't pick these up because shipping_route
        // is drop_ship; they'd need to be forwarded manually if applicable.
        ? toHpdItems.every(it => it.received_at_hpd)
        : route === "stage"
          // Stage completion: items received AND keyed into Shopify.
          ? (toHpdItems.every(it => it.received_at_hpd) && allStageWebstoreEntered)
          // ship_through: outbound shipped from HPD.
          : job.fulfillment_status === "shipped");
  if (dropShipDone && toHpdDone && (dropShipItems.length + toHpdItems.length) > 0) {
    return { phase: "complete", itemProgress: `${total}/${total} complete` };
  }

  // ── FULFILLMENT (stage route, all to-HPD items received at HPD)
  // Two sub-states:
  //   1. Received but not yet entered into Shopify — needs warehouse action.
  //   2. All entered, awaiting ShipStation fulfillment — out of OpsHub scope
  //      (shouldn't happen now that we auto-complete on entry, but kept
  //      for safety in case the user hasn't run migration 078 yet).
  if (route === "stage"
      && toHpdItems.length > 0
      && receivedAtHpd === toHpdItems.length
      && job.fulfillment_status !== "shipped") {
    if (!allStageWebstoreEntered) {
      const entered = toHpdItems.filter(it => !!it.webstore_entered_at).length;
      return { phase: "fulfillment", itemProgress: `${entered}/${toHpdItems.length} entered in Shopify` };
    }
    const status = job.fulfillment_status || "staged";
    return { phase: "fulfillment", itemProgress: status };
  }

  // ── SHIPPING (ship_through route, all to-HPD items received, needs forwarding)
  if (route === "ship_through"
      && toHpdItems.length > 0
      && receivedAtHpd === toHpdItems.length
      && receivedAtHpd > 0
      && job.fulfillment_status !== "shipped") {
    return { phase: "shipping", itemProgress: "Ready to forward to client" };
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

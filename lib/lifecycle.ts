/**
 * Job lifecycle v2 — auto-calculated from item data.
 * Phase labels are READ-ONLY, never manually set (except on_hold).
 */

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
    blanks_order_number: string | null;
    ship_tracking: string | null;
    received_at_hpd: boolean;
    artwork_status?: string | null;
    garment_type?: string | null;
  }[];
  payments: {
    amount: number;
    status: string;
  }[];
  proofStatus: Record<string, { allApproved: boolean }>; // keyed by item id
  poSentVendors: string[];
};

export type LifecycleResult = {
  phase: string;
  itemProgress: string;
};

export function calculatePhase(input: LifecycleInput): LifecycleResult {
  const { job, items, payments, proofStatus, poSentVendors } = input;

  // Manual locks
  if (job.phase === "on_hold" || job.phase === "cancelled") {
    return { phase: job.phase, itemProgress: "" };
  }

  if (items.length === 0) {
    return { phase: "intake", itemProgress: "" };
  }

  const total = items.length;
  const route = job.shipping_route || "ship_through";

  // Count item states
  const atDecorator = items.filter(it => it.pipeline_stage === "in_production").length;
  const shippedFromDecorator = items.filter(it => it.pipeline_stage === "shipped").length;
  const receivedAtHpd = items.filter(it => it.received_at_hpd).length;
  const apparelItems = items.filter(it => it.garment_type !== "accessory");
  const blanksOrdered = apparelItems.filter(it => it.blanks_order_number).length;
  const allProofsApproved = items.every(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved");

  // ── COMPLETE
  if (route === "drop_ship") {
    // All items have tracking from decorator = complete
    if (shippedFromDecorator === total) {
      return { phase: "complete", itemProgress: `${total}/${total} complete` };
    }
  } else if (route === "stage") {
    // Fulfillment shipped = complete
    if (job.fulfillment_status === "shipped") {
      return { phase: "complete", itemProgress: `${total}/${total} complete` };
    }
  } else {
    // ship_through: complete when fulfillment_status = "shipped" (outbound tracking entered on warehouse page)
    if (job.fulfillment_status === "shipped") {
      return { phase: "complete", itemProgress: `${total}/${total} complete` };
    }
  }

  // ── FULFILLMENT (stage route only, all items received at HPD)
  if (route === "stage" && receivedAtHpd === total && job.fulfillment_status !== "shipped") {
    const status = job.fulfillment_status || "staged";
    return { phase: "fulfillment", itemProgress: status };
  }

  // ── RECEIVING (items shipped from decorator, coming to HPD)
  if (route !== "drop_ship" && shippedFromDecorator > 0) {
    const pending = shippedFromDecorator - receivedAtHpd;
    if (pending > 0 || (receivedAtHpd > 0 && receivedAtHpd < total)) {
      return { phase: "receiving", itemProgress: `${receivedAtHpd}/${shippedFromDecorator} received` };
    }
  }

  // ── PRODUCTION (any item at decorator or shipped from decorator, OR all POs sent + blanks ordered)
  if (atDecorator > 0 || shippedFromDecorator > 0) {
    const inProd = atDecorator + shippedFromDecorator;
    return { phase: "production", itemProgress: `${inProd}/${total} at decorator` };
  }

  // POs sent + blanks ordered = production (waiting on decorator)
  const costProds = (job as any).costing_data?.costProds || [];
  const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))];
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
      paymentGateMet = true;
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

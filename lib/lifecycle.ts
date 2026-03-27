/**
 * Job lifecycle auto-advancement.
 * Phase is always calculated from item data — never manually set.
 * Returns the new phase and item progress counts.
 */

export type LifecycleInput = {
  job: {
    job_type: string;
    payment_terms: string | null;
    quote_approved: boolean;
    phase: string;
  };
  items: {
    id: string;
    pipeline_stage: string | null;
    blanks_order_number: string | null;
    ship_tracking: string | null;
  }[];
  payments: {
    amount: number;
    status: string;
  }[];
  costingData: {
    costProds?: { id: string; printVendor?: string }[];
  } | null;
  posSent?: string[]; // vendor names that have had POs emailed
};

export type LifecycleResult = {
  phase: string;
  itemProgress: string; // e.g. "3/5 items in production"
};

const PHASE_ORDER = ["intake", "pre_production", "production", "receiving", "shipped", "complete"];

export function calculatePhase(input: LifecycleInput): LifecycleResult {
  const { job, items, payments, costingData } = input;

  // Manual locks — don't auto-advance
  if (job.phase === "on_hold" || job.phase === "cancelled") {
    return { phase: job.phase, itemProgress: "" };
  }

  // No items yet — stay in intake
  if (items.length === 0) {
    return { phase: "intake", itemProgress: "" };
  }

  const total = items.length;

  // Count items at each production stage
  const blanksOrdered = items.filter(it => it.blanks_order_number).length;
  const inProduction = items.filter(it => it.pipeline_stage === "in_production" || it.pipeline_stage === "shipped").length;
  const shipped = items.filter(it => it.pipeline_stage === "shipped" && it.ship_tracking).length;

  // For warehouse vs drop_ship routing
  const isDropShip = job.job_type === "drop_ship";

  // ── COMPLETE: all items shipped (and for warehouse jobs, received + shipped to client)
  // For drop ship: all items have tracking from decorator = complete
  // For warehouse: handled by warehouse page — items marked shipped to client
  if (shipped === total) {
    return { phase: "complete", itemProgress: `${total}/${total} complete` };
  }

  // ── SHIPPED: at least one item shipped to client (warehouse) or from decorator (drop ship)
  if (shipped > 0 && isDropShip) {
    return { phase: "shipped", itemProgress: `${shipped}/${total} items shipped` };
  }

  // ── RECEIVING: at least one item has tracking from decorator (warehouse jobs)
  const withTracking = items.filter(it => it.ship_tracking).length;
  if (withTracking > 0 && !isDropShip) {
    return { phase: "receiving", itemProgress: `${withTracking}/${total} items incoming` };
  }

  // ── PRODUCTION: at least one item is in_production or shipped (at decorator)
  if (inProduction > 0) {
    return { phase: "production", itemProgress: `${inProduction}/${total} items in production` };
  }

  // ── PRE_PRODUCTION: quote approved + payment gate met (blanks ordering happens here)
  if (job.quote_approved) {
    const terms = job.payment_terms || "";
    let paymentGateMet = false;

    if (terms === "net_15" || terms === "net_30") {
      paymentGateMet = true; // No payment needed for net terms
    } else if (terms === "prepaid") {
      // Need full payment — check if total paid covers something (simplified: any paid payment)
      const totalPaid = payments
        .filter(p => p.status === "paid")
        .reduce((a, p) => a + p.amount, 0);
      paymentGateMet = totalPaid > 0;
    } else if (terms === "deposit_balance") {
      // Need at least one payment recorded
      paymentGateMet = payments.some(p => p.status === "paid" || p.status === "partial");
    } else {
      // Unknown terms — default to gate met if any payment exists
      paymentGateMet = payments.length > 0 || true; // Permissive default
    }

    if (paymentGateMet) {
      const progress = blanksOrdered > 0 ? `${blanksOrdered}/${total} blanks ordered` : "";
      return { phase: "pre_production", itemProgress: progress };
    }
  }

  // ── INTAKE: default
  return { phase: "intake", itemProgress: "" };
}

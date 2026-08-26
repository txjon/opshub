/**
 * Single source of truth for "how much revenue did this job actually produce"
 * used across every KPI surface (insights, god-mode, reports, clients detail,
 * dashboard).
 *
 * The priority chain:
 *   1. costing_summary.grossRev — the current costing state. Refreshed on
 *      every costing-tab save, so adding items after an unlock, removing
 *      items, or any other edit immediately flows through to KPIs.
 *   2. Fallback: QB-billed total (qb_total_with_tax minus qb_tax_amount).
 *      Only used when costing_summary is missing/zero — e.g. legacy jobs
 *      migrated in without a saved summary, or pre-costing-tab data.
 *
 * Variance-review flow: once a variance-adjusted invoice is PUSHED
 * (type_meta.qb_variance_total), that billed amount is the job's final
 * revenue truth and wins the chain below — no writeback into
 * costing_summary (CostingTab would clobber it on its next save). The
 * §2.5 invoice/end-of-road design will formalize financial close; until
 * then a post-variance costing edit intentionally does NOT override the
 * variance-billed figure.
 *
 * Earlier this helper preferred QB over costing. That broke the
 * "unlock + add items" case Jon hit on HPD-2605-006: items were added,
 * cost KPI updated, but the revenue chip stayed pinned to the moment QB
 * was first pushed. Reversed the priority so the chip matches the
 * costing tab's current numbers.
 *
 * Cost is NOT adjusted — decorator + blanks were committed at ordered qty
 * regardless of what shipped, so costing_summary.totalCost stays authoritative.
 */

type JobForRevenue = {
  type_meta?: any;
  costing_summary?: any;
};

export function effectiveRevenue(job: JobForRevenue | null | undefined): number {
  if (!job) return 0;
  const cs = job.costing_summary;
  const csGross = Number(cs?.grossRev) || 0;
  // 0. Variance-adjusted invoice pushed → the adjusted billed amount IS the
  //    revenue (shipped-qty truth). Net out tax + passthrough; fee lines are
  //    real HPD revenue and stay in.
  const meta0 = (job.type_meta || {}) as any;
  const vTotal = Number(meta0.qb_variance_total) || 0;
  if (vTotal > 0) {
    const vTax = Number(meta0.qb_variance_tax) || 0;
    const passthru0 = Number(cs?.passthruTotal) || 0;
    return Math.max(0, vTotal - vTax - passthru0);
  }
  // HPD-side additional charges (fee/charge/discount) count as revenue.
  // Passthrough is deliberately NOT added here — it's collected and paid
  // straight back out, so it's $0-margin and must stay out of revenue (and
  // therefore out of profit + margin). costing_summary.grossRev itself stays
  // product-only; we add the fee revenue on top.
  const feeRevenue = Number(cs?.feeRevenue) || 0;
  if (csGross > 0) return csGross + feeRevenue;

  const meta = job.type_meta || {};
  const qbTotal = Number(meta.qb_total_with_tax) || 0;
  const qbTax = Number(meta.qb_tax_amount) || 0;
  // QB total includes passthrough (the client is billed for it), so net it
  // back out to keep the revenue figure passthru-free on the QB fallback path.
  const passthruTotal = Number(cs?.passthruTotal) || 0;
  if (qbTotal > 0) return Math.max(0, qbTotal - qbTax - passthruTotal);

  // No costing run and no QB push yet, but standalone fee lines may exist.
  if (feeRevenue !== 0) return Math.max(0, feeRevenue);

  return 0;
}

export function effectiveCost(job: JobForRevenue | null | undefined): number {
  if (!job) return 0;
  return Number(job.costing_summary?.totalCost) || 0;
}

export function effectiveProfit(job: JobForRevenue | null | undefined): number {
  return effectiveRevenue(job) - effectiveCost(job);
}

export function effectiveMarginPct(job: JobForRevenue | null | undefined): number {
  const rev = effectiveRevenue(job);
  if (rev <= 0) return 0;
  return (rev - effectiveCost(job)) / rev;
}

// ── Inventory jobs ─────────────────────────────────────────────────────────
// A job flagged `is_inventory` is a bulk stock/blank purchase (e.g. blank hats
// bought to decorate + sell across future jobs), NOT a client sale. Its cost
// rides the future jobs that actually sell the stock (normal costing), so it
// must be excluded from every P&L rollup — counting it would drag margin now
// AND double-count later when those jobs carry the per-unit blank cost. The job
// still exists for receiving / warehouse / PO so the stock can be ordered.
export const isInventoryJob = (job: any): boolean => !!job?.is_inventory;

// THE single job-inclusion policy for every P&L/KPI rollup (Jon, 2026-07-17):
//   - is_inventory: stock buys, cost rides future jobs (see above)
//   - cancelled: cancel/void zeroes reported revenue — a dead job is not sales
//   - is_test: Playwright/e2e sandbox jobs (jobs.is_test, migration 125)
//   - is_internal: internal lines (HPD Web / Labs, migration 164) — jobs run
//     production + POs but are never real revenue; client-level flag stamped
//     onto jobs by DB trigger
// Callers must SELECT phase + is_test + is_inventory + is_internal for this to work.
export function pnlJobs<T>(jobs: T[] | null | undefined): T[] {
  return (jobs || []).filter((j: any) => !j?.is_inventory && j?.phase !== "cancelled" && !j?.is_test && !j?.is_internal);
}

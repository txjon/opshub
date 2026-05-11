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
 * Variance-review flow: writes back to costing_summary as well as QB, so
 * cs.grossRev tracks the adjusted amount.
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
  if (csGross > 0) return csGross;

  const meta = job.type_meta || {};
  const qbTotal = Number(meta.qb_total_with_tax) || 0;
  const qbTax = Number(meta.qb_tax_amount) || 0;
  if (qbTotal > 0) return Math.max(0, qbTotal - qbTax);

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

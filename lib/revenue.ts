/**
 * Single source of truth for "how much revenue did this job actually produce"
 * used across every KPI surface (insights, god-mode, reports, clients detail,
 * dashboard).
 *
 * The priority chain:
 *   1. If a QB invoice has been pushed — type_meta.qb_total_with_tax minus
 *      qb_tax_amount. This is authoritative because it reflects any
 *      variance-review adjustments + any manual tweaks made in QB, and sales
 *      tax is a pass-through (never revenue).
 *   2. Otherwise — costing_summary.grossRev (the quoted amount).
 *
 * Why this matters:
 *   Jobs that go through the variance review flow end up with a QB total
 *   lower than costing_summary.grossRev (e.g. $5,342.25 billed vs $5,355
 *   originally quoted). Without this helper, KPIs over-state revenue by the
 *   variance gap.
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
  const meta = job.type_meta || {};
  const qbTotal = Number(meta.qb_total_with_tax) || 0;
  const qbTax = Number(meta.qb_tax_amount) || 0;

  if (qbTotal > 0) {
    return Math.max(0, qbTotal - qbTax);
  }

  return Number(job.costing_summary?.grossRev) || 0;
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

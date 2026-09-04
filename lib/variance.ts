// Cost-variance summary — ACTUAL vs PROJECTED cost (decorator bills + blank
// purchases) per job/vendor/month. One source of truth, shared by the
// Variances tab (/reconciliation) and the god-mode owner tile.

import { calcCostProduct } from "@/lib/pricing";
import { overlayQtysOnly } from "@/lib/costing-summary";
import type { BillingQueue } from "@/lib/billing-queue";

const r2 = (n: number) => Math.round(n * 100) / 100;
const TOL = 25; // ignore variance noise under $25
const naRe = /^n\/?a$/i;

export type VarianceJobRow = {
  id: string; jobNumber: string; client: string; month: string;
  decoExp: number; decoBilled: number; decoVar: number;
  blankCalc: number; blankActual: number; blankVar: number; blankOrdered: boolean;
  totalVar: number;
  vendors: { name: string; expected: number; billed: number; variance: number }[];
};

export type VarianceSummary = {
  rows: VarianceJobRow[];
  netVar: number; totalOver: number; totalUnder: number;
  jobsOver: number; jobsUnder: number;
  worst: VarianceJobRow | undefined;
  vendors: { name: string; exp: number; billed: number; lines: number; inTol: number; variance: number; accuracy: number }[];
  months: { month: string; v: number }[];
  byJob: VarianceJobRow[];
  blanks: VarianceJobRow[];
};

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function computeVarianceSummary({ queue, jobsRaw, items, printers }: {
  queue: BillingQueue; jobsRaw: Record<string, any>; items: any[]; printers: Record<string, any>;
}): VarianceSummary {
  // blank actuals by job (exclude "NA"/"N/A" — no blank purchased)
  const blankActualByJob: Record<string, number> = {};
  const itemsByJob: Record<string, any[]> = {};
  for (const it of items) (itemsByJob[it.job_id] ||= []).push(it);
  for (const it of items) {
    if (naRe.test(String(it.blanks_order_number || "").trim())) continue;
    const a = Number(it.blanks_order_cost); if (a > 0) blankActualByJob[it.job_id] = r2((blankActualByJob[it.job_id] || 0) + a);
  }
  const rows: VarianceJobRow[] = [];
  for (const j of queue.jobs) {
    // Decorator variance — only vendors billed (or marked complete); cap an
    // accepted over (over_accept pass-through) at projection so it doesn't distort.
    let decoExp = 0, decoBilled = 0; const vrows: VarianceJobRow["vendors"] = [];
    for (const v of j.vendors) {
      if (v.billed <= 0.01 && !v.complete) continue; // awaiting = pending, not a variance
      const capped = v.complete && v.reason === "over_accept" && v.billed > v.expected ? v.expected : v.billed;
      decoExp = r2(decoExp + v.expected); decoBilled = r2(decoBilled + capped);
      vrows.push({ name: v.name, expected: v.expected, billed: capped, variance: r2(capped - v.expected) });
    }
    // Phase 4a (Sep 4 2026): quantities come from buy_sheet_lines via the
    // qty-only overlay — projecting from stored costing copies is what made
    // 2608-023 read $17.5K over when it was $4.5K under. Blank costs stay on
    // the stored copy until 4b's per-job reconciliation clears.
    const cps = overlayQtysOnly(jobsRaw[j.id]?.costing_data?.costProds || [], itemsByJob[j.id] || []);
    const margin = String(jobsRaw[j.id]?.costing_data?.margin ?? 0);
    const blankCalc = r2(cps.reduce((s: number, c: any) => { const calc = calcCostProduct(c, margin, false, false, cps, printers); return s + (calc ? Number(calc.blankCost || 0) : 0); }, 0));
    const blankActual = blankActualByJob[j.id] || 0;
    const blankOrdered = blankActual > 0;
    const blankVar = blankOrdered ? r2(blankActual - blankCalc) : 0;
    const decoVar = r2(decoBilled - decoExp);
    const totalVar = r2(decoVar + blankVar);
    const seg = (j.job_number || "").split("-")[1] || "";
    const month = /^\d{4}$/.test(seg) ? `${MONTHS[parseInt(seg.slice(2, 4), 10)] || seg.slice(2, 4)} ’${seg.slice(0, 2)}` : "—";
    if (decoExp === 0 && !blankOrdered) continue; // nothing billed yet
    rows.push({ id: j.id, jobNumber: j.job_number, client: j.client_name || "—", month, decoExp, decoBilled, decoVar, blankCalc, blankActual, blankVar, blankOrdered, totalVar, vendors: vrows });
  }

  const netVar = r2(rows.reduce((s, r) => s + r.totalVar, 0));
  const totalOver = r2(rows.filter(r => r.totalVar > 0).reduce((s, r) => s + r.totalVar, 0));
  const totalUnder = r2(rows.filter(r => r.totalVar < 0).reduce((s, r) => s + Math.abs(r.totalVar), 0));
  const jobsOver = rows.filter(r => r.totalVar > TOL).length;
  const jobsUnder = rows.filter(r => r.totalVar < -TOL).length;
  const worst = [...rows].sort((a, b) => b.totalVar - a.totalVar)[0];

  const vmap: Record<string, { name: string; exp: number; billed: number; lines: number; inTol: number }> = {};
  for (const r of rows) for (const v of r.vendors) {
    const g = vmap[v.name] = vmap[v.name] || { name: v.name, exp: 0, billed: 0, lines: 0, inTol: 0 };
    g.exp = r2(g.exp + v.expected); g.billed = r2(g.billed + v.billed); g.lines++;
    const tol = Math.max(50, v.expected * 0.05); if (Math.abs(v.variance) <= tol) g.inTol++;
  }
  const vendors = Object.values(vmap).map(g => ({ ...g, variance: r2(g.billed - g.exp), accuracy: g.lines ? Math.round((g.inTol / g.lines) * 100) : 0 }))
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const mmap: Record<string, number> = {};
  for (const r of rows) mmap[r.month] = r2((mmap[r.month] || 0) + r.totalVar);
  const months = Object.entries(mmap).filter(([k]) => k !== "—").map(([month, v]) => ({ month, v }));

  const byJob = [...rows].sort((a, b) => b.totalVar - a.totalVar);
  const blanks = rows.filter(r => r.blankOrdered).sort((a, b) => Math.abs(b.blankVar) - Math.abs(a.blankVar));

  return { rows, netVar, totalOver, totalUnder, jobsOver, jobsUnder, worst, vendors, months, byJob, blanks };
}

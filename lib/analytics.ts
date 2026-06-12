// Shared analytics primitives — one source of truth for the numbers that
// appear on both Reports and God Mode, so they can never drift apart.
//
// Job revenue/cost still come from lib/revenue (effectiveRevenue/effectiveCost).
// This module owns the ShipStation/fulfillment side and the date helpers.

const num = (x: any) => Number(x) || 0;

// Margin-accurate revenue + cost for one ShipStation report.
//   revenue = what the client was billed
//   cost    = the carrier postage + insurance we actually paid out
// So postage markup + fulfillment fees land as profit, pure pass-through nets
// to zero. Mirrors the QB invoice + report-detail math exactly.
export function ssRevCost(r: any): { revenue: number; cost: number } {
  const t = r.totals || {};
  const pt = r.postage_totals || {};
  if (r.report_type === "combined") {
    return { revenue: num(t.fee) + num(pt.billed) + num(pt.fulfillment), cost: num(pt.cost_raw) + num(pt.insurance) };
  }
  if (r.report_type === "postage") {
    return { revenue: num(t.billed) + num(t.fulfillment), cost: num(t.cost_raw) + num(t.insurance) };
  }
  if (r.report_type === "fulfillment") {
    return { revenue: num(t.fulfillment), cost: 0 };
  }
  return { revenue: num(t.fee), cost: 0 }; // sales — pure commission
}

export const ssReportLabel = (rt: string) =>
  rt === "combined" ? "Full Service" : rt === "postage" ? "Postage" : rt === "fulfillment" ? "Fulfillment" : "Sales";

// A report only counts as revenue once it's a real invoice (QB invoice # or
// emailed to the client). Unsent drafts are excluded everywhere.
export const isInvoicedReport = (r: any) => !!(r.qb_invoice_number || r.sent_at);

export const ssShipments = (r: any) => num((r.totals || {}).shipments) + num((r.postage_totals || {}).shipments);

// ── Date ranges ──────────────────────────────────────────────────────────
export type RangePreset = "this_month" | "last_month" | "quarter" | "ytd" | "12mo" | "all" | "custom";

export const RANGE_OPTIONS: { key: RangePreset; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "12mo", label: "Last 12 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

// Resolve a preset (+ optional custom strings) into [start, end] Dates.
// start = null means "no lower bound" (all time). end is exclusive-ish — we
// compare with <= end so a same-day custom range still includes that day.
export function resolveRange(preset: RangePreset, customStart?: string, customEnd?: string, today = new Date()): { start: Date | null; end: Date | null; label: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  switch (preset) {
    case "this_month":
      return { start: new Date(y, m, 1), end: endOfDay(today), label: today.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    case "last_month": {
      const s = new Date(y, m - 1, 1);
      return { start: s, end: endOfDay(new Date(y, m, 0)), label: s.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
    case "quarter": {
      const q = Math.floor(m / 3);
      return { start: new Date(y, q * 3, 1), end: endOfDay(today), label: `Q${q + 1} ${y}` };
    }
    case "ytd":
      return { start: new Date(y, 0, 1), end: endOfDay(today), label: `${y} YTD` };
    case "12mo": {
      const s = new Date(today); s.setMonth(s.getMonth() - 12);
      return { start: startOfDay(s), end: endOfDay(today), label: "Last 12 months" };
    }
    case "custom": {
      const s = customStart ? startOfDay(new Date(customStart + "T00:00:00")) : null;
      const e = customEnd ? endOfDay(new Date(customEnd + "T00:00:00")) : endOfDay(today);
      const fmt = (d: Date | null) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "start";
      return { start: s, end: e, label: `${fmt(s)} – ${fmt(e)}` };
    }
    case "all":
    default:
      return { start: null, end: null, label: "All time" };
  }
}

export function inRange(dateStr: string | null | undefined, start: Date | null, end: Date | null): boolean {
  if (!dateStr) return start === null; // no date → only included in "all time"
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return start === null;
  if (start && t < start.getTime()) return false;
  if (end && t > end.getTime()) return false;
  return true;
}

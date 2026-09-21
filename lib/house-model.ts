// THE HOUSE's pure rules — shared by the page (client) and the sidebar counts
// (server) so the number next to a section is the number of cards on it.

import { todayPacific, addDays } from "@/lib/dates";

export type VendorRisk = { job: any; due: string; level: "late" | "confirm"; promised: boolean; vendorKey: string | null };

// Vendor risk, timed off the REAL promises: the PO ship-by chips
// (po_ship_live > po_ship_dates), falling back to target ship date minus a
// transit buffer when no promise exists. Late = passed (red); confirm = within
// 3 days and still on press (amber). A date-stamped "vendor confirmed" for the
// same date stands the card down; a slip re-arms it.
// Only vendors that STILL have items on press count — a job's second vendor
// whose strip shipped in May must not keep the job "late" in September (FOG
// 2605-006 / 2605-032, Sep 16 2026). Vendor keys match the way the production
// board matches them: decorator name / short_code / costing printVendor,
// case-insensitive. A key we can't map to any item stays in (fail-safe).
function vendorsStillOnPress(job: any): Set<string> | null {
  const items: any[] = job.items || [];
  const onPress = items.filter((i: any) => i.pipeline_stage === "in_production");
  if (!onPress.length) return new Set();
  const cps: any[] = job.costing_data?.costProds || [];
  const keys = new Set<string>();
  let mapped = false;
  for (const it of onPress) {
    const cp = cps.find((c: any) => c?.id === it.id);
    const names = [
      ...((it.decorator_assignments || []) as any[]).flatMap((a: any) => [a.decorators?.name, a.decorators?.short_code]),
      cp?.printVendor,
    ].filter(Boolean).map((s: string) => s.toLowerCase().trim());
    if (names.length) mapped = true;
    for (const n of names) keys.add(n);
  }
  return mapped ? keys : null; // null = no mapping data on this job → keep every key
}

export function vendorRiskFor(job: any, today: string, soon: string): VendorRisk | null {
  if (job.phase !== "production") return null;
  if (!(job.items || []).some((i: any) => i.pipeline_stage === "in_production")) return null;
  const tm = (job.type_meta || {}) as any;
  const ok = (d: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  const live = vendorsStillOnPress(job);
  const vendorsAll = Array.from(new Set([...Object.keys(tm.po_ship_dates || {}), ...Object.keys(tm.po_ship_live || {})]))
    .filter(k => live === null || live.has(k.toLowerCase().trim()));
  const dated: [string, string][] = [];
  for (const k of vendorsAll) {
    const live = tm.po_ship_live?.[k]?.date;
    const agreed = tm.po_ship_dates?.[k];
    const eff = ok(live) ? live : ok(agreed) ? agreed : null;
    if (eff) dated.push([k, eff]);
  }
  dated.sort((a, b) => a[1].localeCompare(b[1]));
  const promise = dated[0]?.[1] || null;
  const vendorKey = dated[0]?.[0] || vendorsAll[0]
    || Object.keys(tm.po_ship_dates || {})[0] || Object.keys(tm.po_ship_live || {})[0] || null;
  const fallback = job.target_ship_date
    ? new Date(new Date(job.target_ship_date + "T00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10)
    : null;
  const due = promise || fallback;
  if (!due) return null;
  if (due < today) return { job, due, level: "late", promised: !!promise, vendorKey };
  if (due <= soon) {
    const conf = vendorKey ? tm.po_ship_confirmed?.[vendorKey] : null;
    if (conf?.date === due) return null;
    return { job, due, level: "confirm", promised: !!promise, vendorKey };
  }
  return null;
}

// Pacific, not UTC: these decide what is late and what is due soon, and a UTC
// "today" rolls the whole board forward a day every evening.
export const houseToday = () => todayPacific();
export const houseSoon = () => addDays(todayPacific(), 3);

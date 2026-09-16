// THE HOUSE's pure rules — shared by the page (client) and the sidebar counts
// (server) so the number next to a section is the number of cards on it.

export type VendorRisk = { job: any; due: string; level: "late" | "confirm"; promised: boolean; vendorKey: string | null };

// Vendor risk, timed off the REAL promises: the PO ship-by chips
// (po_ship_live > po_ship_dates), falling back to target ship date minus a
// transit buffer when no promise exists. Late = passed (red); confirm = within
// 3 days and still on press (amber). A date-stamped "vendor confirmed" for the
// same date stands the card down; a slip re-arms it.
export function vendorRiskFor(job: any, today: string, soon: string): VendorRisk | null {
  if (job.phase !== "production") return null;
  if (!(job.items || []).some((i: any) => i.pipeline_stage === "in_production")) return null;
  const tm = (job.type_meta || {}) as any;
  const ok = (d: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  const vendorsAll = Array.from(new Set([...Object.keys(tm.po_ship_dates || {}), ...Object.keys(tm.po_ship_live || {})]));
  const dated: [string, string][] = [];
  for (const k of vendorsAll) {
    const live = tm.po_ship_live?.[k]?.date;
    const agreed = tm.po_ship_dates?.[k];
    const eff = ok(live) ? live : ok(agreed) ? agreed : null;
    if (eff) dated.push([k, eff]);
  }
  dated.sort((a, b) => a[1].localeCompare(b[1]));
  const promise = dated[0]?.[1] || null;
  const vendorKey = dated[0]?.[0]
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

export const houseToday = () => new Date().toISOString().slice(0, 10);
export const houseSoon = () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

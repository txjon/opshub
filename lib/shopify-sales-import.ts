// Shopify sales-by-variant CSV → per-slot per-size sold counts (Continuum
// Phase 4). PURPOSE-BUILT for this one report shape — deliberately not the
// general ecomm importer. Rules that keep sold-truth honest:
//   • sales report only, date-scoped by the operator to the sell window —
//     NEVER inventory-derived (stock loads contaminate inventory math)
//   • join = final product name (the naming gate's key) + size (the only
//     variant dimension — one product per colorway, Jon 2026-08-18)
//   • unmatched rows are RETURNED, never silently dropped

export type SalesRow = { product: string; variant: string; qty: number };

// Minimal CSV: quoted fields, commas, CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(x => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function parseSalesCsv(text: string): { rows: SalesRow[]; error?: string } {
  const table = parseCsv(String(text || ""));
  if (table.length < 2) return { rows: [], error: "That doesn't look like a CSV export — no data rows found." };
  const header = table[0].map(h => norm(h));
  const find = (...pats: RegExp[]) => header.findIndex(h => pats.some(p => p.test(h)));
  const pCol = find(/^product title$/, /^product$/, /product.*title/, /^title$/);
  const vCol = find(/variant title/, /^variant$/, /variant/);
  const qCol = find(/net quantity/, /net items sold/, /quantity/, /units sold/, /net units/);
  if (pCol < 0 || qCol < 0) {
    return { rows: [], error: "Couldn't find the product / quantity columns. Export Shopify's \"Sales by product variant\" report as CSV." };
  }
  const acc = new Map<string, SalesRow>();
  for (const r of table.slice(1)) {
    const product = String(r[pCol] || "").trim();
    const variant = vCol >= 0 ? String(r[vCol] || "").trim() : "";
    const qty = Math.round(Number(String(r[qCol] || "").replace(/[",]/g, "")) || 0);
    if (!product) continue;
    const key = `${norm(product)}|${norm(variant)}`;
    const cur = acc.get(key);
    if (cur) cur.qty += qty;
    else acc.set(key, { product, variant, qty });
  }
  return { rows: Array.from(acc.values()) };
}

// Variant → size. Shopify's no-variant placeholder maps to the one-size key.
const sizeOf = (variant: string): string => {
  const v = variant.trim();
  if (!v || /^default title$/i.test(v)) return "OS";
  return v.toUpperCase();
};

// Listings for a pre-order window carry a " - Pre-Order" suffix the base
// product doesn't (FOG's real store, 2026-08-23). Exact match first; then
// retry with that one suffix stripped — deterministic, never fuzzy.
const stripPreorder = (s: string) => s.replace(/\s*[-–—·:(]?\s*pre[- ]?order\)?\s*$/i, "").trim();

export function matchSalesToSlots(
  rows: SalesRow[],
  slots: { id: string; name: string }[],
): { bySlot: Record<string, Record<string, number>>; matched: SalesRow[]; unmatched: SalesRow[] } {
  const byName = new Map<string, string>();
  for (const s of slots) if (s.name) byName.set(norm(s.name), s.id);
  const bySlot: Record<string, Record<string, number>> = {};
  const matched: SalesRow[] = [];
  const unmatched: SalesRow[] = [];
  for (const r of rows) {
    const slotId = byName.get(norm(r.product)) ?? byName.get(norm(stripPreorder(r.product)));
    if (!slotId) { unmatched.push(r); continue; }
    const size = sizeOf(r.variant);
    (bySlot[slotId] ||= {})[size] = ((bySlot[slotId] || {})[size] || 0) + Math.max(0, r.qty);
    matched.push(r);
  }
  // Zero-qty sizes drop so the ledger stays clean.
  for (const sid of Object.keys(bySlot)) {
    for (const sz of Object.keys(bySlot[sid])) if (bySlot[sid][sz] <= 0) delete bySlot[sid][sz];
    if (!Object.keys(bySlot[sid]).length) delete bySlot[sid];
  }
  return { bySlot, matched, unmatched };
}

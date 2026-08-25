// ── PO per-item note suggestions — derived from data OpsHub already holds, so
// the four vendor-facing fields stop being retyped by hand (Jon 2026-08-25).
// SUGGEST only: the UI shows these as placeholders + a one-click "use"; nothing
// is written to a vendor-facing field without a click.
import { carriedFrom } from "./proof-gate";

export type PoFieldKey = "drive_link" | "incoming_goods" | "production_notes_po" | "packing_notes";
export const PO_FIELDS: PoFieldKey[] = ["drive_link", "incoming_goods", "production_notes_po", "packing_notes"];

const sumQ = (q: any) => Object.values(q || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);

export function suggestPoField(k: PoFieldKey, item: any, cp: any, clientName: string): string | null {
  if (!item) return null;
  const units = Number(item.totalQty) || sumQ(item.qtys);
  if (k === "drive_link") {
    return item.drive_folder_id ? `https://drive.google.com/drive/folders/${item.drive_folder_id}` : null;
  }
  if (k === "incoming_goods") {
    const cost = item.blanks_order_cost;
    const indiv = (cp?.customCosts || []).some((c: any) => /individually packaged/i.test(c?.desc || ""));
    // Explicit 0 = free / client-supplied blanks (same rule the phase engine uses).
    if (cost !== null && cost !== undefined && cost !== "" && Number(cost) === 0) {
      return `${clientName || "Client"} stock — client-supplied blanks${indiv ? ", arriving individually packaged" : ""}`;
    }
    if (!item.blank_vendor) return null;
    const what = `${item.blank_vendor}${item.blank_sku ? ` · ${item.blank_sku}` : ""}${units ? ` · ${units.toLocaleString()} u` : ""}`;
    return cost != null && cost !== "" ? `${what} · ordered${indiv ? " · arriving individually packaged" : ""}` : what;
  }
  if (k === "production_notes_po") {
    const cf = carriedFrom(item);
    if (cf?.ref) return `Re-order of ${cf.ref} — same art as before`;
    if (cf?.jobNumber) return `Re-order of ${cf.jobNumber} — same art as before`;
    return null;
  }
  if (k === "packing_notes") {
    const fq = cp?.finishingQtys || {};
    if (!(fq.Packaging_on > 0)) return null;
    const variant = String(fq.Packaging_variant || "");
    const addOns = Object.keys(fq)
      .filter(key => key.endsWith("_on") && !key.startsWith("Packaging") && fq[key] > 0)
      .map(key => key.slice(0, -3).replace(/_/g, " ").toLowerCase());
    return `Individual fold / bag${variant && variant !== "Tee" ? ` (${variant.toLowerCase()})` : ""}${addOns.length ? ` + ${addOns.join(", ")}` : ""}`;
  }
  return null;
}

// Every empty field on these items that has a suggestion.
export function poSuggestionsFor(items: any[], cpFor: (it: any) => any, clientName: string): { item: any; k: PoFieldKey; value: string }[] {
  const out: { item: any; k: PoFieldKey; value: string }[] = [];
  for (const it of items || []) for (const k of PO_FIELDS) {
    if (it[k]) continue;
    const v = suggestPoField(k, it, cpFor(it), clientName);
    if (v) out.push({ item: it, k, value: v });
  }
  return out;
}

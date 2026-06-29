// Expected-arrival ETA (the warehouse ASN) — one source for /production and
// /receiving. drop_ship goes direct (= the ship date); HPD-routed adds the
// vendor's transit buffer in BUSINESS days. A per-item items.expected_arrival
// override wins upstream of this. Distinct from items.client_eta (client comms).

// Vendor transit buffer (business days) when a decorator has none set.
export const DEFAULT_TRANSIT_DAYS = 5;

export function addBusinessDays(dateStr: string, n: number): string {
  // Parse + step + read in UTC so the result is timezone-independent. (A local
  // anchor `new Date(dateStr+"T00:00:00")` read back via toISOString lands one
  // day early in UTC+ regions. Identical output in HPD's UTC-7/8 + Vercel UTC.)
  const d = new Date(dateStr + "T00:00:00Z");
  let added = 0;
  while (added < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) added++; }
  return d.toISOString().slice(0, 10);
}

export function computeArrivalEta(route: string, shipDate: string | null, transitDays: number | null): string | null {
  if (!shipDate || shipDate === "ASAP") return shipDate || null;
  if (route === "drop_ship") return shipDate;
  return addBusinessDays(shipDate, transitDays ?? DEFAULT_TRANSIT_DAYS);
}

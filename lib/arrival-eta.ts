// Expected-arrival ETA (the warehouse ASN) — one source for /production and
// /receiving. drop_ship goes direct (= the ship date); HPD-routed adds the
// vendor's transit buffer in BUSINESS days. A per-item items.expected_arrival
// override wins upstream of this. Distinct from items.client_eta (client comms).

// Vendor transit buffer (business days) when a decorator has none set.
export const DEFAULT_TRANSIT_DAYS = 5;

export function addBusinessDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; }
  return d.toISOString().slice(0, 10);
}

export function computeArrivalEta(route: string, shipDate: string | null, transitDays: number | null): string | null {
  if (!shipDate || shipDate === "ASAP") return shipDate || null;
  if (route === "drop_ship") return shipDate;
  return addBusinessDays(shipDate, transitDays ?? DEFAULT_TRANSIT_DAYS);
}

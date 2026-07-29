import { deriveDateChain } from "@/lib/date-chain";

// Per-item client ETA for ONE job — the same chain the hub's items API runs
// (client_eta override > PO ship dates + vendor transit + route buffer, with
// un-received box arrivals as override). Shared by both portal order routes
// so the order detail can show an estimated completion date.
//
// items need: id, shipping_route, ship_est, expected_arrival.
export async function etaByItemForJob(
  sb: any,
  job: { id: string; shipping_route?: string | null; type_meta?: any },
  items: any[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const ids = (items || []).map((i: any) => i.id);
  if (ids.length === 0) return out;

  const { data: assigns } = await sb
    .from("decorator_assignments")
    .select("item_id, decorators(name, short_code, lead_time_days, transit_defaults)")
    .in("item_id", ids);
  const decByItem: Record<string, any> = {};
  for (const a of (assigns || [])) decByItem[(a as any).item_id] = (a as any).decorators || null;

  const { data: lines } = await sb
    .from("shipment_lines")
    .select("item_id, received, shipments(expected_arrival, status)")
    .in("item_id", ids);
  const boxArrival: Record<string, string> = {};
  for (const l of (lines || [])) {
    const ea = (l as any).shipments?.expected_arrival;
    if (!ea || (l as any).received) continue;
    if (!boxArrival[(l as any).item_id] || ea > boxArrival[(l as any).item_id]) boxArrival[(l as any).item_id] = ea;
  }

  const tm = (job.type_meta || {}) as any;
  for (const it of items) {
    const dec = decByItem[it.id];
    const keys = [dec?.name, dec?.short_code].filter(Boolean).map((s: string) => s.toLowerCase().trim());
    const findKey = (map: any): string | null => {
      if (!map) return null;
      for (const k of Object.keys(map)) if (keys.includes(k.toLowerCase().trim())) return k;
      return null;
    };
    const agreedKey = findKey(tm.po_ship_dates), liveKey = findKey(tm.po_ship_live), methodKey = findKey(tm.po_ship_methods), sentKey = findKey(tm.po_sent_dates);
    const chain = deriveDateChain({
      route: (it.shipping_route || job.shipping_route || "ship_through") as any,
      lead: dec?.lead_time_days ?? null,
      transitDefaults: dec?.transit_defaults || null,
      shipMethod: methodKey ? tm.po_ship_methods[methodKey] : null,
      poSentDate: sentKey ? tm.po_sent_dates[sentKey] : null,
      shipByAgreed: agreedKey ? tm.po_ship_dates[agreedKey] : null,
      shipByLive: liveKey ? tm.po_ship_live[liveKey]?.date : null,
      shipByItemOverride: it.ship_est || null,
      // Box-level ETA only — legacy items.expected_arrival retired (fossil dates shadowed the chain).
      arrivalOverride: boxArrival[it.id] || null,
    });
    out[it.id] = chain.clientEta || null;
  }
  return out;
}

// Client-facing shipments for one order, from the LEDGER (split shipments,
// phase 3). Shared by the client hub order route and the legacy per-job portal
// route — one grouper, not two.
//
// Before this, both routes grouped by items.ship_tracking / forward_tracking:
// one tracking column per item, last wave wins, so two boxes for one item
// collapsed into one entry and drop-ship boxes on an inbound row were hidden.
// Now a shipment is a real box: ship movements on a 'direct' box (vendor →
// client) or forward movements on an 'outbound' box (HPD → client). Inbound
// (vendor → HPD) is internal and never surfaces. Vendor identity never leaves.

type Sb = any;

export type ClientShipment = {
  shipmentId: string;
  leg: "direct" | "forward";       // vendor → client, or HPD → client
  decoratorId: string | null;      // packing-slip link param on the drop-ship leg (never shown)
  tracking: string;                // "" for a pickup with no tracking
  forwardTracking?: string;        // set on the HPD → client leg (packing-slip link param)
  carrier: string | null;
  pickup: boolean;
  itemCount: number;
  units: number;
  destination: string | null;      // where it went: location label, or first line of the frozen address
  shippedAt: string;
  carrierStatus: string | null;
  estDelivery: string | null;
  deliveredAt: string | null;
  lastScanLocation: string | null;
};

export async function loadClientShipments(sb: Sb, args: { itemIds: string[] }): Promise<ClientShipment[]> {
  if (!args.itemIds.length) return [];
  const { data: moves } = await sb.from("movements")
    .select("id, item_id, type, qtys, shipment_id, reverses_id")
    .in("item_id", args.itemIds).in("type", ["ship", "forward"]).not("shipment_id", "is", null);
  if (!moves?.length) return [];
  // net units per box per item (reversals carry negatives)
  const perBox = new Map<string, Map<string, number>>();
  for (const m of moves as any[]) {
    const units = Object.values(m.qtys || {}).reduce((a: number, n: any) => a + (Number(n) || 0), 0);
    const items = perBox.get(m.shipment_id) || new Map<string, number>();
    items.set(m.item_id, (items.get(m.item_id) || 0) + units);
    perBox.set(m.shipment_id, items);
  }
  const boxIds = Array.from(perBox.keys());
  const { data: boxes } = await sb.from("shipments")
    .select("id, direction, decorator_id, tracking, carrier, pickup, created_at, location_id, ship_to_snapshot, carrier_status, carrier_detected, est_delivery_date, delivered_at, last_scan, client_locations(label)")
    .in("id", boxIds).in("direction", ["direct", "outbound"]).order("created_at", { ascending: true });
  const out: ClientShipment[] = [];
  for (const b of (boxes || []) as any[]) {
    const items = perBox.get(b.id) || new Map<string, number>();
    const live = Array.from(items.entries()).filter(([, u]) => u > 0);
    if (!live.length) continue;   // fully reversed
    const tracking = b.tracking || "";
    out.push({
      shipmentId: b.id,
      leg: b.direction === "outbound" ? "forward" : "direct",
      decoratorId: b.direction === "direct" ? (b.decorator_id || null) : null,
      tracking,
      ...(b.direction === "outbound" && tracking ? { forwardTracking: tracking } : {}),
      carrier: b.carrier_detected || b.carrier || null,
      pickup: !!b.pickup,
      itemCount: live.length,
      units: live.reduce((a, [, u]) => a + u, 0),
      destination: b.client_locations?.label || (b.ship_to_snapshot ? String(b.ship_to_snapshot).split("\n")[0].trim() : null) || null,
      shippedAt: b.created_at,
      carrierStatus: b.carrier_status || null,
      estDelivery: b.est_delivery_date || null,
      deliveredAt: b.delivered_at || null,
      lastScanLocation: b.last_scan?.location || null,
    });
  }
  return out;
}

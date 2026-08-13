import { createClient } from "@/lib/supabase/server";
import { loadReceivingBoard, loadProductionBoard } from "@/lib/item-state";
import { transitDaysFor } from "@/lib/date-chain";
import { addDays } from "@/lib/dates";
import TheDistroView, { type ArrivalRow, type DropRow } from "./View";

export const dynamic = "force-dynamic";

// THE DISTRO — warehouse front door. Merged 2026-08-13: the /distro arrival
// radar's data (chain-derived ETAs, stall watch, dock aging, drop schedule)
// assembled here server-side, rendered in the hub skin by View.tsx. /distro
// now redirects here; its Board.tsx is deleted.
//
// Radar row kinds, both chain-derived:
//   in transit — an inbound box (receiving's data, incl. its ETA + overrides)
//   at vendor  — a production strip's owed units; arrival projected as
//                ship-by + vendor transit (method-aware)

export default async function TheDistroPage() {
  const sb = await createClient();

  const [boxes, strips, dropsRaw] = await Promise.all([
    loadReceivingBoard(sb),
    loadProductionBoard(sb),
    sb.from("fulfillment_projects")
      .select("id, name, preorder_status, open_date, close_date, target_ship_date, platform, total_units, clients(name)")
      .eq("mode", "preorder")
      .in("preorder_status", ["planning", "building", "open", "closed"])
      .order("open_date", { ascending: true, nullsFirst: false })
      .then((r: any) => r.data || []),
  ]);

  // vendor transit profiles + ship methods for the at-vendor projection
  const decoratorIds = Array.from(new Set(strips.map(s => s.decoratorId).filter(Boolean))) as string[];
  const { data: decorators } = decoratorIds.length
    ? await sb.from("decorators").select("id, transit_defaults").in("id", decoratorIds)
    : { data: [] as any[] };
  const transitById = new Map<string, any>((decorators || []).map((d: any) => [d.id, d.transit_defaults]));
  const jobIds = Array.from(new Set(strips.map(s => s.jobId)));
  const { data: jobMeta } = jobIds.length
    ? await sb.from("jobs").select("id, type_meta").in("id", jobIds)
    : { data: [] as any[] };
  const metaByJob = new Map<string, any>((jobMeta || []).map((j: any) => [j.id, j.type_meta || {}]));

  const rows: ArrivalRow[] = [];

  // in-transit boxes (not yet fully received)
  for (const b of boxes.filter(b => !b.allReceived)) {
    const outstanding = b.totalUnits - b.receivedUnits;
    if (outstanding <= 0) continue;
    rows.push({
      kind: "box", id: b.id,
      client: b.clients.length > 1 ? `${b.clients.length} clients` : (b.clients[0] || b.vendorName),
      vendor: b.vendorName,
      itemsLabel: b.lines.length === 1 ? b.lines[0].itemName : `${b.lines.length} items`,
      units: outstanding,
      eta: b.expectedArrival, etaSource: b.etaSource,
      deliveredAt: b.deliveredAt, // carrier signal — pins the row to the dock bucket
      // stall watch (Phase 5): tracked + undelivered + feed gone quiet
      stall: (() => {
        if (b.deliveredAt || !b.carrierStatus) return null;
        const daysSince = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null;
        if (b.carrierStatus === "pre_transit") {
          const d = daysSince(b.createdAt);
          return d != null && d >= 3 ? { text: `label created ${d}d ago — not picked up`, severe: d >= 6 } : null;
        }
        const d = daysSince(b.lastScan?.at || null);
        return d != null && d >= 3 ? { text: `no scan ${d}d`, severe: d >= 6 } : null;
      })(),
      shippedAt: b.createdAt, carrier: b.carrier, tracking: b.tracking, pickup: b.pickup,
      note: b.note, slips: b.slips,
      lines: b.lines.map(l => ({
        name: l.itemName, client: l.client, route: l.route,
        qtys: l.shipQtys, receivedQtys: l.receivedQtys,
      })),
    });
  }

  // at-vendor strips (owed units still in production)
  for (const s of strips) {
    const owed = s.items.reduce((a, i) => a + i.owedTotal, 0);
    if (owed <= 0) continue;
    const tm = metaByJob.get(s.jobId) || {};
    const methodKey = s.poShipKey && tm.po_ship_methods
      ? Object.keys(tm.po_ship_methods).find(k => k.toLowerCase().trim() === s.poShipKey!.toLowerCase().trim())
      : null;
    const method = methodKey ? tm.po_ship_methods[methodKey] : null;
    const transit = transitDaysFor(s.decoratorId ? transitById.get(s.decoratorId) : null, method);
    const shipBy = s.shipDate && s.shipDate !== "ASAP" ? s.shipDate : null;
    // Per-item arrival OVERRIDES win over the projection (chain rule — same
    // as production2's rescheduled display): each item's arrival = its
    // recorded override, else ship-by + transit; the strip lands when its
    // slowest item does. An override-driven ETA is a real date, not a ~.
    const perItem = s.items.map(i => i.expectedArrival || (shipBy && transit != null ? addDays(shipBy, transit) : null));
    const known = (perItem.filter(Boolean) as string[]).sort();
    const eta = known.length ? known[known.length - 1] : null;
    const etaFromOverride = !!eta && s.items.some(i => i.expectedArrival === eta);
    const allOverridden = s.items.length > 0 && s.items.every(i => i.expectedArrival);
    rows.push({
      kind: "strip", id: s.key,
      client: s.clientName, vendor: s.decoratorName,
      itemsLabel: s.items.length === 1 ? s.items[0].name : `${s.items.length} items`,
      units: owed,
      shipBy: allOverridden ? null : s.shipDate, // dead ship-by drops off the line once fully rescheduled
      eta,
      // strips have no carrier feed (nothing shipped yet) — every date is an
      // estimate: human override or transit math. Both wear the ~.
      etaSource: (eta ? (etaFromOverride ? "human" : "derived") : null) as "human" | "derived" | null,
      lines: s.items.map(i => ({
        name: i.name, route: i.route,
        qtys: i.owed, orderedTotal: i.orderedTotal, shippedTotal: i.shippedTotal,
      })),
    });
  }

  const drops: DropRow[] = (dropsRaw as any[])
    .filter(d => d.open_date || d.close_date)
    .map(d => ({
      id: d.id, name: d.name, client: (d.clients as any)?.name || null,
      status: d.preorder_status, platform: d.platform || null,
      openDate: d.open_date || null, closeDate: d.close_date || null,
      targetShipDate: d.target_ship_date || null, totalUnits: d.total_units || null,
    }));

  return <TheDistroView rows={rows} drops={drops} />;
}

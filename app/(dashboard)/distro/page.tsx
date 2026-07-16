import { createClient } from "@/lib/supabase/server";
import { loadReceivingBoard, loadProductionBoard } from "@/lib/item-state";
import { transitDaysFor } from "@/lib/date-chain";
import { addDays } from "@/lib/dates";
import Board, { type ArrivalRow, type DropRow } from "./Board";

export const dynamic = "force-dynamic";

// /distro — the arrival radar (rebuilt 2026-07-16, locked mockup).
// The half-step between production and receiving: what's landing at the dock
// and when, plus the drop schedule. READ-ONLY — rows open a details modal;
// all actions live on /production2 and /receiving2.
//
// Two row kinds, both chain-derived:
//   in transit — an inbound box (receiving's data, incl. its ETA + overrides)
//   at vendor  — a production strip's owed units; arrival projected as
//                ship-by + vendor transit (method-aware)

export default async function DistroDashboard() {
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
      eta: b.expectedArrival, etaDerived: b.etaDerived,
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
    rows.push({
      kind: "strip", id: s.key,
      client: s.clientName, vendor: s.decoratorName,
      itemsLabel: s.items.length === 1 ? s.items[0].name : `${s.items.length} items`,
      units: owed,
      shipBy: s.shipDate,
      eta: shipBy && transit != null ? addDays(shipBy, transit) : null,
      etaDerived: true,
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

  return <Board rows={rows} drops={drops} />;
}

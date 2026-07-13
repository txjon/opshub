// Production v2 — the ship write. Selecting items (one vendor) and confirming a
// shipment appends the ledger movements + creates the physical box, exactly the
// data /receiving reads. Runs client-side, like the live /production board.
//
// Reuses the proven primitives: upsertShipmentForItem (find-or-create the box,
// batches multi-item into one shipment) + recordShip (append ship movement +
// recompute the qty cache). Adds the model's new piece — items.ship_final, THE
// "no more coming" signal that separates owed from shortage downstream.

import { upsertShipmentForItem } from "./handoff";
import { recordShip, cleanPositive } from "./inventory-ledger";
import { logJobActivity } from "@/components/JobActivityPanel";

export type ShipMethod = "tracking" | "bol" | "pickup";
export type ShipItemInput = {
  itemId: string; jobId: string; itemName: string;
  qtys: Record<string, number>;   // per-size for THIS wave
  final: boolean;                  // this is the last shipment for the item
};

export async function shipFromProduction(sb: any, args: {
  method: ShipMethod;
  tracking?: string | null;
  bol?: string | null;
  carrier?: string | null;        // parcel carrier (tracking) or freight carrier (BOL)
  packingSlipFileId?: string | null;
  note?: string | null;
  decoratorId: string | null;
  decoratorName: string | null;
  items: ShipItemInput[];
}): Promise<{ ok: boolean; shipped: number; boxes: number; boxIds: string[]; jobIds: string[]; error?: string }> {
  try {
    const trackingOrBol = args.method === "tracking" ? (args.tracking || "").trim() || null
      : args.method === "bol" ? (args.bol || "").trim() || null : null;
    const pickup = args.method === "pickup";
    const carrier = (args.carrier || "").trim() || (args.method === "bol" ? "Freight" : null);
    const shipDate = new Date().toISOString();

    const boxes = new Set<string>();
    const jobsTouched = new Set<string>();
    let shippedTotal = 0;

    // PASS 1 — create the physical boxes FIRST. If any box fails to create we
    // abort BEFORE writing a single ledger movement, so a failed ship never
    // leaves orphaned movements with no box (the "0 box" bug).
    const plan: { it: ShipItemInput; shipmentId: string; qtys: Record<string, number>; tot: number }[] = [];
    for (const it of args.items) {
      const qtys = cleanPositive(it.qtys);
      const tot = Object.values(qtys).reduce((a, n) => a + n, 0);
      if (tot === 0) continue;   // nothing entered for this item — skip it
      const shipmentId = await upsertShipmentForItem(sb, {
        job_id: it.jobId, item_id: it.itemId, item_name: it.itemName,
        decorator_id: args.decoratorId, decorator_name: args.decoratorName,
        pickup_ready: pickup, ship_tracking: trackingOrBol, ship_date: shipDate,
        ship_qtys: qtys, carrier, warehouse_notes: args.note || null,
        packing_slip_file_id: args.packingSlipFileId || null,
      });
      if (!shipmentId) return { ok: false, shipped: 0, boxes: 0, boxIds: [], jobIds: [], error: "Couldn't create the shipment box — nothing was written. Try again." };
      plan.push({ it, shipmentId, qtys, tot });
      boxes.add(shipmentId);
    }
    if (!plan.length) return { ok: false, shipped: 0, boxes: 0, boxIds: [], jobIds: [], error: "No quantities entered." };

    // PASS 2 — now that every box exists, append the ledger movements + item state.
    for (const { it, shipmentId, qtys, tot } of plan) {
      const prog = await recordShip(sb, {
        itemId: it.itemId, jobId: it.jobId, waveQtys: qtys, shipmentId,
        tracking: trackingOrBol, description: it.itemName,
      });
      // closed = operator marked final OR the waves now sum to ordered.
      const closed = it.final || !!prog?.fullyShipped;
      const { data: cur } = await sb.from("items")
        .select("pipeline_timestamps, ship_tracking, decorator_assignments(id)").eq("id", it.itemId).single();
      const timestamps = { ...(cur?.pipeline_timestamps || {}), shipped: (cur?.pipeline_timestamps || {}).shipped || shipDate };
      await sb.from("items").update({
        ship_final: closed,
        pipeline_stage: closed ? "shipped" : "in_production",   // keep legacy surfaces consistent
        ship_tracking: trackingOrBol || cur?.ship_tracking || null,
        pipeline_timestamps: timestamps,
      }).eq("id", it.itemId);
      const daId = cur?.decorator_assignments?.[0]?.id;
      if (daId) await sb.from("decorator_assignments").update({ pipeline_stage: closed ? "shipped" : "in_production" }).eq("id", daId);
      jobsTouched.add(it.jobId);
      shippedTotal += tot;
    }

    const how = args.method === "tracking" ? [carrier, trackingOrBol].filter(Boolean).join(" ") || "tracking"
      : args.method === "bol" ? `${carrier || "freight"}${trackingOrBol ? ` BOL ${trackingOrBol}` : ""}` : "pickup";
    for (const jobId of Array.from(jobsTouched)) {
      const n = args.items.filter(i => i.jobId === jobId).length;
      logJobActivity(jobId, `Shipped ${n} item${n > 1 ? "s" : ""} from production — ${how}`);
    }
    // notify is a deliberate post-ship action (the modal's "Notify warehouse")

    return { ok: true, shipped: shippedTotal, boxes: boxes.size, boxIds: Array.from(boxes), jobIds: Array.from(jobsTouched) };
  } catch (e: any) {
    console.error("[production2] shipFromProduction", e);
    return { ok: false, shipped: 0, boxes: 0, boxIds: [], jobIds: [], error: e?.message || "Ship failed." };
  }
}

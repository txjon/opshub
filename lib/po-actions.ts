// PO-send item-side effects, done from FRESH DB data — not a client snapshot.
//
// The bug this replaces: POTab advanced "this vendor's items" to in_production
// by looping an in-memory filter (getCostProd(it.id).printVendor === vendor).
// If that snapshot was stale at send time, an item was silently skipped and its
// pipeline_stage stayed null forever (HPD-2606-012 "Pepper"). These helpers
// re-read items + costing fresh and match vendor membership with the SAME
// resolver the read side uses (poSentToItem), so the write can't miss an item
// and write/read can never disagree.

import { poSentToItem } from "./item-status";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { upsertShipmentForItem } from "./handoff";
import { shipProgress, addQtys, subtractQtys, type SizeQtys } from "./ship-progress";

async function fetchVendorItems(supabase: any, jobId: string, vendor: string): Promise<any[]> {
  const [{ data: job }, { data: items }] = await Promise.all([
    supabase.from("jobs").select("costing_data").eq("id", jobId).single(),
    supabase.from("items")
      .select("id, pipeline_stage, pipeline_timestamps, received_at_hpd, shipping_route, decorator_assignments(id, sent_to_decorator_date, decorators(name, short_code, default_shipping_route))")
      .eq("job_id", jobId),
  ]);
  const costProds = job?.costing_data?.costProds || [];
  return (items || []).filter((it: any) => poSentToItem({
    printVendor: costProds.find((cp: any) => cp.id === it.id)?.printVendor,
    decoratorName: (it.decorator_assignments || [])[0]?.decorators?.name,
    decoratorShortCode: (it.decorator_assignments || [])[0]?.decorators?.short_code,
    poSentVendors: [vendor],
  }));
}

// Sending a PO to `vendor`: for every item that belongs to that vendor,
//   - stamp decorator_assignments.sent_to_decorator_date (first send only —
//     preserves the original date that powers the "NEW" chip on revised POs)
//   - advance pipeline_stage → in_production (unless already shipped)
//   - advance the decorator_assignment → in_production
// Returns the number of vendor items processed.
export async function applyPoSentToVendorItems(supabase: any, jobId: string, vendor: string): Promise<number> {
  const vendorItems = await fetchVendorItems(supabase, jobId, vendor);
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  // Vendor default route is an override for DROP-SHIP jobs only — stage and
  // ship_through already route to HPD, so there's nothing to override there.
  const { data: jobRow } = await supabase.from("jobs").select("shipping_route").eq("id", jobId).single();
  const isDropShipJob = (jobRow?.shipping_route || "ship_through") === "drop_ship";
  for (const it of vendorItems) {
    const da = (it.decorator_assignments || [])[0];
    if (da && !da.sent_to_decorator_date) {
      await supabase.from("decorator_assignments").update({ sent_to_decorator_date: today }).eq("id", da.id);
    }
    if (it.pipeline_stage !== "shipped") {
      if (it.pipeline_stage !== "in_production") {
        await supabase.from("items").update({
          pipeline_stage: "in_production",
          pipeline_timestamps: { ...(it.pipeline_timestamps || {}), in_production: nowIso },
        }).eq("id", it.id);
      }
      if (da) await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", da.id);
    }
    // On a drop-ship job, apply the vendor's default route — but ONLY when the
    // item has no route of its own (null), so a manual override always wins.
    // Lets bulk-to-HPD vendors (One Stop, Sticker Mule) make their items behave
    // like ship-through instead of dropping to the client.
    const vendorDefault = da?.decorators?.default_shipping_route || null;
    if (isDropShipJob && vendorDefault && (it.shipping_route == null || it.shipping_route === "")) {
      await supabase.from("items").update({ shipping_route: vendorDefault }).eq("id", it.id);
    }
  }
  return vendorItems.length;
}

// Un-marking a PO: revert the vendor's items that are still in_production back
// to pre-PO (null stage, assignment blanks_ordered). Items that progressed
// further (shipped from decorator, or received at HPD) are left alone — an undo
// must never pull a shipped item backwards. Returns the number reverted.
export async function revertPoSentFromVendorItems(supabase: any, jobId: string, vendor: string): Promise<number> {
  const vendorItems = await fetchVendorItems(supabase, jobId, vendor);
  let reverted = 0;
  for (const it of vendorItems) {
    if (it.received_at_hpd || it.pipeline_stage === "shipped") continue;
    const da = (it.decorator_assignments || [])[0];
    if (it.pipeline_stage === "in_production") {
      const ts = { ...(it.pipeline_timestamps || {}) };
      delete ts.in_production;
      await supabase.from("items").update({ pipeline_stage: null, pipeline_timestamps: ts }).eq("id", it.id);
    }
    if (da) await supabase.from("decorator_assignments").update({ pipeline_stage: "blanks_ordered" }).eq("id", da.id);
    reverted++;
  }
  return reverted;
}

// Mark a single item shipped FROM THE DECORATOR — the canonical effect, shared by
// the /production board and the job Overview items modal so the two can never
// drift. Sets pipeline_stage=shipped (first-set-wins timestamp), persists
// tracking/notes/qtys, clears any received-at-HPD state, syncs the
// decorator_assignment, logs activity + notifies the team, and on drop_ship logs
// "invoice ready" once every item on the job has shipped. The CALLER owns UI
// concerns (debounce flush, optimistic state, reload) — pass an item carrying the
// latest ship_tracking / ship_qtys / ship_notes.
export async function shipItemFromDecorator(supabase: any, item: any, opts?: { warehouseNotes?: string | null }): Promise<void> {
  const ts = new Date().toISOString();
  const existing = item.pipeline_timestamps || {};
  const timestamps = { ...existing, shipped: existing.shipped || ts };
  const shipQtysToSave = item.ship_qtys && Object.keys(item.ship_qtys).length > 0 ? item.ship_qtys : null;
  const pickup = !!item.pickup_ready;
  await supabase.from("items").update({
    pipeline_stage: "shipped", pipeline_timestamps: timestamps,
    ship_notes: item.ship_notes || null,
    // Local pickup replaces tracking — groups by vendor on Receiving, not by #.
    ship_tracking: pickup ? null : (item.ship_tracking || null),
    pickup_ready: pickup,
    ship_qtys: shipQtysToSave,
    received_at_hpd: false, received_at_hpd_at: null, received_qtys: null,
  }).eq("id", item.id);
  if (item.decorator_assignment_id) {
    await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
  }
  // Handoff spine (migration 117): persist the box as a shipments row + this
  // item as a line. Same group key as the derived grouping, so receiving sees
  // one consistent shipment either way. Never blocks the ship on failure.
  await upsertShipmentForItem(supabase, {
    job_id: item.job_id,
    item_id: item.id,
    item_name: item.name || null,
    decorator_id: item.decorator_id || null,
    decorator_name: item.decorator_name || null,
    pickup_ready: pickup,
    ship_tracking: pickup ? null : (item.ship_tracking || null),
    ship_date: timestamps.shipped,
    ship_qtys: shipQtysToSave,
    expected_arrival: item.expected_arrival || null,
    warehouse_notes: opts?.warehouseNotes || null,
  });
  // Notify Goose/Dante — the route only emails on a vendor's 0→1 pickup
  // transition (one email per cycle, no spam from same-day marks).
  if (pickup && typeof fetch !== "undefined") {
    fetch("/api/email/pickup-ready", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id }) }).catch(() => {});
  }
  const { data: jobRow } = await supabase.from("jobs").select("shipping_route").eq("id", item.job_id).single();
  const route = item.shipping_route || (jobRow as any)?.shipping_route || "ship_through";
  const trk = item.ship_tracking ? ` — tracking: ${item.ship_tracking}` : "";
  // Route-aware activity wording: drop_ship goes direct to the client, so it's
  // a client-safe "shipped" event (surfaces in the portal). ship_through/stage
  // is the inbound vendor→HPD leg — keep it internal ("from decorator", which
  // the portal filter hides) + the warehouse-incoming team ping.
  if (route === "drop_ship") {
    logJobActivity(item.job_id, `${item.name} shipped${trk}`);
  } else {
    logJobActivity(item.job_id, `${item.name} shipped from decorator${trk}`);
    notifyTeam(`Item shipped from decorator — ${item.name} incoming to warehouse`, "production", item.job_id, "job");
  }

  // "All items shipped" fires only when every item has reached its CLIENT
  // delivery state — NOT just pipeline_stage="shipped" (which for a ship_through
  // item is the inbound vendor→HPD leg, not delivery). Only a drop_ship ship
  // can be a final delivery, so this check lives in the drop_ship branch;
  // ship_through completion is checked in forwardItems.
  if (route === "drop_ship") {
    const jr = (jobRow as any)?.shipping_route || "ship_through";
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, shipping_route, forwarded_at, webstore_entered_at").eq("job_id", item.job_id);
    const delivered = (x: any) => {
      const r = x.shipping_route || jr;
      if (r === "ship_through") return !!x.forwarded_at;
      if (r === "stage") return !!x.webstore_entered_at;
      return x.pipeline_stage === "shipped"; // drop_ship
    };
    if ((jobItems || []).length > 0 && (jobItems || []).every(delivered)) {
      logJobActivity(item.job_id, "All items shipped — invoice ready to update with shipped qtys");
    }
  }
}

// Ship ONE WAVE of an item (partial or final). The item is ordered in a fixed
// qty and the vendor ships it over one or more waves; this accumulates the
// cumulative shipped and keeps the item IN PRODUCTION until the waves sum to
// the ordered total. Each wave is its own shipment (its own box + tracking),
// so /receiving shows partial deliveries separately. Received state is left
// untouched — earlier waves keep what they received. Re-reads the item fresh
// so the cumulative math can never double-count a stale local snapshot.
export async function shipItemWave(supabase: any, args: {
  itemId: string;
  waveQtys: SizeQtys;            // per-size shipped in THIS wave
  tracking?: string | null;
  warehouseNotes?: string | null;
}): Promise<{ shipped: number; ordered: number; remaining: number; fullyShipped: boolean }> {
  const tracking = (args.tracking || "").trim() || null;
  const { data: item } = await supabase
    .from("items")
    .select("id, name, job_id, ship_qtys, received_qtys, ship_tracking, pipeline_stage, pipeline_timestamps, expected_arrival, decorator_assignments(id, decorator_id, decorators(name, short_code)), buy_sheet_lines(size, qty_ordered)")
    .eq("id", args.itemId).single();
  if (!item) return { shipped: 0, ordered: 0, remaining: 0, fullyShipped: false };

  const ordered: SizeQtys = Object.fromEntries((item.buy_sheet_lines || []).map((l: any) => [l.size, Number(l.qty_ordered) || 0]));
  const cleanWave: SizeQtys = Object.fromEntries(
    Object.entries(args.waveQtys || {}).map(([s, n]) => [s, Number(n) || 0]).filter(([, n]) => (n as number) > 0)
  );
  const newShip = addQtys(item.ship_qtys, cleanWave);
  const prog = shipProgress(ordered, newShip);
  const waveTotal = Object.values(cleanWave).reduce((a, n) => a + n, 0);
  if (waveTotal === 0) return { shipped: prog.shipped, ordered: prog.ordered, remaining: prog.remaining, fullyShipped: prog.fullyShipped };

  const ts = new Date().toISOString();
  const timestamps = { ...(item.pipeline_timestamps || {}), shipped: (item.pipeline_timestamps || {}).shipped || ts };
  const da = (item.decorator_assignments || [])[0];
  // A new wave means un-received units exist again → pull the item back into
  // the receiving pending list (received_at_hpd off when received < shipped).
  const receivedTotal = Object.values(item.received_qtys || {}).reduce((a: number, n: any) => a + (Number(n) || 0), 0);
  await supabase.from("items").update({
    ship_qtys: newShip,                                   // cumulative across waves
    ship_tracking: tracking || item.ship_tracking || null, // latest wave's tracking
    pipeline_stage: prog.fullyShipped ? "shipped" : "in_production",
    pipeline_timestamps: timestamps,
    received_at_hpd: receivedTotal >= prog.shipped ? true : false,
    // received_qtys intentionally untouched (cumulative received carries over).
  }).eq("id", item.id);
  if (da?.id) {
    await supabase.from("decorator_assignments").update({ pipeline_stage: prog.fullyShipped ? "shipped" : "in_production" }).eq("id", da.id);
  }
  await upsertShipmentForItem(supabase, {
    job_id: item.job_id, item_id: item.id, item_name: item.name || null,
    decorator_id: da?.decorator_id || null,
    decorator_name: da?.decorators?.name || null,
    ship_tracking: tracking,
    ship_date: ts,
    ship_qtys: cleanWave,                                 // this wave only
    expected_arrival: item.expected_arrival || null,
    warehouse_notes: args.warehouseNotes || null,
  });
  const trk = tracking ? ` — ${tracking}` : "";
  logJobActivity(item.job_id, prog.fullyShipped
    ? `${item.name} — final wave shipped (${waveTotal}) · ${prog.shipped}/${prog.ordered} complete${trk}`
    : `${item.name} — partial shipment: ${waveTotal} shipped (${prog.shipped}/${prog.ordered} · ${prog.remaining} remaining)${trk}`);
  notifyTeam(`${prog.fullyShipped ? "Final" : "Partial"} shipment — ${item.name} (${prog.shipped}/${prog.ordered}) incoming to warehouse`, "production", item.job_id, "job");
  return { shipped: prog.shipped, ordered: prog.ordered, remaining: prog.remaining, fullyShipped: prog.fullyShipped };
}

// Undo the LAST wave (per-wave undo). Backs the most recent shipment's qtys out
// of the item's cumulative shipped (and received, if that wave was already
// received), deletes that shipment line + the shipment if empty, and recomputes
// stage/received. Legacy items with no shipment rows fall back to a full revert.
export async function unshipLastWave(supabase: any, itemId: string): Promise<{ undone: boolean; shipped: number; ordered: number }> {
  const { data: item } = await supabase
    .from("items")
    .select("id, name, job_id, ship_qtys, received_qtys, pipeline_stage, pipeline_timestamps, decorator_assignments(id), buy_sheet_lines(size, qty_ordered)")
    .eq("id", itemId).single();
  if (!item) return { undone: false, shipped: 0, ordered: 0 };
  const ordered: SizeQtys = Object.fromEntries((item.buy_sheet_lines || []).map((l: any) => [l.size, Number(l.qty_ordered) || 0]));
  const da = (item.decorator_assignments || [])[0];

  const { data: lines } = await supabase
    .from("shipment_lines")
    .select("id, shipment_id, ship_qtys, received, received_qtys, created_at")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false });

  let newShip: SizeQtys;
  let newReceived: SizeQtys;
  if (!lines || lines.length === 0) {
    // Legacy (no shipment rows) — revert the whole item.
    newShip = {};
    newReceived = {};
  } else {
    const last = lines[0];
    newShip = subtractQtys(item.ship_qtys, last.ship_qtys || {});
    newReceived = last.received
      ? subtractQtys(item.received_qtys, (last.received_qtys && Object.keys(last.received_qtys).length ? last.received_qtys : last.ship_qtys) || {})
      : (item.received_qtys || {});
    // Delete the line; delete the shipment if it has no more lines.
    await supabase.from("shipment_lines").delete().eq("id", last.id);
    const { count } = await supabase.from("shipment_lines").select("id", { count: "exact", head: true }).eq("shipment_id", last.shipment_id);
    if ((count ?? 0) === 0) await supabase.from("shipments").delete().eq("id", last.shipment_id);
  }

  const prog = shipProgress(ordered, newShip);
  const receivedTotal = Object.values(newReceived).reduce((a: number, n: any) => a + (Number(n) || 0), 0);
  const anyShipped = prog.shipped > 0;
  const ts = { ...(item.pipeline_timestamps || {}) };
  if (!anyShipped) delete ts.shipped;
  const stage = prog.fullyShipped ? "shipped" : anyShipped ? "in_production" : (item.pipeline_stage === "shipped" ? "in_production" : item.pipeline_stage || "in_production");
  await supabase.from("items").update({
    ship_qtys: Object.keys(newShip).length ? newShip : null,
    received_qtys: Object.keys(newReceived).length ? newReceived : null,
    pipeline_stage: stage,
    pipeline_timestamps: ts,
    received_at_hpd: anyShipped ? (receivedTotal >= prog.shipped) : false,
    received_at_hpd_at: null,
  }).eq("id", itemId);
  if (da?.id) await supabase.from("decorator_assignments").update({ pipeline_stage: prog.fullyShipped ? "shipped" : "in_production" }).eq("id", da.id);
  logJobActivity(item.job_id, `${item.name} — last shipment undone (now ${prog.shipped}/${prog.ordered} shipped)`);
  return { undone: true, shipped: prog.shipped, ordered: prog.ordered };
}

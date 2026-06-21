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
    // Apply the vendor's default shipping route — but ONLY when the item has no
    // route of its own yet (null). A manual per-item override is non-null, so
    // this never clobbers it. Lets bulk-to-HPD vendors (One Stop, Sticker Mule)
    // make their items behave like ship-through on a drop-ship job.
    const vendorDefault = da?.decorators?.default_shipping_route || null;
    if (vendorDefault && (it.shipping_route == null || it.shipping_route === "")) {
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
export async function shipItemFromDecorator(supabase: any, item: any): Promise<void> {
  const ts = new Date().toISOString();
  const existing = item.pipeline_timestamps || {};
  const timestamps = { ...existing, shipped: existing.shipped || ts };
  const shipQtysToSave = item.ship_qtys && Object.keys(item.ship_qtys).length > 0 ? item.ship_qtys : null;
  await supabase.from("items").update({
    pipeline_stage: "shipped", pipeline_timestamps: timestamps,
    ship_notes: item.ship_notes || null, ship_tracking: item.ship_tracking || null,
    ship_qtys: shipQtysToSave,
    received_at_hpd: false, received_at_hpd_at: null, received_qtys: null,
  }).eq("id", item.id);
  if (item.decorator_assignment_id) {
    await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
  }
  logJobActivity(item.job_id, `${item.name} shipped from decorator${item.ship_tracking ? ` — tracking: ${item.ship_tracking}` : ""}`);
  notifyTeam(`Item shipped from decorator — ${item.name} incoming to warehouse`, "production", item.job_id, "job");

  // drop_ship: once the whole job has shipped, log invoice-ready (matches board).
  const { data: jobRow } = await supabase.from("jobs").select("shipping_route").eq("id", item.job_id).single();
  const route = item.shipping_route || (jobRow as any)?.shipping_route || "ship_through";
  if (route === "drop_ship") {
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage").eq("job_id", item.job_id);
    const allShipped = (jobItems || []).every((x: any) => x.id === item.id ? true : x.pipeline_stage === "shipped");
    if (allShipped) logJobActivity(item.job_id, "All items shipped — invoice ready to update with shipped qtys");
  }
}

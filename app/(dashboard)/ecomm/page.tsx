import { createClient } from "@/lib/supabase/server";
import { loadStagingBoard } from "@/lib/item-state";
import { releaseNumbersDone, lineupIsPipelineOnly, closedReleaseMove } from "@/lib/release-lanes";
import { daysUntilDay } from "@/lib/dates";
import TheShopView, { type ReleaseRow, type StagingJobRow, type WireRow } from "./View";

export const dynamic = "force-dynamic";

// THE SHOP — the front office's front door (Sep 14 2026). Same idea as The
// Distro: a summary of the department that tells the team whose move it is.
// The old /ecomm pre-order list (fulfillment_projects) is retired — Releases
// (/drops) is the drop pipeline, Shop Staging (/ecomm/staging) is the Shopify
// entry queue, CS Desk (/ecomm/cs) is the storefront support desk. This page
// reads all three and links out; the deep surfaces own the actions.

export default async function TheShopPage() {
  const sb = await createClient();

  const [staging, releasesRaw, act] = await Promise.all([
    loadStagingBoard(sb),
    sb.from("releases")
      .select("id, title, status, target_live_date, window_close_date, clients(name), release_slots(id, line_id, item_id, qtys, sold_qtys, items!release_slots_item_id_fkey(id, name, received_qtys, buy_sheet_lines(size, qty_ordered)))")
      .in("status", ["building", "ready", "live", "closed"])
      .order("target_live_date", { ascending: true, nullsFirst: false })
      .then((r: any) => (r.data || []) as any[]),
    sb.from("job_activity")
      .select("message, created_at, jobs(job_number, clients(name))")
      .order("created_at", { ascending: false }).limit(80)
      .then((r: any) => (r.data || []) as any[]),
  ]);

  // Shopify entry queue, rolled up per job — one plate per job, like the
  // Distro's fulfillment plates.
  const byJob = new Map<string, StagingJobRow>();
  for (const it of staging) {
    if (it.availableTotal <= 0) continue;
    const row = byJob.get(it.jobId) || { jobId: it.jobId, jobNumber: it.jobNumber, client: it.client, items: 0, units: 0, names: [] as string[] };
    row.items += 1; row.units += it.availableTotal; row.names.push(it.name);
    byJob.set(it.jobId, row);
  }
  const stagingJobs = Array.from(byJob.values()).sort((a, b) => b.units - a.units);

  // buys per slot → slot._buys (the ledger's runs), same as /drops and The House
  const slotIds = releasesRaw.flatMap(r => (r.release_slots || []).map((s: any) => s.id));
  const bySlot: Record<string, any[]> = {};
  if (slotIds.length) {
    const { data: buys } = await sb.from("items").select("id, name, release_slot_id, received_qtys, buy_sheet_lines(size, qty_ordered)").in("release_slot_id", slotIds);
    for (const b of (buys || []) as any[]) (bySlot[b.release_slot_id] ||= []).push(b);
  }
  // Releases with "whose move" derived the same way /drops buckets them.
  const releases: ReleaseRow[] = releasesRaw.map(r => {
    const slots = ((r.release_slots || []) as any[]).map((s: any) => ({ ...s, _buys: bySlot[s.id] || [] }));
    const dClose = daysUntilDay(r.window_close_date);
    let move: ReleaseRow["move"] = null;
    if (r.status === "ready") move = lineupIsPipelineOnly(slots) ? "ready_launch" : "ready_cost";
    else if (r.status === "live" && dClose != null && dClose <= 0) move = "window_ended";
    else if (r.status === "closed") {
      const m = closedReleaseMove(slots).move;
      move = m === "waiting_vendor" ? null : m === "cut" ? "closed" : m;
    }
    return {
      id: r.id, title: r.title, client: r.clients?.name || null, status: r.status,
      liveDate: r.target_live_date || null, closeDate: r.window_close_date || null,
      lines: slots.length, numbersDone: releaseNumbersDone(slots), move,
    };
  });

  const wire: WireRow[] = act
    .filter(a => /shopify|webstore|release|drop|launch|\bcut\b/i.test(a.message))
    .slice(0, 12)
    .map(a => ({ message: a.message, at: a.created_at, client: a.jobs?.clients?.name || "", jobNumber: a.jobs?.job_number || "" }));

  return <TheShopView stagingJobs={stagingJobs} releases={releases} wire={wire} />;
}

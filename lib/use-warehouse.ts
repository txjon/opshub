"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { sortSizes } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { calculatePhase } from "@/lib/lifecycle";

export const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

export const FULFILLMENT_STAGES = [
  { id: "staged", label: "Staged", color: "#f5a623" },
  { id: "packing", label: "Packing", color: "#a78bfa" },
  { id: "shipped", label: "Shipped", color: "#34c97a" },
];

export type WarehouseItem = {
  id: string;
  name: string;
  letter: string;
  blank_vendor: string | null;
  blank_sku: string | null;
  job_id: string;
  pipeline_stage: string | null;
  ship_tracking: string | null;
  // First-set-wins timestamp for when the item left the decorator.
  // Used as fallback grouping key for shipments without tracking.
  ship_date: string | null;
  // Per-item route override (migration 076). Null = use job default.
  shipping_route: string | null;
  received_at_hpd: boolean;
  received_at_hpd_at: string | null;
  // Stage-route Shopify handoff. Null = received-at-HPD but not yet
  // keyed into Shopify (still OpsHub's problem). Set = handed off to
  // Shopify/ShipStation (OpsHub considers it done for stage jobs).
  webstore_entered_at: string | null;
  sizes: string[];
  qtys: Record<string, number>;
  ship_qtys: Record<string, number>;
  received_qtys: Record<string, number>;
  sample_qtys: Record<string, number>;
  ship_notes: string;
  decorator_id: string | null;
  decorator_assignment_id: string | null;
  decorator_name: string | null;
  decorator_short_code: string | null;
  receiving_data?: { condition?: string; notes?: string; received_by?: string | null; received_by_email?: string | null; received_at?: string } | null;
};

export type WarehouseJob = {
  id: string;
  title: string;
  job_number: string;
  display_number: string;
  qb_invoice_number: string | null;
  shipping_route: string;
  fulfillment_status: string | null;
  fulfillment_tracking: string | null;
  client_name: string;
  ship_to_address: string;
  ship_method: string;
  packing_notes: string;
  shipping_notes: string;
  contact_name: string;
  contact_phone: string;
  items: WarehouseItem[];
};

export function useWarehouse() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<WarehouseJob[]>([]);
  const saveTimers = useRef<Record<string, any>>({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    // Drop the job-level shipping_route filter — we filter at the
    // item level below instead. This lets mixed-route jobs through:
    // a "drop_ship" job that has one item overridden to "ship_through"
    // will surface that item in receiving (it IS coming to HPD), and a
    // "ship_through" job with one drop_ship-overridden item will hide
    // that single item (it ISN'T). The per-item shipping_route column
    // (migration 076) is authoritative when set; NULL falls back to
    // job.shipping_route.
    //
    // Two queries:
    //   1. Active jobs — anything not complete/cancelled
    //   2. Recently Shopify-entered stage jobs — phase=complete but
    //      within a 48h window so the warehouse can still see "this is
    //      live in Shopify, shelve it" on /receiving. Drops out of the
    //      result set after 48h naturally.
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const [activeRes, recentEnteredRes] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, title, job_number, shipping_route, fulfillment_status, fulfillment_tracking, phase, type_meta, clients(name, shipping_address)")
        .not("phase", "in", '("complete","cancelled")')
        .order("created_at", { ascending: false }),
      supabase
        .from("jobs")
        .select("id, title, job_number, shipping_route, fulfillment_status, fulfillment_tracking, phase, type_meta, clients(name, shipping_address)")
        .eq("shipping_route", "stage")
        .eq("phase", "complete")
        .gte("updated_at", fortyEightHoursAgo)
        .order("updated_at", { ascending: false }),
    ]);
    const dbJobs = [...(activeRes.data || []), ...(recentEnteredRes.data || [])];

    if (!dbJobs.length) { setJobs([]); setLoading(false); return; }

    const jobIds = dbJobs.map(j => j.id);
    const [itemsRes, contactsRes] = await Promise.all([
      supabase.from("items").select("*, buy_sheet_lines(size, qty_ordered)").in("job_id", jobIds).order("sort_order"),
      supabase.from("job_contacts").select("job_id, role_on_job, contacts(name, phone, email)").in("job_id", jobIds),
    ]);
    const allItems = itemsRes.data;
    const allContacts = contactsRes.data || [];
    const assignmentMap: Record<string, string> = {};
    const decoratorMap: Record<string, { id: string | null; name: string; short_code: string | null }> = {};
    if (allItems?.length) {
      const itemIds = allItems.map((it: any) => it.id);
      const { data: assignments } = await supabase.from("decorator_assignments")
        .select("id, item_id, decorator_id, decorators(name, short_code)")
        .in("item_id", itemIds);
      for (const a of (assignments || []) as any[]) {
        assignmentMap[a.item_id] = a.id;
        if (a.decorators?.name || a.decorator_id) {
          decoratorMap[a.item_id] = {
            id: a.decorator_id || null,
            name: a.decorators?.name || "Unassigned",
            short_code: a.decorators?.short_code || null,
          };
        }
      }
    }

    const mapped: WarehouseJob[] = [];
    for (const j of dbJobs) {
      const jobItems = (allItems || []).filter((it: any) => it.job_id === j.id);
      // Resolve per-item shipping_route with fallback to the job's.
      // Items whose effective route is drop_ship NEVER come to HPD,
      // so we drop them here regardless of pipeline state.
      const jobRoute = j.shipping_route || "ship_through";
      const relevant = jobItems.filter((it: any) => {
        const effectiveRoute = it.shipping_route || jobRoute;
        if (effectiveRoute === "drop_ship") return false;
        return it.pipeline_stage === "shipped" || it.received_at_hpd;
      });
      if (relevant.length === 0) continue;

      const typeMeta = (j as any).type_meta || {};
      const primaryContact = allContacts.find((c: any) => c.job_id === j.id && c.role_on_job === "primary");
      const contactData = (primaryContact as any)?.contacts || {};
      const packingNotes = relevant.map((it: any) => it.packing_notes).filter(Boolean).join(" · ");

      mapped.push({
        id: j.id,
        title: j.title,
        job_number: j.job_number,
        display_number: typeMeta.qb_invoice_number || j.job_number,
        qb_invoice_number: typeMeta.qb_invoice_number || null,
        shipping_route: j.shipping_route || "ship_through",
        fulfillment_status: j.fulfillment_status,
        fulfillment_tracking: j.fulfillment_tracking,
        client_name: (j as any).clients?.name || "",
        ship_to_address: typeMeta.venue_address || (j as any).clients?.shipping_address || "",
        ship_method: Object.values(typeMeta.po_ship_methods || {})[0] as string || "",
        packing_notes: packingNotes,
        shipping_notes: typeMeta.shipping_notes || "",
        contact_name: contactData.name || "",
        contact_phone: contactData.phone || contactData.email || "",
        items: relevant.map((it: any) => {
          const lines = it.buy_sheet_lines || [];
          const ts = (it.pipeline_timestamps || {}) as Record<string, string>;
          return {
            id: it.id, name: it.name, letter: String.fromCharCode(65 + (it.sort_order ?? 0)), blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
            job_id: it.job_id, pipeline_stage: it.pipeline_stage, ship_tracking: it.ship_tracking, ship_notes: it.ship_notes || "",
            ship_date: ts.shipped || null,
            shipping_route: it.shipping_route || null,
            received_at_hpd: it.received_at_hpd || false, received_at_hpd_at: it.received_at_hpd_at,
            webstore_entered_at: it.webstore_entered_at || null,
            sizes: sortSizes(lines.map((l: any) => l.size)),
            qtys: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered])),
            ship_qtys: it.ship_qtys || {},
            received_qtys: it.received_qtys || {},
            sample_qtys: it.sample_qtys || {},
            decorator_id: decoratorMap[it.id]?.id || null,
            decorator_assignment_id: assignmentMap[it.id] || null,
            decorator_name: decoratorMap[it.id]?.name || null,
            decorator_short_code: decoratorMap[it.id]?.short_code || null,
            receiving_data: it.receiving_data || null,
          };
        }),
      });
    }
    setJobs(mapped);
    setLoading(false);
  }

  async function recalcJobPhase(jobId: string) {
    const { data: jobData } = await supabase.from("jobs").select("*, clients(name)").eq("id", jobId).single();
    if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return;
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type, shipping_route, webstore_entered_at").eq("job_id", jobId);
    const { data: payments } = await supabase.from("payment_records").select("amount, status").eq("job_id", jobId);
    const { data: proofFiles } = await supabase.from("item_files").select("item_id, approval").eq("stage", "proof").is("superseded_at", null).in("item_id", (jobItems || []).map(it => it.id));
    const proofStatus: Record<string, { allApproved: boolean }> = {};
    for (const it of (jobItems || [])) {
      const manualApproved = it.artwork_status === "approved";
      const proofs = (proofFiles || []).filter(f => f.item_id === it.id);
      proofStatus[it.id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every(f => f.approval === "approved")) };
    }
    const result = calculatePhase({
      job: { job_type: jobData.job_type, shipping_route: jobData.shipping_route || "ship_through", payment_terms: jobData.payment_terms, quote_approved: jobData.quote_approved || false, phase: jobData.phase, fulfillment_status: jobData.fulfillment_status || null },
      items: (jobItems || []).map(it => ({ id: it.id, pipeline_stage: it.pipeline_stage, blanks_order_number: it.blanks_order_number, blanks_order_cost: (it as any).blanks_order_cost ?? null, ship_tracking: it.ship_tracking, received_at_hpd: it.received_at_hpd || false, artwork_status: it.artwork_status, garment_type: it.garment_type, shipping_route: (it as any).shipping_route || null, webstore_entered_at: (it as any).webstore_entered_at || null })),
      payments: (payments || []).map(p => ({ amount: p.amount, status: p.status })),
      proofStatus,
      poSentVendors: jobData.type_meta?.po_sent_vendors || [],
      costingVendors: [...new Set((jobData.costing_data?.costProds || []).map((cp: any) => cp.printVendor).filter(Boolean))],
    });
    if (result.phase !== jobData.phase) {
      const timestamps = jobData.phase_timestamps || {};
      timestamps[result.phase] = new Date().toISOString();
      await supabase.from("jobs").update({ phase: result.phase, phase_timestamps: timestamps }).eq("id", jobId);
    }
  }

  async function updateReceivedQty(item: WarehouseItem, size: string, qty: number) {
    const updated = { ...(item.received_qtys || {}), [size]: qty };
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_qtys: updated } : it),
    })));
    const key = `rx_${item.id}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      await supabase.from("items").update({ received_qtys: updated }).eq("id", item.id);
    }, 800);
  }

  async function updateSampleQty(item: WarehouseItem, size: string, qty: number) {
    const updated = { ...(item.sample_qtys || {}), [size]: qty };
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, sample_qtys: updated } : it),
    })));
    const key = `sx_${item.id}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      await supabase.from("items").update({ sample_qtys: updated }).eq("id", item.id);
    }, 800);
  }

  async function markReceived(item: WarehouseItem, opts?: { condition?: string; notes?: string; skipSideEffects?: boolean; skipClientEmail?: boolean }) {
    const now = new Date().toISOString();

    // Flush any in-flight qty debounces — receive must commit the latest
    // edits in the same write so downstream readers + activity log see the
    // final state, not a stale snapshot from before the 800ms timer fired.
    for (const k of [`rx_${item.id}`, `sx_${item.id}`]) {
      if (saveTimers.current[k]) {
        clearTimeout(saveTimers.current[k]);
        delete saveTimers.current[k];
      }
    }

    // Capture audit trail in receiving_data JSONB:
    //   received_by (user), received_at (timestamp), condition, notes.
    const { data: { user } } = await supabase.auth.getUser();
    const receivingData = {
      condition: opts?.condition || "good",
      notes: opts?.notes || "",
      received_by: user?.id || null,
      received_by_email: user?.email || null,
      received_at: now,
    };

    // Bundle pending qty edits with the receive flag so a single update
    // lands. Empty objects are skipped — downstream readers fall back to
    // ship_qtys when received_qtys is missing.
    const updates: any = {
      received_at_hpd: true,
      received_at_hpd_at: now,
      receiving_data: receivingData,
    };
    if (item.received_qtys && Object.keys(item.received_qtys).length > 0) {
      updates.received_qtys = item.received_qtys;
    }
    if (item.sample_qtys && Object.keys(item.sample_qtys).length > 0) {
      updates.sample_qtys = item.sample_qtys;
    }
    await supabase.from("items").update(updates).eq("id", item.id);

    // Activity log — capture per-size totals for the audit trail.
    // "Atomic Tee received at warehouse — 76/76 delivered, 2 samples pulled
    //  (74 continuing) (damaged) — minor scuffing on neckline"
    const sumPerSize = (q: Record<string, number> | null | undefined) =>
      Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    const sizes = Object.keys(item.qtys || {});
    const rq = item.received_qtys || {};
    const sq = item.ship_qtys || {};
    const oq = item.qtys || {};
    const shippedTotal = sumPerSize(item.ship_qtys) || sumPerSize(item.qtys);
    let deliveredTotal = 0;
    for (const sz of sizes) deliveredTotal += rq[sz] ?? sq[sz] ?? oq[sz] ?? 0;
    const samplesTotal = sumPerSize(item.sample_qtys);
    const continuingTotal = Math.max(0, deliveredTotal - samplesTotal);
    const variance = deliveredTotal - shippedTotal;

    const parts: string[] = [`${deliveredTotal}/${shippedTotal} delivered`];
    if (samplesTotal > 0) {
      parts.push(`${samplesTotal} sample${samplesTotal === 1 ? "" : "s"} pulled (${continuingTotal} continuing)`);
    }
    if (variance !== 0) {
      parts.push(`variance ${variance > 0 ? "+" : ""}${variance}`);
    }
    const conditionTag = opts?.condition && opts.condition !== "good" ? ` (${opts.condition})` : "";
    const notesTag = opts?.notes ? ` — ${opts.notes}` : "";
    logJobActivity(item.job_id, `${item.name} received at warehouse${conditionTag} — ${parts.join(", ")}${notesTag}`);

    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: true, received_at_hpd_at: now, receiving_data: receivingData as any } : it),
    })));

    // Side effects (production_complete email + phase recalc) intentionally
    // live in `markReceivedSideEffects` so bulkMarkReceived can fire them
    // ONCE after the loop instead of N times with stale closure state.
    // When a single item is received via this path we fan out the same way.
    if (!opts?.skipSideEffects) {
      await markReceivedSideEffects([item.job_id], { skipClientEmail: opts?.skipClientEmail });
    }
  }

  // Bulk-receive wrapper. Use this whenever multiple items in a shipment
  // are received together — it skips the per-item side effects in the
  // loop, then queries the DB once per affected job for the
  // "all received → production_complete email" decision and recalcs
  // each job's phase exactly once.
  //
  // opts can be:
  //  - a fixed object (same condition/notes applied to every item)
  //  - a resolver function (called per item — used by /receiving where
  //    each row carries its own per-item condition + notes inputs)
  async function bulkMarkReceived(
    items: WarehouseItem[],
    opts?:
      | { condition?: string; notes?: string }
      | ((it: WarehouseItem) => { condition?: string; notes?: string }),
    sideEffectOpts?: { skipClientEmail?: boolean },
  ) {
    const resolveOpts = (it: WarehouseItem) =>
      typeof opts === "function" ? opts(it) : (opts || {});
    for (const it of items) {
      await markReceived(it, { ...resolveOpts(it), skipSideEffects: true });
    }
    const affectedJobIds = Array.from(new Set(items.map(it => it.job_id)));
    await markReceivedSideEffects(affectedJobIds, sideEffectOpts);
  }

  // Shared side-effect path: re-queries each job's items from the DB
  // (avoids closure-stale React state) and decides whether to fire
  // the production_complete email. Always recalcs phase. Safe to call
  // with one job or many.
  async function markReceivedSideEffects(jobIds: string[], opts?: { skipClientEmail?: boolean }) {
    for (const jobId of jobIds) {
      // Need shipping_route info to mirror the email route's mixed-
      // route logic: drop_ship items (per-item or job-level) never come
      // back to HPD, so they don't gate the production_complete email.
      const [{ data: jobItems }, { data: jobRow }] = await Promise.all([
        supabase.from("items").select("received_at_hpd, shipping_route").eq("job_id", jobId),
        supabase.from("jobs").select("shipping_route").eq("id", jobId).single(),
      ]);
      const jobRoute = (jobRow as any)?.shipping_route || "ship_through";
      const toHpdItems = (jobItems || []).filter((it: any) => (it.shipping_route || jobRoute) !== "drop_ship");
      const allReceived = toHpdItems.length > 0 && toHpdItems.every((it: any) => it.received_at_hpd);
      // Silent mode (skipClientEmail) suppresses the client-facing
      // production_complete email. Used for backfilling historical
      // receives where we don't want to spam clients about boxes that
      // arrived weeks ago. Activity log + phase recalc still fire so
      // OpsHub's internal state stays consistent.
      if (allReceived && !opts?.skipClientEmail) {
        fetch("/api/email/notify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, type: "production_complete" }),
        }).catch(() => {});
      }
      // Phase recalc — fresh DB read inside recalcJobPhase. Slight
      // delay so the receive writes finish settling first.
      setTimeout(() => recalcJobPhase(jobId), 300);
    }
  }

  // Stage-route Shopify handoff. Bulk operation by design — the team
  // typically enters a whole shipment's worth of items into Shopify in
  // one sitting. Records who keyed it in (webstore_entered_by) for the
  // audit trail. Recalcs phase once per affected job: a stage job with
  // all items received + webstore-entered moves to "complete."
  // No email side-effect — this is an internal handoff, ShipStation
  // handles client-facing comms downstream.
  async function bulkMarkWebstoreEntered(items: WarehouseItem[]) {
    if (items.length === 0) return;
    const now = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || null;
    await Promise.all(items.map(it =>
      supabase.from("items").update({
        webstore_entered_at: now,
        webstore_entered_by: userId,
      }).eq("id", it.id)
    ));
    setJobs(prev => prev.map(j => ({
      ...j,
      items: j.items.map(it => {
        const hit = items.find(x => x.id === it.id);
        return hit ? { ...it, webstore_entered_at: now } : it;
      }),
    })));
    // Per-job activity log + phase recalc.
    const byJob = new Map<string, WarehouseItem[]>();
    for (const it of items) {
      if (!byJob.has(it.job_id)) byJob.set(it.job_id, []);
      byJob.get(it.job_id)!.push(it);
    }
    for (const [jobId, jobItems] of Array.from(byJob.entries())) {
      const names = jobItems.map(it => it.name).join(", ");
      logJobActivity(jobId, `${jobItems.length} item${jobItems.length === 1 ? "" : "s"} entered into Shopify (${names})`);
      setTimeout(() => recalcJobPhase(jobId), 300);
    }
  }

  async function undoWebstoreEntered(item: WarehouseItem) {
    await supabase.from("items").update({
      webstore_entered_at: null,
      webstore_entered_by: null,
    }).eq("id", item.id);
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, webstore_entered_at: null } : it),
    })));
    logJobActivity(item.job_id, `${item.name} — Shopify entry undone`);
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function undoReceived(item: WarehouseItem) {
    await supabase.from("items").update({ received_at_hpd: false, received_at_hpd_at: null }).eq("id", item.id);
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: false, received_at_hpd_at: null } : it),
    })));
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function returnToProduction(item: WarehouseItem) {
    await supabase.from("items").update({
      pipeline_stage: "in_production",
      received_at_hpd: false,
      received_at_hpd_at: null,
      received_qtys: null,
    }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", item.decorator_assignment_id);
    }
    logJobActivity(item.job_id, `${item.name} returned to production from receiving`);
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, pipeline_stage: "in_production", received_at_hpd: false, received_at_hpd_at: null, received_qtys: null } : it),
    })));
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function updateFulfillment(jobId: string, status: string | null, tracking?: string) {
    const updates: any = { fulfillment_status: status };
    if (tracking !== undefined) updates.fulfillment_tracking = tracking;
    await supabase.from("jobs").update(updates).eq("id", jobId);
    if (status === "shipped") {
      logJobActivity(jobId, "Fulfillment complete — order shipped to client");
      notifyTeam("Order shipped to client", "production", jobId, "job");
    }
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, fulfillment_status: status, ...(tracking !== undefined ? { fulfillment_tracking: tracking } : {}) } : j));
    setTimeout(() => recalcJobPhase(jobId), 300);
  }

  function debounceFulfillmentTracking(jobId: string, tracking: string) {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, fulfillment_tracking: tracking } : j));
    if (saveTimers.current[jobId]) clearTimeout(saveTimers.current[jobId]);
    saveTimers.current[jobId] = setTimeout(() => {
      supabase.from("jobs").update({ fulfillment_tracking: tracking }).eq("id", jobId);
    }, 800);
  }

  // Split into sections
  const incoming = jobs.filter(j => j.items.some(it => !it.received_at_hpd));
  const shipThrough = jobs.filter(j => j.shipping_route === "ship_through" && j.items.every(it => it.received_at_hpd));
  const fulfillment = jobs.filter(j => j.shipping_route === "stage" && j.items.every(it => it.received_at_hpd));

  return {
    loading, jobs, setJobs, incoming, shipThrough, fulfillment,
    updateReceivedQty, updateSampleQty, markReceived, bulkMarkReceived, undoReceived, returnToProduction,
    bulkMarkWebstoreEntered, undoWebstoreEntered,
    updateFulfillment, debounceFulfillmentTracking,
    supabase, logJobActivity,
  };
}

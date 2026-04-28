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
  received_at_hpd: boolean;
  received_at_hpd_at: string | null;
  sizes: string[];
  qtys: Record<string, number>;
  ship_qtys: Record<string, number>;
  received_qtys: Record<string, number>;
  sample_qtys: Record<string, number>;
  ship_notes: string;
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
    const { data: dbJobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, shipping_route, fulfillment_status, fulfillment_tracking, phase, type_meta, clients(name, shipping_address)")
      .not("phase", "in", '("complete","cancelled")')
      .not("shipping_route", "eq", "drop_ship")
      .order("created_at", { ascending: false });

    if (!dbJobs?.length) { setJobs([]); setLoading(false); return; }

    const jobIds = dbJobs.map(j => j.id);
    const [itemsRes, contactsRes] = await Promise.all([
      supabase.from("items").select("*, buy_sheet_lines(size, qty_ordered)").in("job_id", jobIds).order("sort_order"),
      supabase.from("job_contacts").select("job_id, role_on_job, contacts(name, phone, email)").in("job_id", jobIds),
    ]);
    const allItems = itemsRes.data;
    const allContacts = contactsRes.data || [];
    const assignmentMap: Record<string, string> = {};
    const decoratorMap: Record<string, { name: string; short_code: string | null }> = {};
    if (allItems?.length) {
      const itemIds = allItems.map((it: any) => it.id);
      const { data: assignments } = await supabase.from("decorator_assignments")
        .select("id, item_id, decorators(name, short_code)")
        .in("item_id", itemIds);
      for (const a of (assignments || []) as any[]) {
        assignmentMap[a.item_id] = a.id;
        if (a.decorators?.name) {
          decoratorMap[a.item_id] = { name: a.decorators.name, short_code: a.decorators.short_code || null };
        }
      }
    }

    const mapped: WarehouseJob[] = [];
    for (const j of dbJobs) {
      const jobItems = (allItems || []).filter((it: any) => it.job_id === j.id);
      const relevant = jobItems.filter((it: any) =>
        it.pipeline_stage === "shipped" || it.received_at_hpd
      );
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
          return {
            id: it.id, name: it.name, letter: String.fromCharCode(65 + (it.sort_order ?? 0)), blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
            job_id: it.job_id, pipeline_stage: it.pipeline_stage, ship_tracking: it.ship_tracking, ship_notes: it.ship_notes || "",
            received_at_hpd: it.received_at_hpd || false, received_at_hpd_at: it.received_at_hpd_at,
            sizes: sortSizes(lines.map((l: any) => l.size)),
            qtys: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered])),
            ship_qtys: it.ship_qtys || {},
            received_qtys: it.received_qtys || {},
            sample_qtys: it.sample_qtys || {},
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
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type").eq("job_id", jobId);
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
      items: (jobItems || []).map(it => ({ id: it.id, pipeline_stage: it.pipeline_stage, blanks_order_number: it.blanks_order_number, blanks_order_cost: (it as any).blanks_order_cost ?? null, ship_tracking: it.ship_tracking, received_at_hpd: it.received_at_hpd || false, artwork_status: it.artwork_status, garment_type: it.garment_type })),
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

  async function markReceived(item: WarehouseItem, opts?: { condition?: string; notes?: string }) {
    const now = new Date().toISOString();

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

    await supabase.from("items").update({
      received_at_hpd: true,
      received_at_hpd_at: now,
      receiving_data: receivingData,
    }).eq("id", item.id);

    const conditionTag = opts?.condition && opts.condition !== "good" ? ` (${opts.condition})` : "";
    logJobActivity(item.job_id, `${item.name} received at warehouse${conditionTag}${opts?.notes ? ` — ${opts.notes}` : ""}`);

    // Check if this completes the job BEFORE updating state — so the side effect
    // isn't inside the state updater (React may call updaters twice in dev/concurrent).
    const currentJob = jobs.find(j => j.items.some(it => it.id === item.id));
    const willAllBeReceived = !!currentJob && currentJob.items.every(it => it.id === item.id ? true : it.received_at_hpd);

    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: true, received_at_hpd_at: now, receiving_data: receivingData as any } : it),
    })));

    if (willAllBeReceived) {
      fetch("/api/email/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: item.job_id, type: "production_complete" }),
      }).catch(() => {});
    }

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
    updateReceivedQty, updateSampleQty, markReceived, undoReceived, returnToProduction,
    updateFulfillment, debounceFulfillmentTracking,
    supabase, logJobActivity,
  };
}

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
};

export type WarehouseJob = {
  id: string;
  title: string;
  job_number: string;
  shipping_route: string;
  fulfillment_status: string | null;
  fulfillment_tracking: string | null;
  client_name: string;
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
      .select("id, title, job_number, shipping_route, fulfillment_status, fulfillment_tracking, phase, clients(name)")
      .not("phase", "in", '("complete","cancelled")')
      .not("shipping_route", "eq", "drop_ship")
      .order("created_at", { ascending: false });

    if (!dbJobs?.length) { setJobs([]); setLoading(false); return; }

    const jobIds = dbJobs.map(j => j.id);
    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered)")
      .in("job_id", jobIds)
      .order("sort_order");

    const mapped: WarehouseJob[] = [];
    for (const j of dbJobs) {
      const jobItems = (allItems || []).filter((it: any) => it.job_id === j.id);
      const relevant = jobItems.filter((it: any) =>
        it.pipeline_stage === "shipped" || it.received_at_hpd
      );
      if (relevant.length === 0) continue;

      mapped.push({
        id: j.id,
        title: j.title,
        job_number: j.job_number,
        shipping_route: j.shipping_route || "ship_through",
        fulfillment_status: j.fulfillment_status,
        fulfillment_tracking: j.fulfillment_tracking,
        client_name: (j as any).clients?.name || "",
        items: relevant.map((it: any) => {
          const lines = it.buy_sheet_lines || [];
          return {
            id: it.id, name: it.name, blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
            job_id: it.job_id, pipeline_stage: it.pipeline_stage, ship_tracking: it.ship_tracking,
            received_at_hpd: it.received_at_hpd || false, received_at_hpd_at: it.received_at_hpd_at,
            sizes: sortSizes(lines.map((l: any) => l.size)),
            qtys: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered])),
            ship_qtys: it.ship_qtys || {},
            received_qtys: it.received_qtys || {},
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
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, blanks_order_number, ship_tracking, received_at_hpd, artwork_status, garment_type").eq("job_id", jobId);
    const { data: payments } = await supabase.from("payment_records").select("amount, status").eq("job_id", jobId);
    const { data: proofFiles } = await supabase.from("item_files").select("item_id, approval").eq("stage", "proof").in("item_id", (jobItems || []).map(it => it.id));
    const proofStatus: Record<string, { allApproved: boolean }> = {};
    for (const it of (jobItems || [])) {
      const manualApproved = it.artwork_status === "approved";
      const proofs = (proofFiles || []).filter(f => f.item_id === it.id);
      proofStatus[it.id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every(f => f.approval === "approved")) };
    }
    const result = calculatePhase({
      job: { job_type: jobData.job_type, shipping_route: jobData.shipping_route || "ship_through", payment_terms: jobData.payment_terms, quote_approved: jobData.quote_approved || false, phase: jobData.phase, fulfillment_status: jobData.fulfillment_status || null },
      items: (jobItems || []).map(it => ({ id: it.id, pipeline_stage: it.pipeline_stage, blanks_order_number: it.blanks_order_number, ship_tracking: it.ship_tracking, received_at_hpd: it.received_at_hpd || false, artwork_status: it.artwork_status, garment_type: it.garment_type })),
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

  async function markReceived(item: WarehouseItem) {
    const now = new Date().toISOString();
    await supabase.from("items").update({ received_at_hpd: true, received_at_hpd_at: now }).eq("id", item.id);
    logJobActivity(item.job_id, `${item.name} received at warehouse`);
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: true, received_at_hpd_at: now } : it),
    })));
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function undoReceived(item: WarehouseItem) {
    await supabase.from("items").update({ received_at_hpd: false, received_at_hpd_at: null }).eq("id", item.id);
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: false, received_at_hpd_at: null } : it),
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
    updateReceivedQty, markReceived, undoReceived,
    updateFulfillment, debounceFulfillmentTracking,
    supabase, logJobActivity,
  };
}

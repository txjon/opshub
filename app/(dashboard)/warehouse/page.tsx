"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import Link from "next/link";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { calculatePhase } from "@/lib/lifecycle";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

const FULFILLMENT_STAGES = [
  { id: "staged", label: "Staged", color: T.amber },
  { id: "packing", label: "Packing", color: T.purple },
  { id: "shipped", label: "Shipped", color: T.green },
];

type WarehouseItem = {
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
  decorator_assignment_id: string | null;
  decorator_id: string | null;
  decorator_name: string | null;
  decorator_short_code: string | null;
};

type DecoratorBucket = {
  decoratorId: string | null;
  decoratorName: string;
  shortCode: string;
  items: WarehouseItem[];
  pending: number;
  received: number;
  totalUnits: number;
};

type WarehouseJob = {
  id: string;
  title: string;
  job_number: string;
  display_number: string;
  shipping_route: string;
  fulfillment_status: string | null;
  fulfillment_tracking: string | null;
  client_name: string;
  items: WarehouseItem[];
  decoratorGroups: DecoratorBucket[];
};

export default function WarehousePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<WarehouseJob[]>([]);
  const saveTimers = useRef<Record<string, any>>({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);

    // Get non-drop-ship active jobs that have shipped items
    const { data: dbJobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, shipping_route, fulfillment_status, fulfillment_tracking, phase, clients(name)")
      .not("phase", "in", '("complete","cancelled")')
      .not("shipping_route", "eq", "drop_ship")
      .order("created_at", { ascending: false });

    if (!dbJobs?.length) { setJobs([]); setLoading(false); return; }

    const jobIds = dbJobs.map(j => j.id);
    const { data: allItems } = await supabase.from("items").select("*, buy_sheet_lines(size, qty_ordered)").in("job_id", jobIds).order("sort_order");
    // Per-item decorator info — drives vendor chips on each warehouse
    // row + powers per-decorator grouping inside the Incoming card.
    const assignmentMap: Record<string, { id: string; decoratorId: string | null; decoratorName: string; shortCode: string }> = {};
    if (allItems?.length) {
      const itemIds = allItems.map((it: any) => it.id);
      const { data: assignments } = await supabase
        .from("decorator_assignments")
        .select("id, item_id, decorator_id, decorators(id, name, short_code)")
        .in("item_id", itemIds);
      for (const a of (assignments || [])) {
        const dec = (a as any).decorators;
        assignmentMap[(a as any).item_id] = {
          id: (a as any).id,
          decoratorId: (a as any).decorator_id || dec?.id || null,
          decoratorName: dec?.name || "Unassigned",
          shortCode: dec?.short_code || "",
        };
      }
    }

    const mapped: WarehouseJob[] = [];
    for (const j of dbJobs) {
      const jobItems = (allItems || []).filter((it: any) => it.job_id === j.id);
      // Only show jobs with items that have shipped from decorator OR are received
      const relevant = jobItems.filter((it: any) =>
        it.pipeline_stage === "shipped" || it.received_at_hpd
      );
      if (relevant.length === 0) continue;

      const items: WarehouseItem[] = relevant.map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const a = assignmentMap[it.id];
        return {
          id: it.id,
          name: it.name,
          letter: String.fromCharCode(65 + (it.sort_order ?? 0)),
          blank_vendor: it.blank_vendor,
          blank_sku: it.blank_sku,
          job_id: it.job_id,
          pipeline_stage: it.pipeline_stage,
          ship_tracking: it.ship_tracking,
          received_at_hpd: it.received_at_hpd || false,
          received_at_hpd_at: it.received_at_hpd_at,
          sizes: sortSizes(lines.map((l: any) => l.size)),
          qtys: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered])),
          ship_qtys: it.ship_qtys || {},
          received_qtys: it.received_qtys || {},
          decorator_assignment_id: a?.id || null,
          decorator_id: a?.decoratorId || null,
          decorator_name: a?.decoratorName || null,
          decorator_short_code: a?.shortCode || null,
        };
      });

      // Group items by decorator within each job. Used for vendor chips
      // on the warehouse row + (future) per-vendor receive modal.
      const decoratorGroups: DecoratorBucket[] = [];
      for (const it of items) {
        const key = it.decorator_id || it.decorator_name || "unassigned";
        let bucket = decoratorGroups.find(b => (b.decoratorId || b.decoratorName) === key);
        if (!bucket) {
          bucket = {
            decoratorId: it.decorator_id || null,
            decoratorName: it.decorator_name || "Unassigned",
            shortCode: it.decorator_short_code || "",
            items: [],
            pending: 0,
            received: 0,
            totalUnits: 0,
          };
          decoratorGroups.push(bucket);
        }
        bucket.items.push(it);
        bucket.totalUnits += tQty(it.qtys);
        if (it.received_at_hpd) bucket.received++;
        else bucket.pending++;
      }

      mapped.push({
        id: j.id,
        title: j.title,
        job_number: j.job_number,
        display_number: (j as any).type_meta?.qb_invoice_number || j.job_number,
        shipping_route: j.shipping_route || "ship_through",
        fulfillment_status: j.fulfillment_status,
        fulfillment_tracking: j.fulfillment_tracking,
        client_name: (j as any).clients?.name || "",
        items,
        decoratorGroups,
      });
    }

    setJobs(mapped);
    setLoading(false);
  }

  async function updateReceivedQty(item: WarehouseItem, size: string, qty: number) {
    const current = (item as any).received_qtys || {};
    const updated = { ...current, [size]: qty };
    // Update local state
    setJobs(prev => prev.map(j => ({
      ...j,
      items: j.items.map(it => it.id === item.id ? { ...it, received_qtys: updated } as any : it),
    })));
    // Debounce save
    const key = `rx_${item.id}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      await supabase.from("items").update({ received_qtys: updated }).eq("id", item.id);
    }, 800);
  }

  async function recalcJobPhase(jobId: string) {
    const { data: jobData } = await supabase.from("jobs").select("*, clients(name)").eq("id", jobId).single();
    if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return;
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type").eq("job_id", jobId);
    const { data: payments } = await supabase.from("payment_records").select("amount, status").eq("job_id", jobId);
    const { data: proofFiles } = await supabase.from("item_files").select("item_id, approval").eq("stage", "proof").is("superseded_at", null).in("item_id", (jobItems||[]).map(it=>it.id));
    const proofStatus: Record<string, { allApproved: boolean }> = {};
    for (const it of (jobItems||[])) {
      const manualApproved = it.artwork_status === "approved";
      const proofs = (proofFiles||[]).filter(f => f.item_id === it.id);
      proofStatus[it.id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every(f => f.approval === "approved")) };
    }
    const result = calculatePhase({
      job: { job_type: jobData.job_type, shipping_route: jobData.shipping_route || "ship_through", payment_terms: jobData.payment_terms, quote_approved: jobData.quote_approved || false, phase: jobData.phase, fulfillment_status: jobData.fulfillment_status || null },
      items: (jobItems||[]).map(it => ({ id: it.id, pipeline_stage: it.pipeline_stage, blanks_order_number: it.blanks_order_number, blanks_order_cost: (it as any).blanks_order_cost ?? null, ship_tracking: it.ship_tracking, received_at_hpd: it.received_at_hpd || false, artwork_status: it.artwork_status, garment_type: it.garment_type })),
      payments: (payments||[]).map(p => ({ amount: p.amount, status: p.status })),
      proofStatus,
      poSentVendors: jobData.type_meta?.po_sent_vendors || [],
      costingVendors: [...new Set((jobData.costing_data?.costProds||[]).map((cp: any) => cp.printVendor).filter(Boolean))],
    });
    if (result.phase !== jobData.phase) {
      const timestamps = jobData.phase_timestamps || {};
      timestamps[result.phase] = new Date().toISOString();
      await supabase.from("jobs").update({ phase: result.phase, phase_timestamps: timestamps }).eq("id", jobId);
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, phase: result.phase } as any : j));
    }
  }

  async function markReceived(item: WarehouseItem) {
    const now = new Date().toISOString();
    await supabase.from("items").update({ received_at_hpd: true, received_at_hpd_at: now }).eq("id", item.id);
    logJobActivity(item.job_id, `${item.name} received at warehouse`);
    setJobs(prev => {
      const updated = prev.map(j => ({
        ...j,
        items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: true, received_at_hpd_at: now } : it),
      }));
      // Auto-switch tab + fire client emails when all items received
      const job = updated.find(j => j.items.some(it => it.id === item.id));
      if (job && job.items.every(it => it.received_at_hpd)) {
        const dest = job.shipping_route === "stage" ? "fulfillment" : "shipping";
        setTimeout(() => setActiveTab(dest), 0);

        // Stage route: fire "production complete — ready for fulfillment"
        // email to client. Idempotency in notify route guards against dupes.
        if (job.shipping_route === "stage") {
          fetch("/api/email/notify", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "production_complete", jobId: job.id }),
          }).catch(() => {});
          logJobActivity(job.id, "Production complete — email sent to client");
        }
      }
      return updated;
    });
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function undoReceived(item: WarehouseItem) {
    await supabase.from("items").update({ received_at_hpd: false, received_at_hpd_at: null }).eq("id", item.id);
    setJobs(prev => prev.map(j => ({
      ...j,
      items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: false, received_at_hpd_at: null } : it),
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
    setJobs(prev => {
      const updated = prev.map(j => ({
        ...j, items: j.items.map(it => it.id === item.id ? { ...it, pipeline_stage: "in_production", received_at_hpd: false, received_at_hpd_at: null, received_qtys: {} } : it),
      }));
      // Remove job if no items left in warehouse pipeline
      return updated.filter(j => j.items.some(it => it.pipeline_stage === "shipped" || it.received_at_hpd));
    });
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function updateFulfillment(jobId: string, status: string | null, tracking?: string) {
    const updates: any = { fulfillment_status: status };
    if (tracking !== undefined) updates.fulfillment_tracking = tracking;
    await supabase.from("jobs").update(updates).eq("id", jobId);
    if (status === "shipped") {
      logJobActivity(jobId, "Fulfillment complete — order shipped to client");
      notifyTeam("Order shipped to client", "production", jobId, "job");

      // Ship_through: email client with packing slip + invoice-ready notification.
      // Stage: no client email here — fulfillment-shipped email is a future
      // feature with its own copy (see roadmap). Internal invoice-ready
      // notification still fires so manager can review variance.
      const { data: job } = await supabase.from("jobs").select("shipping_route, title, fulfillment_tracking, clients(name)").eq("id", jobId).single();
      const route = (job as any)?.shipping_route;
      if (route === "ship_through") {
        fetch("/api/email/notify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "order_shipped_hpd",
            jobId,
            trackingNumber: (job as any).fulfillment_tracking || null,
          }),
        }).catch(() => {});
        logJobActivity(jobId, "Order shipped email sent to client");
      }
      if (route === "ship_through" || route === "stage") {
        await createInvoiceReadyNotification(jobId, (job as any).title || "", (job as any).clients?.name || "");
        logJobActivity(jobId, `${route === "ship_through" ? "Ship-through" : "Stage/Fulfillment"} complete — invoice ready to update with received qtys`);
      }
    }
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, fulfillment_status: status, ...(tracking !== undefined ? { fulfillment_tracking: tracking } : {}) } : j));
    setTimeout(() => recalcJobPhase(jobId), 300);
  }

  // Notifications table deprecated — bell UI was removed. No-op kept so
  // existing callers compile. Variance review still surfaces in PaymentTab.
  async function createInvoiceReadyNotification(_jobId: string, _jobTitle: string, _clientName: string) {
    return;
  }

  function debounceFulfillmentTracking(jobId: string, tracking: string) {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, fulfillment_tracking: tracking } : j));
    if (saveTimers.current[jobId]) clearTimeout(saveTimers.current[jobId]);
    saveTimers.current[jobId] = setTimeout(() => {
      supabase.from("jobs").update({ fulfillment_tracking: tracking }).eq("id", jobId);
    }, 800);
  }

  const [activeTab, setActiveTab] = useState("incoming");
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

  // Split jobs into sections
  const incoming = jobs.filter(j => j.items.some(it => !it.received_at_hpd));
  const shipThrough = jobs.filter(j => j.shipping_route === "ship_through" && j.items.every(it => it.received_at_hpd));
  const fulfillment = jobs.filter(j => j.shipping_route === "stage" && j.items.every(it => it.received_at_hpd));

  const incomingItemCount = incoming.reduce((a, j) => a + j.items.filter(it => !it.received_at_hpd).length, 0);
  const shipThroughItemCount = shipThrough.reduce((a, j) => a + j.items.length, 0);
  const fulfillmentItemCount = fulfillment.reduce((a, j) => a + j.items.length, 0);

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading warehouse...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Warehouse</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: 4, background: T.surface, borderRadius: 8 }}>
        {[
          { id: "incoming", label: "Incoming", count: incomingItemCount },
          { id: "shipping", label: "Shipping", count: shipThroughItemCount },
          { id: "fulfillment", label: "Fulfillment", count: fulfillmentItemCount },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              background: activeTab === tab.id ? T.accent : "transparent",
              color: activeTab === tab.id ? "#fff" : T.muted,
              transition: "all 0.15s",
            }}>
            {tab.label}
            {tab.count > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, padding: "1px 6px", borderRadius: 99,
                background: activeTab === tab.id ? "rgba(255,255,255,0.2)" : T.card,
                color: activeTab === tab.id ? "#fff" : T.accent,
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── INCOMING — production-page-style rows ── */}
      {activeTab === "incoming" && (incoming.length === 0 ? (
        <div style={{ ...card, padding: "24px", textAlign: "center", fontSize: 12, color: T.faint }}>No incoming items</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {incoming.map(job => {
            const pendingItems = job.items.filter(it => !it.received_at_hpd);
            const pendingUnits = pendingItems.reduce((a, it) => a + tQty(it.qtys), 0);
            const totalItems = job.items.length;
            return (
              <div key={job.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                {/* ── Outer row — mirrors production page's project row.
                    Title block (left, 220px) + vendor chips (middle, flex)
                    + right cell (route badge / counts). ── */}
                <div style={{ padding: "14px 18px", display: "flex", gap: 16, alignItems: "flex-start" }}>
                  {/* Title block */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, width: 220, flexShrink: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: job.display_number ? T.text : "transparent", fontFamily: mono, whiteSpace: "nowrap", alignSelf: "center" }}>
                      {job.display_number || ""}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Link href={`/jobs/${job.id}`} style={{ fontSize: 14, fontWeight: 700, color: T.text, textDecoration: "none", display: "block" }}>
                        {job.client_name || "No client"}
                      </Link>
                      {job.title && (
                        <div style={{ fontSize: 12, color: T.faint, marginTop: 2, lineHeight: 1.4, wordBreak: "break-word" }}>
                          {job.title}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Vendor chips middle — one chip per decorator with
                      pending/received counts. Click navigates focus to
                      that decorator's items below (anchor scroll). */}
                  <div style={{ flex: 1, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    {job.decoratorGroups.map(dg => {
                      const decKey = dg.decoratorId || dg.decoratorName;
                      const allReceived = dg.pending === 0;
                      return (
                        <a key={decKey} href={`#warehouse-${job.id}-${decKey}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "4px 10px", borderRadius: 6, background: T.surface,
                            fontSize: 11, border: `1px solid ${T.border}`, cursor: "pointer",
                            fontFamily: font, transition: "all 0.12s", textDecoration: "none",
                          }}>
                          <span style={{ fontWeight: 600, color: T.text }}>{dg.shortCode || dg.decoratorName}</span>
                          <span style={{ color: T.muted }}>{dg.items.length} item{dg.items.length !== 1 ? "s" : ""}</span>
                          <span style={{ color: T.faint }}>·</span>
                          {dg.pending > 0 && <span style={{ color: T.amber }}>{dg.pending} pending</span>}
                          {dg.received > 0 && <span style={{ color: T.green }}>{dg.received} received</span>}
                          {allReceived && <span style={{ color: T.green, fontWeight: 700 }}>✓</span>}
                        </a>
                      );
                    })}
                  </div>

                  {/* Right cell — route badge + counts */}
                  <div style={{ flexShrink: 0, marginLeft: 12, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 90 }}>
                    <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 99, background: job.shipping_route === "stage" ? T.purpleDim : T.accentDim, color: job.shipping_route === "stage" ? T.purple : T.accent, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      {job.shipping_route === "stage" ? "Stage" : "Ship-through"}
                    </span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: mono, whiteSpace: "nowrap" }}>
                      {pendingItems.length}/{totalItems}
                    </div>
                    <span style={{ fontSize: 10, color: T.faint, whiteSpace: "nowrap" }}>incoming</span>
                    <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {pendingUnits.toLocaleString()} units
                    </span>
                  </div>
                </div>

                {/* ── Per-decorator item groups ── */}
                <div style={{ borderTop: `1px solid ${T.border}` }}>
                  {job.decoratorGroups.map(dg => {
                    const decKey = dg.decoratorId || dg.decoratorName;
                    return (
                      <div key={decKey} id={`warehouse-${job.id}-${decKey}`} style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}` }}>
                        {/* Mini-header for this decorator */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: "-0.01em" }}>{dg.decoratorName}</span>
                          <span style={{ fontSize: 11, color: T.muted }}>
                            <strong style={{ color: T.text, fontWeight: 700 }}>{dg.pending}</strong> pending
                            {dg.received > 0 && <>
                              <span style={{ color: T.faint, margin: "0 6px" }}>·</span>
                              <strong style={{ color: T.green, fontWeight: 700 }}>{dg.received}</strong> received
                            </>}
                            <span style={{ color: T.faint, margin: "0 6px" }}>·</span>
                            <strong style={{ color: T.text, fontWeight: 700 }}>{dg.totalUnits.toLocaleString()}</strong> units
                          </span>
                        </div>

                        {/* Items — one row each, production-style layout */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {dg.items.map(item => {
                            const totalQty = tQty(item.qtys);
                            const shippedQty = tQty(item.ship_qtys);
                            const receivedTotal = tQty(item.received_qtys || {});
                            const hasVariance = item.received_at_hpd && receivedTotal > 0 && receivedTotal !== (shippedQty || totalQty);
                            const isReceived = item.received_at_hpd;
                            return (
                              <div key={item.id} style={{
                                padding: "10px 12px", borderRadius: 6,
                                background: isReceived ? (hasVariance ? T.amberDim + "44" : T.greenDim + "44") : "transparent",
                                border: `1px solid ${isReceived ? (hasVariance ? T.amber + "33" : T.green + "33") : T.border}`,
                              }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: T.muted, fontFamily: mono, flexShrink: 0 }}>{item.letter}</span>
                                  {/* Title + specs stack */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.name}</div>
                                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                                      {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "—"}
                                      <span style={{ color: T.faint, margin: "0 6px" }}>·</span>
                                      {totalQty} units
                                      {item.ship_tracking && <>
                                        <span style={{ color: T.faint, margin: "0 6px" }}>·</span>
                                        <span style={{ fontFamily: mono }}>{item.ship_tracking}</span>
                                      </>}
                                    </div>
                                  </div>
                                  {/* Size grid: shipped → received */}
                                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                    {item.sizes.map(sz => {
                                      const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                      const received = item.received_qtys?.[sz] ?? shipped;
                                      const mismatch = isReceived && received !== shipped;
                                      return (
                                        <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                          <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{sz}</span>
                                          <input type="text" inputMode="numeric" value={received}
                                            onClick={e => (e.target as HTMLInputElement).select()}
                                            onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                            style={{ width: 52, padding: "8px 6px", textAlign: "center", border: `1px solid ${mismatch ? T.amber : T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 13, fontFamily: mono, outline: "none" }} />
                                          <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{shipped}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {/* Action buttons */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                    {isReceived ? (
                                      <>
                                        <span style={{ fontSize: 11, color: hasVariance ? T.amber : T.green, fontWeight: 700 }}>
                                          {hasVariance ? `Variance ${receivedTotal - (shippedQty || totalQty)}` : "Received"}
                                        </span>
                                        <button onClick={() => undoReceived(item)}
                                          style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                                          Undo
                                        </button>
                                        <button onClick={() => returnToProduction(item)}
                                          style={{ fontSize: 10, color: T.amber, background: "none", border: `1px solid ${T.amber}44`, borderRadius: 4, padding: "5px 10px", cursor: "pointer" }} title="Send back to decorator">
                                          ← Production
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={() => returnToProduction(item)}
                                          style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "6px 10px", cursor: "pointer" }} title="Send back to decorator">
                                          ← Production
                                        </button>
                                        <button onClick={() => markReceived(item)}
                                          style={{ padding: "8px 18px", borderRadius: 4, border: "none", background: T.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: font }}>
                                          Confirm
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>))}

      {/* ── SHIPPING ── */}
      {activeTab === "shipping" && (shipThrough.length === 0 ? (
        <div style={{ ...card, padding: "24px", textAlign: "center", fontSize: 12, color: T.faint }}>No orders ready to ship</div>
      ) : (
        <div>
          {shipThrough.map(job => (
            <div key={job.id} style={{ ...card, marginBottom: 8 }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
                <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
                <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.display_number}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: T.green, fontWeight: 600 }}>All {job.items.length} items received</span>
              </div>
              <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Outbound tracking #</label>
                    <input style={{ ...ic, fontFamily: mono }} value={job.fulfillment_tracking || ""} placeholder="Enter tracking to mark shipped"
                      onChange={e => debounceFulfillmentTracking(job.id, e.target.value)} />
                  </div>
                  <button onClick={async () => {
                    if (!job.fulfillment_tracking) return;
                    await updateFulfillment(job.id, "shipped");
                    logJobActivity(job.id, `Ship-through complete — forwarded to client (${job.fulfillment_tracking})`);
                    // Recalc phase will happen on next page load
                    await supabase.from("jobs").update({ phase: "complete" }).eq("id", job.id);
                    setJobs(prev => prev.filter(j => j.id !== job.id));
                  }}
                    disabled={!job.fulfillment_tracking}
                    style={{ background: job.fulfillment_tracking ? T.green : T.surface, border: "none", borderRadius: 6, color: job.fulfillment_tracking ? "#fff" : T.faint, fontSize: 11, fontWeight: 600, padding: "8px 16px", cursor: job.fulfillment_tracking ? "pointer" : "default", opacity: job.fulfillment_tracking ? 1 : 0.5 }}>
                    Mark Shipped
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {job.items.map(item => (
                    <span key={item.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: T.surface, color: T.muted, cursor: "pointer" }}
                      onClick={() => undoReceived(item)}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = T.amber; e.currentTarget.style.color = T.amber; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = T.muted; }}
                      title="Click to revert to incoming">
                      {item.letter} {item.name} · {tQty(item.qtys)} units
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>))}

      {/* ── FULFILLMENT ── */}
      {activeTab === "fulfillment" && (fulfillment.length === 0 ? (
        <div style={{ ...card, padding: "24px", textAlign: "center", fontSize: 12, color: T.faint }}>No orders in fulfillment</div>
      ) : (
        <div>
          {fulfillment.map(job => {
            const si = FULFILLMENT_STAGES.findIndex(s => s.id === job.fulfillment_status);
            return (
              <div key={job.id} style={{ ...card, marginBottom: 8 }}>
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
                  <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
                  <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.display_number}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted }}>{job.items.length} items · {job.items.reduce((a, it) => a + tQty(it.qtys), 0).toLocaleString()} units</span>
                </div>
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Fulfillment stage buttons */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {FULFILLMENT_STAGES.map((stage, idx) => {
                      const done = si >= idx, active = job.fulfillment_status === stage.id;
                      return (
                        <button key={stage.id} onClick={() => updateFulfillment(job.id, stage.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6,
                            fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
                            border: `1px solid ${done ? stage.color + "66" : T.border}`,
                            background: active ? stage.color + "22" : done ? stage.color + "11" : "transparent",
                            color: done ? stage.color : T.muted,
                          }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: done ? stage.color : T.faint }} />
                          {stage.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Tracking for shipped */}
                  {(job.fulfillment_status === "shipped" || job.fulfillment_status === "packing") && (
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Outbound tracking</label>
                      <input style={{ ...ic, fontFamily: mono }} value={job.fulfillment_tracking || ""} placeholder="Enter tracking number"
                        onChange={e => debounceFulfillmentTracking(job.id, e.target.value)} />
                    </div>
                  )}

                  {/* Item summary */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {job.items.map(item => (
                      <span key={item.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: T.surface, color: T.muted, cursor: "pointer" }}
                        onClick={() => undoReceived(item)}
                        onMouseEnter={e => { e.currentTarget.style.color = T.amber; }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
                        title="Click to revert to incoming">
                        {item.letter} {item.name} · {tQty(item.qtys)} units
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>))}

      {jobs.length === 0 && (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No items in warehouse pipeline. Items appear here when shipped from decorator.
        </div>
      )}
    </div>
  );
}

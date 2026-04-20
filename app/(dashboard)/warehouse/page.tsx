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
  decorator_assignment_id: string | null;
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
    const assignmentMap: Record<string, string> = {};
    if (allItems?.length) {
      const itemIds = allItems.map((it: any) => it.id);
      const { data: assignments } = await supabase.from("decorator_assignments").select("id, item_id").in("item_id", itemIds);
      for (const a of (assignments || [])) assignmentMap[a.item_id] = a.id;
    }

    const mapped: WarehouseJob[] = [];
    for (const j of dbJobs) {
      const jobItems = (allItems || []).filter((it: any) => it.job_id === j.id);
      // Only show jobs with items that have shipped from decorator OR are received
      const relevant = jobItems.filter((it: any) =>
        it.pipeline_stage === "shipped" || it.received_at_hpd
      );
      if (relevant.length === 0) continue;

      mapped.push({
        id: j.id,
        title: j.title,
        job_number: j.job_number,
        display_number: (j as any).type_meta?.qb_invoice_number || j.job_number,
        shipping_route: j.shipping_route || "ship_through",
        fulfillment_status: j.fulfillment_status,
        fulfillment_tracking: j.fulfillment_tracking,
        client_name: (j as any).clients?.name || "",
        items: relevant.map((it: any) => {
          const lines = it.buy_sheet_lines || [];
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
            decorator_assignment_id: assignmentMap[it.id] || null,
          };
        }),
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
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, blanks_order_number, ship_tracking, received_at_hpd, artwork_status, garment_type").eq("job_id", jobId);
    const { data: payments } = await supabase.from("payment_records").select("amount, status").eq("job_id", jobId);
    const { data: proofFiles } = await supabase.from("item_files").select("item_id, approval").eq("stage", "proof").in("item_id", (jobItems||[]).map(it=>it.id));
    const proofStatus: Record<string, { allApproved: boolean }> = {};
    for (const it of (jobItems||[])) {
      const manualApproved = it.artwork_status === "approved";
      const proofs = (proofFiles||[]).filter(f => f.item_id === it.id);
      proofStatus[it.id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every(f => f.approval === "approved")) };
    }
    const result = calculatePhase({
      job: { job_type: jobData.job_type, shipping_route: jobData.shipping_route || "ship_through", payment_terms: jobData.payment_terms, quote_approved: jobData.quote_approved || false, phase: jobData.phase, fulfillment_status: jobData.fulfillment_status || null },
      items: (jobItems||[]).map(it => ({ id: it.id, pipeline_stage: it.pipeline_stage, blanks_order_number: it.blanks_order_number, ship_tracking: it.ship_tracking, received_at_hpd: it.received_at_hpd || false, artwork_status: it.artwork_status, garment_type: it.garment_type })),
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
        ...j, items: j.items.map(it => it.id === item.id ? { ...it, pipeline_stage: "in_production", received_at_hpd: false, received_at_hpd_at: null, received_qtys: null } : it),
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

  // Notify managers that the invoice can be updated with actual shipped/received qtys
  async function createInvoiceReadyNotification(jobId: string, jobTitle: string, clientName: string) {
    try {
      const { data: profiles } = await supabase.from("profiles").select("id, role").in("role", ["owner", "manager", "staff"]);
      if (!profiles?.length) return;
      await (supabase as any).from("notifications").insert(
        profiles.map((p: any) => ({
          user_id: p.id,
          type: "alert",
          message: `Invoice ready to update — ${clientName || ""} · ${jobTitle} · review variance`,
          reference_id: jobId,
          reference_type: "job",
        }))
      );
    } catch (e) {
      console.error("[warehouse/updateFulfillment] createInvoiceReadyNotification failed:", e);
    }
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

      {/* ── INCOMING ── */}
      {activeTab === "incoming" && (incoming.length === 0 ? (
        <div style={{ ...card, padding: "24px", textAlign: "center", fontSize: 12, color: T.faint }}>No incoming items</div>
      ) : (
        <div>
        {incoming.map(job => (
          <div key={job.id} style={{ ...card, marginBottom: 8 }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
              <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
              <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.display_number}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 99, background: job.shipping_route === "stage" ? T.purpleDim : T.accentDim, color: job.shipping_route === "stage" ? T.purple : T.accent }}>
                {job.shipping_route === "stage" ? "Stage" : "Ship-through"}
              </span>
            </div>
            <div style={{ padding: "10px 14px" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {["Item", "Tracking", "Shipped → Received", "Status", ""].map(h =>
                      <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {job.items.map((item, i) => {
                    const totalQty = tQty(item.qtys);
                    const shippedQty = tQty(item.ship_qtys);
                    const receivedQtys = (item as any).received_qtys || {};
                    const receivedTotal = tQty(receivedQtys);
                    const hasVariance = item.received_at_hpd && receivedTotal > 0 && receivedTotal !== (shippedQty ?? totalQty);
                    return (
                      <tr key={item.id} style={{ borderBottom: i < job.items.length - 1 ? `1px solid ${T.border}` : "none", verticalAlign: "top" }}>
                        <td style={{ padding: "8px", fontWeight: 600 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: T.purple, fontFamily: mono, marginRight: 6 }}>{item.letter}</span>{item.name}
                          <div style={{ fontSize: 10, color: T.faint, fontWeight: 400 }}>{[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td style={{ padding: "8px", fontFamily: mono, fontSize: 11, color: T.muted }}>{item.ship_tracking || "—"}</td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {item.sizes.map(sz => {
                              const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                              const received = receivedQtys[sz] ?? shipped;
                              const mismatch = item.received_at_hpd && received !== shipped;
                              return (
                                <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                  <span style={{ fontSize: 8, color: T.faint, fontFamily: mono }}>{sz}</span>
                                  <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{shipped}</span>
                                  <input type="number" min="0" value={received}
                                    onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                    onFocus={e => e.target.select()}
                                    style={{ width: 36, textAlign: "center", padding: "2px", border: `1px solid ${mismatch ? T.red : T.border}`, borderRadius: 3, background: T.surface, color: mismatch ? T.red : T.text, fontSize: 10, fontFamily: mono, outline: "none" }} />
                                </div>
                              );
                            })}
                          </div>
                          {hasVariance && (
                            <div style={{ fontSize: 9, color: T.red, marginTop: 4 }}>
                              Variance: {receivedTotal - (shippedQty ?? totalQty)} units
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {item.received_at_hpd ? (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: hasVariance ? T.amberDim : T.greenDim, color: hasVariance ? T.amber : T.green }}>{hasVariance ? "Variance" : "Received"}</span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.surface, color: T.muted }}>Pending</span>
                          )}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {item.received_at_hpd ? (
                            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                              <button onClick={() => undoReceived(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Undo</button>
                              <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.amber, background: "none", border: `1px solid ${T.amber}44`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                              <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                              <button onClick={() => markReceived(item)} style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: T.green, border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Confirm</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
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

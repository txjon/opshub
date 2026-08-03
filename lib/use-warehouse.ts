"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { sortSizes } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { calculatePhase } from "@/lib/lifecycle";
import { poSentToItem } from "@/lib/item-status";
import {
  receiveShipmentLineForItem, unreceiveShipmentLineForItem, removeShipmentLineForItem,
  fulfillPullRequest, recordAdHocPull, updatePullRequest,
  type PullRequestRow,
} from "@/lib/handoff";
import { recordReceive, recordOutbound, recomputeItemFromLedger, reverseLastMovement, reverseReceiptForShipment, appendMovement } from "@/lib/inventory-ledger";
import { addQtys, subtractQtys } from "@/lib/ship-progress";

// forwarded/staged qty = what's on hand to send = received (fallback shipped)
// minus any units pulled as samples.
const outboundQtys = (base: Record<string, number>, samples: Record<string, number> | null | undefined) => {
  const out: Record<string, number> = {};
  for (const [s, n] of Object.entries(base || {})) {
    const v = (Number(n) || 0) - (Number(samples?.[s]) || 0);
    if (v > 0) out[s] = v;
  }
  return out;
};
const negate = (q: Record<string, number>) => Object.fromEntries(Object.entries(q || {}).map(([s, n]) => [s, -(Number(n) || 0)]));

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
  // Local-pickup flag (migration 106). When true the item is grouped into a
  // single per-vendor pickup block on Receiving instead of by tracking #.
  pickup_ready: boolean;
  // Warehouse-arrival ETA override (migration 107) + the vendor's transit buffer
  // (business days). Receiving's ETA = expected_arrival ?? shipped + buffer.
  expected_arrival: string | null;
  transit_days: number | null;
  received_at_hpd: boolean;
  received_at_hpd_at: string | null;
  // Outbound HPD → client forward (ship_through). Null = received but not yet
  // forwarded ("ready"); set = forwarded ("done"). forward_tracking groups a wave.
  forwarded_at: string | null;
  forward_tracking: string | null;
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
  // Open pull requests for this item (migration 117): production's
  // pre-declared "hold N units back for X" tasks, fulfilled by the warehouse.
  // Fulfilled/cancelled requests are not loaded here — the receive card only
  // needs the outstanding work.
  pull_requests: PullRequestRow[];
  // Per-item delivery ETA (manual override on Production). Receiving shows it
  // so the warehouse sees the deadline.
  client_eta: string | null;
  decorator_id: string | null;
  decorator_assignment_id: string | null;
  decorator_name: string | null;
  decorator_short_code: string | null;
  receiving_data?: { condition?: string; notes?: string; received_by?: string | null; received_by_email?: string | null; received_at?: string } | null;
  // Production-side notes that must survive the handoff (typed on the PO tab /
  // Costing). Loaded here so /receiving can finally display them.
  production_notes_po: string | null;
  packing_notes: string | null;
  // ── Box-scoped fields (set only when this item view belongs to a persisted
  //    shipment box). ship_qtys/received_qtys/received_at_hpd above are then the
  //    BOX's numbers; these carry the box identity + the item's CUMULATIVE state
  //    (for the item-level forward/fulfillment handoff, which stays whole-order).
  _shipmentId?: string;
  _lineId?: string;
  _boxReceived?: boolean;
  _itemFullyReceived?: boolean;   // item's cumulative received_at_hpd (all boxes in)
  _cumReceivedQtys?: Record<string, number>;
  _cumShippedQtys?: Record<string, number>;   // item cumulative shipped across all waves
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
  // Persisted shipment boxes (migration 117) — the box-centric source for
  // /receiving. Multiple boxes per item are real, separate shipments.
  const [boxes, setBoxes] = useState<{ shipments: any[]; lines: any[] }>({ shipments: [], lines: [] });
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
        .select("id, title, job_number, client_id, shipping_route, fulfillment_status, fulfillment_tracking, phase, type_meta, clients(name, shipping_address)")
        .not("phase", "in", '("complete","cancelled")')
        .order("created_at", { ascending: false }),
      supabase
        .from("jobs")
        .select("id, title, job_number, client_id, shipping_route, fulfillment_status, fulfillment_tracking, phase, type_meta, clients(name, shipping_address)")
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
    // Fallback contacts: when a job has no job_contacts row (seeded jobs, or
    // jobs created before the auto-copy-from-client existed), fall back to the
    // client's own contacts so the warehouse still gets a name/phone/email.
    const clientIds = Array.from(new Set(dbJobs.map((j: any) => j.client_id).filter(Boolean)));
    const clientContacts: Record<string, { name: string; phone: string | null; email: string | null }> = {};
    if (clientIds.length) {
      const { data: cc } = await supabase.from("contacts").select("client_id, name, phone, email").in("client_id", clientIds);
      for (const c of ((cc || []) as any[])) {
        if (!clientContacts[c.client_id] && (c.name || c.email)) {
          clientContacts[c.client_id] = { name: c.name || "", phone: c.phone || null, email: c.email || null };
        }
      }
    }
    // Open pull requests (migration 117), keyed by item. Only pending/partial —
    // the warehouse card shows outstanding work, not history.
    const pullsByItem: Record<string, PullRequestRow[]> = {};
    if (allItems?.length) {
      const { data: openPulls } = await supabase
        .from("pull_requests").select("*")
        .in("item_id", allItems.map((it: any) => it.id))
        .in("status", ["pending", "partial"])
        .order("created_at");
      for (const pr of (openPulls || []) as PullRequestRow[]) {
        if (!pullsByItem[pr.item_id]) pullsByItem[pr.item_id] = [];
        pullsByItem[pr.item_id].push(pr);
      }
    }
    const assignmentMap: Record<string, string> = {};
    const decoratorMap: Record<string, { id: string | null; name: string; short_code: string | null; transit_days: number | null }> = {};
    if (allItems?.length) {
      const itemIds = allItems.map((it: any) => it.id);
      const { data: assignments } = await supabase.from("decorator_assignments")
        .select("id, item_id, decorator_id, decorators(name, short_code, transit_days)")
        .in("item_id", itemIds);
      for (const a of (assignments || []) as any[]) {
        assignmentMap[a.item_id] = a.id;
        if (a.decorators?.name || a.decorator_id) {
          decoratorMap[a.item_id] = {
            id: a.decorator_id || null,
            name: a.decorators?.name || "Unassigned",
            short_code: a.decorators?.short_code || null,
            transit_days: a.decorators?.transit_days ?? null,
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
        // Include anything with shipped units (even partial waves where the item
        // is still in_production for the balance), plus already-received items.
        const shippedUnits = tQty(it.ship_qtys || {});
        return it.pipeline_stage === "shipped" || it.received_at_hpd || shippedUnits > 0;
      });
      if (relevant.length === 0) continue;

      const typeMeta = (j as any).type_meta || {};
      // Show a contact if the job has ANY — don't require role="primary".
      // Prefer primary → logistics/shipping → any contact with a name/email
      // (mirrors the email resolver, which already falls back this way).
      const jobContacts = allContacts.filter((c: any) => c.job_id === j.id && c.contacts);
      const pickContact =
        jobContacts.find((c: any) => c.role_on_job === "primary")
        || jobContacts.find((c: any) => c.role_on_job === "logistics" || c.role_on_job === "shipping")
        || jobContacts.find((c: any) => (c.contacts as any)?.name || (c.contacts as any)?.email);
      // Job contact if linked; otherwise the client's contact.
      const contactData = (pickContact as any)?.contacts || clientContacts[(j as any).client_id] || {};
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
            pull_requests: pullsByItem[it.id] || [],
            client_eta: it.client_eta || null,
            ship_date: ts.shipped || null,
            shipping_route: it.shipping_route || null,
            pickup_ready: it.pickup_ready || false,
            expected_arrival: it.expected_arrival || null,
            transit_days: decoratorMap[it.id]?.transit_days ?? null,
            received_at_hpd: it.received_at_hpd || false, received_at_hpd_at: it.received_at_hpd_at,
            forwarded_at: it.forwarded_at || null, forward_tracking: it.forward_tracking || null,
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
            production_notes_po: it.production_notes_po || null,
            packing_notes: it.packing_notes || null,
          };
        }),
      });
    }
    setJobs(mapped);

    // Persisted shipment boxes + their per-item lines — the box-centric source
    // for /receiving. Each shipments row is a real box (one tracking / one
    // vendor drop); its lines carry that box's per-item qtys + receive state.
    const allItemIds = (allItems || []).map((it: any) => it.id);
    if (allItemIds.length) {
      const { data: lineRows } = await supabase.from("shipment_lines")
        .select("id, shipment_id, item_id, job_id, ship_qtys, received, received_qtys, received_at, condition, notes, created_at")
        .in("item_id", allItemIds);
      const shipmentIds = Array.from(new Set((lineRows || []).map((l: any) => l.shipment_id)));
      const boxRows = shipmentIds.length
        ? (await supabase.from("shipments")
            .select("id, tracking, pickup, status, created_at, received_at, expected_arrival, warehouse_notes, decorator_id")
            .in("id", shipmentIds)).data || []
        : [];
      setBoxes({ shipments: boxRows, lines: lineRows || [] });
    } else {
      setBoxes({ shipments: [], lines: [] });
    }

    setLoading(false);
  }

  async function recalcJobPhase(jobId: string) {
    const { data: jobData } = await supabase.from("jobs").select("*, clients(name)").eq("id", jobId).single();
    if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return;
    const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type, shipping_route, webstore_entered_at, forwarded_at").eq("job_id", jobId);
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
      items: (jobItems || []).map(it => ({ id: it.id, pipeline_stage: it.pipeline_stage, po_sent: poSentToItem({ printVendor: (jobData.costing_data?.costProds || []).find((cp: any) => cp.id === it.id)?.printVendor, poSentVendors: jobData.type_meta?.po_sent_vendors }), blanks_order_number: it.blanks_order_number, blanks_order_cost: (it as any).blanks_order_cost ?? null, ship_tracking: it.ship_tracking, received_at_hpd: it.received_at_hpd || false, artwork_status: it.artwork_status, garment_type: it.garment_type, shipping_route: (it as any).shipping_route || null, webstore_entered_at: (it as any).webstore_entered_at || null, forwarded_at: (it as any).forwarded_at || null })),
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

  // ── Pull requests (migration 117) ──────────────────────────────────────
  // (The old items.sample_pulls JSONB toggle/add mutations lived here — the
  // migration backfilled that column into pull_requests and nothing writes
  // it anymore.)
  // Fulfill a pre-declared pull: writes pulled_inventory, rolls qtys into the
  // legacy sample_qtys map (keeps deductSamples balance math working), and
  // drops the request from the item's open list.
  async function fulfillPull(item: WarehouseItem, pull: PullRequestRow, fulfilledQtys?: Record<string, number>) {
    const nextSamples = await fulfillPullRequest(supabase, pull, {
      fulfilledQtys,
      itemName: item.name,
      currentSampleQtys: item.sample_qtys || {},
    });
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id
        ? { ...it, sample_qtys: nextSamples, pull_requests: (it.pull_requests || []).filter(p => p.id !== pull.id) }
        : it),
    })));
    const total = Object.values(fulfilledQtys || pull.qtys || {}).reduce((a, n) => a + (Number(n) || 0), 0);
    const why = [pull.kind !== "sample" ? pull.kind : null, pull.reason].filter(Boolean).join(" — ");
    logJobActivity(item.job_id, `${item.name} — pull fulfilled: ${total} unit${total === 1 ? "" : "s"}${why ? ` (${why})` : ""}`);
  }

  // Ad-hoc pull logged by the warehouse at receive/forward time. Creates an
  // already-fulfilled pull_request + pulled_inventory bucket in one step.
  async function addPull(item: WarehouseItem, qtys: Record<string, number>, kind: string, reason: string) {
    const clean = Object.fromEntries(Object.entries(qtys)
      .map(([s, n]) => [s, Number(n) || 0])
      .filter(([s, n]) => (n as number) > 0 && item.sizes.includes(s as string)));
    if (Object.keys(clean).length === 0) return;
    const nextSamples = await recordAdHocPull(supabase, {
      job_id: item.job_id, item_id: item.id, item_name: item.name,
      kind: kind || "sample", qtys: clean, reason,
      currentSampleQtys: item.sample_qtys || {},
    });
    if (!nextSamples) return;   // pull_request insert failed — don't wipe sample_qtys
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, sample_qtys: nextSamples } : it),
    })));
    const total = Object.values(clean).reduce((a: number, n) => a + (Number(n) || 0), 0);
    logJobActivity(item.job_id, `${item.name} — ${total} unit${total === 1 ? "" : "s"} pulled${reason ? ` (${reason})` : ""}`);
  }

  // Dismiss a pull the warehouse can't or shouldn't fulfill (e.g. shipment
  // came in short). Stays in the table as history.
  async function cancelPull(item: WarehouseItem, pull: PullRequestRow) {
    await updatePullRequest(supabase, pull.id, { status: "cancelled" });
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id
        ? { ...it, pull_requests: (it.pull_requests || []).filter(p => p.id !== pull.id) }
        : it),
    })));
  }

  // Forward a wave of received ship-through items to the client. Stamps
  // forwarded_at + forward_tracking on each. When this empties the job's
  // unforwarded ship-through items, also set fulfillment_status=shipped +
  // phase=complete so lifecycle/old readers settle. Returns whether the job is
  // now fully forwarded (so the caller can decide on the client email / cleanup).
  async function forwardItems(jobId: string, itemIds: string[], tracking: string | null) {
    const now = new Date().toISOString();
    await supabase.from("items").update({ forwarded_at: now, forward_tracking: (tracking || "").trim() || null }).in("id", itemIds);
    // Ledger: one forward movement per item (the auditable "forwarded qty").
    const { data: fwdItems } = await supabase.from("items")
      .select("id, name, received_qtys, ship_qtys, sample_qtys").in("id", itemIds);
    for (const it of fwdItems || []) {
      const base = (it.received_qtys && Object.keys(it.received_qtys).length) ? it.received_qtys : (it.ship_qtys || {});
      await recordOutbound(supabase, {
        itemId: it.id, jobId, type: "forward", qtys: outboundQtys(base, it.sample_qtys),
        tracking, description: it.name,
      });
    }
    setJobs(prev => prev.map(j => j.id === jobId
      ? { ...j, items: j.items.map(it => itemIds.includes(it.id) ? { ...it, forwarded_at: now, forward_tracking: (tracking || "").trim() || null } : it) }
      : j));
    // Complete the job only when EVERY item has reached its client-delivery
    // state — query the full set (drop_ship items are excluded from the
    // warehouse view, so we can't judge them from job.items). A mixed job
    // isn't done just because its ship_through items are forwarded.
    const { data: jr } = await supabase.from("jobs").select("shipping_route").eq("id", jobId).single();
    const jobRoute = (jr as any)?.shipping_route || "ship_through";
    const { data: allItems } = await supabase.from("items").select("id, pipeline_stage, shipping_route, forwarded_at, webstore_entered_at").eq("job_id", jobId);
    const delivered = (x: any) => {
      const r = x.shipping_route || jobRoute;
      if (r === "ship_through") return !!x.forwarded_at;
      if (r === "stage") return !!x.webstore_entered_at;
      return x.pipeline_stage === "shipped"; // drop_ship
    };
    const allDelivered = (allItems || []).length > 0 && (allItems || []).every(delivered);
    if (allDelivered) {
      await supabase.from("jobs").update({ fulfillment_status: "shipped", fulfillment_tracking: (tracking || "").trim() || null, phase: "complete" }).eq("id", jobId);
      logJobActivity(jobId, "All items shipped — invoice ready to update with shipped qtys");
    }
    return allDelivered;
  }

  async function markReceived(item: WarehouseItem, opts?: { condition?: string; notes?: string; skipSideEffects?: boolean; skipClientEmail?: boolean; deliveredQtys?: Record<string, number> }) {
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

    // Wave-aware "fully received": an item is only done receiving when the
    // received total catches up to the shipped total — OR the item is fully
    // shipped (all waves out), in which case a short receive is a final
    // variance, not "more coming". A partial item still awaiting later waves
    // stays received_at_hpd=false so it remains in the pending list.
    // "Received" = caught up to everything shipped so far. A fully-shipped item
    // whose later waves are still in transit stays pending until they land
    // (Jon's decision: hold until all units arrive, forward once). A deliberate
    // short receipt also stays pending as a variance to resolve.
    // Box-centric receive: the receiver confirms what arrived in THIS receipt
    // (opts.deliveredQtys), which defaults to the OUTSTANDING balance — what's
    // shipped so far minus what's already been received in earlier boxes. New
    // cumulative received = prior + this receipt. This is why a second wave's
    // box shows "13 to receive" (its own contents), not the item's cumulative
    // 25 — and receiving it adds 13, landing at 25, instead of double-counting.
    // A box-scoped item view (from a persisted shipment box): ship_qtys /
    // received_qtys are THIS box's numbers, and _cumReceivedQtys is the item's
    // running cumulative across all boxes. A legacy item view carries the
    // cumulative directly in received_qtys.
    const isBox = !!item._shipmentId;
    const priorCumulative = isBox ? (item._cumReceivedQtys || {}) : (item.received_qtys || {});
    // Outstanding for THIS box (or item) = what it shipped minus what it already
    // has received (box: line qtys; legacy: cumulative).
    const outstanding = subtractQtys(item.ship_qtys || {}, item.received_qtys || {});
    const deliveredThis = (opts?.deliveredQtys && Object.keys(opts.deliveredQtys).length > 0)
      ? opts.deliveredQtys
      : outstanding;
    const targetReceived = addQtys(priorCumulative, deliveredThis);

    // Non-quantity audit fields + samples are a direct write; the ledger owns
    // received_qtys / received_at_hpd (recompute reprojects them).
    const auxUpdates: any = { receiving_data: receivingData };
    if (item.sample_qtys && Object.keys(item.sample_qtys).length > 0) {
      auxUpdates.sample_qtys = item.sample_qtys;
    }
    await supabase.from("items").update(auxUpdates).eq("id", item.id);

    // Ledger: append this receipt (delta vs the ledger's prior receive total)
    // and recompute — sets received_qtys + received_at_hpd. received_at_hpd goes
    // true only when received catches up to everything shipped (holds a
    // partially-arrived wave item pending, per Jon's "forward once" rule).
    await recordReceive(supabase, {
      itemId: item.id, jobId: item.job_id, targetReceived,
      shipmentId: item._shipmentId || null,   // link the receipt to its box
      reason: opts?.notes || null, description: item.name,
    });

    // Handoff spine (mig 117): mark THIS box's line received (box-scoped view),
    // else fall back to the item's open lines (legacy). Flip the shipment to
    // received once its last line lands.
    if (isBox && item._lineId && item._shipmentId) {
      await supabase.from("shipment_lines").update({
        received: true, received_at: now, received_qtys: deliveredThis,
        condition: opts?.condition || "good", notes: (opts?.notes || "").trim() || null,
      }).eq("id", item._lineId);
      const { count } = await supabase.from("shipment_lines")
        .select("id", { count: "exact", head: true })
        .eq("shipment_id", item._shipmentId).eq("received", false);
      if ((count ?? 0) === 0) {
        await supabase.from("shipments").update({ status: "received", received_at: now, received_by: user?.id || null }).eq("id", item._shipmentId);
      }
      // Optimistic: flip the box's line locally so it moves to the Received tab.
      setBoxes(prev => ({
        shipments: prev.shipments.map(s => s.id === item._shipmentId ? { ...s, received_at: s.received_at || now } : s),
        lines: prev.lines.map(l => l.id === item._lineId ? { ...l, received: true, received_at: now, received_qtys: deliveredThis } : l),
      }));
    } else {
      await receiveShipmentLineForItem(supabase, item.id, {
        received_qtys: deliveredThis,
        condition: opts?.condition || "good",
        notes: opts?.notes || null,
      });
    }

    // Activity log — capture per-size totals for the audit trail.
    // "Atomic Tee received at warehouse — 76/76 delivered, 2 samples pulled
    //  (74 continuing) (damaged) — minor scuffing on neckline"
    const sumPerSize = (q: Record<string, number> | null | undefined) =>
      Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    // CUMULATIVE shipped across all waves (a box-scoped item's ship_qtys is only
    // THIS box, so read the carried cumulative). Keeps the log + caught-up check
    // on one basis: cumulative received vs cumulative shipped.
    const cumShipped = sumPerSize(
      item._cumShippedQtys && Object.keys(item._cumShippedQtys).length ? item._cumShippedQtys : item.ship_qtys
    ) || sumPerSize(item.qtys);
    const deliveredTotal = sumPerSize(targetReceived);   // cumulative received
    const thisReceiptTotal = sumPerSize(deliveredThis);
    const samplesTotal = sumPerSize(item.sample_qtys);
    const continuingTotal = Math.max(0, deliveredTotal - samplesTotal);
    const variance = deliveredTotal - cumShipped;

    const parts: string[] = [`${thisReceiptTotal} received (${deliveredTotal}/${cumShipped} total)`];
    if (samplesTotal > 0) {
      parts.push(`${samplesTotal} sample${samplesTotal === 1 ? "" : "s"} pulled (${continuingTotal} continuing)`);
    }
    if (variance !== 0) {
      parts.push(`variance ${variance > 0 ? "+" : ""}${variance}`);
    }
    const conditionTag = opts?.condition && opts.condition !== "good" ? ` (${opts.condition})` : "";
    const notesTag = opts?.notes ? ` — ${opts.notes}` : "";
    logJobActivity(item.job_id, `${item.name} received at warehouse${conditionTag} — ${parts.join(", ")}${notesTag}`);

    // (Pull destinations are logged per-pull by fulfillPull/addPull — the
    // old sample_pulls destination trail that lived here is retired.)

    // Caught up = cumulative received ≥ cumulative shipped (NOT this box's qty),
    // so receiving one box of a multi-wave item doesn't prematurely flip the
    // item to fully-received and let it forward early.
    const caughtUp = deliveredTotal >= cumShipped;
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_qtys: targetReceived, received_at_hpd: caughtUp, received_at_hpd_at: caughtUp ? now : null, receiving_data: receivingData as any } : it),
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
      | { condition?: string; notes?: string; deliveredQtys?: Record<string, number> }
      | ((it: WarehouseItem) => { condition?: string; notes?: string; deliveredQtys?: Record<string, number> }),
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
      // production_complete client email RETIRED (Jon, Aug 3 email audit —
      // "get rid of Production complete"). The all-received computation stays
      // for the callers that branch on it; only the send is gone. The notify
      // route's handler remains for history but nothing fires it.
      void allReceived; void opts;
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
    // Ledger: one stage movement per item (the auditable "staged qty").
    for (const it of items) {
      const base = (it.received_qtys && Object.keys(it.received_qtys).length) ? it.received_qtys : (it.ship_qtys || {});
      await recordOutbound(supabase, {
        itemId: it.id, jobId: it.job_id, type: "stage",
        qtys: outboundQtys(base, (it as any).sample_qtys), description: it.name,
      });
    }
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
    await reverseLastMovement(supabase, item.id, "stage", "Shopify entry undone");
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, webstore_entered_at: null } : it),
    })));
    logJobActivity(item.job_id, `${item.name} — Shopify entry undone`);
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function undoReceived(item: WarehouseItem) {
    // Box-scoped undo: reverse ONLY this box's receipt and un-receive ONLY this
    // box's line — the item's other received boxes are untouched. (Legacy items
    // with no box fall back to reversing the last receipt.)
    if (item._shipmentId) {
      await reverseReceiptForShipment(supabase, item.id, item._shipmentId, "Receipt undone");
      if (item._lineId) {
        await supabase.from("shipment_lines").update({ received: false, received_at: null, received_qtys: null }).eq("id", item._lineId);
      }
      const { count } = await supabase.from("shipment_lines").select("id", { count: "exact", head: true }).eq("shipment_id", item._shipmentId).eq("received", true);
      if ((count ?? 0) === 0) {
        await supabase.from("shipments").update({ status: "expected", received_at: null, received_by: null }).eq("id", item._shipmentId);
      }
      setBoxes(prev => ({
        shipments: prev.shipments.map(s => s.id === item._shipmentId ? { ...s, status: (count ?? 0) === 0 ? "expected" : s.status, received_at: (count ?? 0) === 0 ? null : s.received_at } : s),
        lines: prev.lines.map(l => l.id === item._lineId ? { ...l, received: false, received_at: null, received_qtys: null } : l),
      }));
    } else {
      await reverseLastMovement(supabase, item.id, "receive", "Receipt undone");
      await unreceiveShipmentLineForItem(supabase, item.id);
    }
    setJobs(prev => prev.map(j => ({
      ...j, items: j.items.map(it => it.id === item.id ? { ...it, received_at_hpd: false, received_at_hpd_at: null } : it),
    })));
    setTimeout(() => recalcJobPhase(item.job_id), 300);
  }

  async function returnToProduction(item: WarehouseItem) {
    // Item goes back to the decorator — reverse everything shipped/received on
    // the ledger so it reads 0 shipped, 0 received (append-only reversals).
    const st = await recomputeItemFromLedger(supabase, item.id);
    if (st) {
      if (st.shipped > 0) await appendMovement(supabase, { itemId: item.id, jobId: item.job_id, type: "ship", qtys: negate(st.shippedMap), reason: "Returned to production" });
      if (st.received > 0) await appendMovement(supabase, { itemId: item.id, jobId: item.job_id, type: "receive", qtys: negate(st.receivedMap), reason: "Returned to production" });
      await recomputeItemFromLedger(supabase, item.id);
    }
    await supabase.from("items").update({
      pipeline_stage: "in_production",
      received_at_hpd: false,
      received_at_hpd_at: null,
      received_qtys: null,
    }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", item.decorator_assignment_id);
    }
    // The item is back at the decorator — its box manifest no longer includes
    // it. Un-receive the line first (remove only touches received=false rows).
    await unreceiveShipmentLineForItem(supabase, item.id);
    await removeShipmentLineForItem(supabase, item.id);
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

  // Split into sections. Route is resolved PER ITEM (per-item override → job
  // route) — a drop-ship job can carry a ship_through/stage item (vendor
  // default route), and that item must surface here even though the job route
  // differs. drop_ship items are already filtered out of j.items upstream, so
  // "every received" gates on the items that actually come to HPD.
  // fulfillment_status === "shipped" means the ship-out is already done — drop
  // it from both lists. (Needed for mixed jobs where the job phase stays
  // non-complete because of still-in-production drop_ship items, so the job
  // never falls out of the warehouse query on its own.)
  const effRoute = (j: any, it: any) => it.shipping_route || j.shipping_route;
  const incoming = jobs.filter(j => j.items.some(it => !it.received_at_hpd));
  // Ship-through is WAVE-based: a job surfaces once its first ship-through item
  // lands (received) and stays until EVERY ship-through item is forwarded — so
  // you can forward what's landed and the rest show as "awaiting". (Old jobs
  // completed under the job-level model carry fulfillment_status="shipped" and
  // no forwarded_at; the guard keeps them from re-surfacing.)
  const shipThrough = jobs.filter(j => {
    if (j.fulfillment_status === "shipped") return false;
    const st = j.items.filter(it => effRoute(j, it) === "ship_through");
    return st.length > 0 && st.some(it => it.received_at_hpd) && !st.every(it => !!it.forwarded_at);
  });
  const fulfillment = jobs.filter(j => j.fulfillment_status !== "shipped" && j.items.length > 0 && j.items.every(it => it.received_at_hpd) && j.items.some(it => effRoute(j, it) === "stage"));

  return {
    loading, jobs, setJobs, boxes, incoming, shipThrough, fulfillment,
    updateReceivedQty, updateSampleQty, forwardItems, markReceived, bulkMarkReceived, undoReceived, returnToProduction,
    fulfillPull, addPull, cancelPull,
    bulkMarkWebstoreEntered, undoWebstoreEntered,
    updateFulfillment, debounceFulfillmentTracking,
    supabase, logJobActivity,
  };
}

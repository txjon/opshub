import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortSizes } from "@/lib/theme";
import { resolveItemStatus, clientItemStatus, type ItemState } from "@/lib/item-status";
import { deriveDateChain } from "@/lib/date-chain";
import { approvePackage, requestChanges } from "@/lib/portal/approval-actions";
// Client Hub per-order detail.
// Mirrors /api/portal/[token] (the old per-job portal) but auth'd via the
// client's portal_token + verifies the jobId belongs to that client.
// Response shape + POST action surface are IDENTICAL to the old portal so
// the new Client Hub order-detail page can be a straight clone.

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

async function authAndLoadJob(token: string, jobId: string) {
  const sb = admin();
  const { data: client } = await sb
    .from("clients")
    .select("id, name, companies:company_id(slug, default_payment_provider)")
    .eq("portal_token", token)
    .single();
  if (!client) return { error: "Invalid link", status: 404 as const };

  const { data: job, error: jobErr } = await sb
    .from("jobs")
    .select(
      "id, title, job_number, phase, payment_terms, target_ship_date, type_meta, quote_approved, quote_approved_at, costing_data, costing_summary, client_id, shipping_route, portal_token, phase_timestamps"
    )
    .eq("id", jobId)
    .eq("client_id", client.id)
    .single();

  if (jobErr || !job) return { error: "Not found", status: 404 as const };
  return { sb, client, job };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string; jobId: string } }
) {
  try {
    const auth = await authAndLoadJob(params.token, params.jobId);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { sb, client, job } = auth;

    const clientName = client.name;

    // Other projects for this client (for Client Hub sidebar / navigation)
    let clientProjects: any[] = [];
    if (job.client_id) {
      const { data: allJobs } = await sb
        .from("jobs")
        .select("id, title, job_number, phase, target_ship_date, portal_token, type_meta, quote_approved, costing_data")
        .eq("client_id", job.client_id)
        .not("phase", "eq", "cancelled")
        .order("target_ship_date", { ascending: true, nullsFirst: false });
      clientProjects = (allJobs || []).map((j: any) => {
        const costProds = (j.costing_data as any)?.costProds || [];
        const itemCount = costProds.length;
        const unitCount = costProds.reduce((s: number, cp: any) => s + (cp.totalQty || Object.values(cp.qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0)), 0);
        // Sidebar invoice number is gated on invoice_sent_at — same rule
        // as the main view, so a project pushed to QB but not yet sent
        // doesn't surface its number on the side-nav either.
        const sentAt = (j.type_meta as any)?.invoice_sent_at;
        const tmJ = (j.type_meta as any) || {};
        const sidebarInvNum = sentAt
          ? (((client as any).companies?.default_payment_provider === "stripe" ? tmJ.stripe_invoice_number : tmJ.qb_invoice_number) || null)
          : null;
        return {
          jobId: j.id,
          title: j.title,
          jobNumber: j.job_number,
          phase: j.phase,
          shipDate: j.target_ship_date,
          portalToken: j.portal_token,
          invoiceNumber: sidebarInvNum,
          isComplete: j.phase === "complete",
          itemCount,
          unitCount,
        };
      });
    }

    const { data: items } = await sb
      .from("items")
      .select(
        "id, name, sell_per_unit, pipeline_stage, sort_order, artwork_status, ship_qtys, received_qtys, blank_vendor, blank_sku, ship_tracking, forward_tracking, archived_at, completed_at, received_at_hpd, blanks_order_cost, shipping_route, forwarded_at, webstore_entered_at, client_eta, client_eta_note, expected_arrival, ship_est, proof_spec, proof_sent_at, decorator_assignments(decorators(name, short_code, lead_time_days, transit_defaults)), buy_sheet_lines(size, qty_ordered)"
      )
      .eq("job_id", job.id)
      .order("sort_order");

    // Live box arrivals — receiving-side chain override for the per-item ETA
    // (mirrors the items endpoint).
    const boxArrivalByItem: Record<string, string> = {};
    {
      const ids = (items || []).map((i: any) => i.id);
      if (ids.length > 0) {
        const { data: openLines } = await sb
          .from("shipment_lines")
          .select("item_id, received, shipments(expected_arrival)")
          .in("item_id", ids).eq("received", false);
        for (const l of (openLines || [])) {
          const ea = (l as any).shipments?.expected_arrival;
          if (!ea) continue;
          if (!boxArrivalByItem[l.item_id] || ea > boxArrivalByItem[l.item_id]) boxArrivalByItem[l.item_id] = ea;
        }
      }
    }

    // Pre-compute po_sent_vendors as a lowercased set so the per-item
    // canonical status resolver knows whether a PO has been sent for
    // that item's decorator. Mirrors the items endpoint.
    const poSentVendors = new Set(
      (((job.type_meta as any)?.po_sent_vendors || []) as string[])
        .map(s => (s || "").toLowerCase().trim())
        .filter(Boolean)
    );
    const phaseTimestamps = ((job as any).phase_timestamps || {}) as any;
    function statusForItem(it: any): ItemState {
      const assignment = it?.decorator_assignments?.[0];
      const decName = assignment?.decorators?.name || null;
      const decShort = assignment?.decorators?.short_code || null;
      const poSent = !!(
        (decName && poSentVendors.has(decName.toLowerCase())) ||
        (decShort && poSentVendors.has(decShort.toLowerCase()))
      );
      return resolveItemStatus({
        archived_at: it?.archived_at,
        completed_at: it?.completed_at,
        pipeline_stage: it?.pipeline_stage,
        received_at_hpd: !!it?.received_at_hpd,
        sell_per_unit: it?.sell_per_unit != null ? Number(it.sell_per_unit) : null,
        blanks_order_cost: it?.blanks_order_cost != null ? Number(it.blanks_order_cost) : null,
        po_sent: poSent,
        job_phase: job.phase || null,
        job_shipping_route: (job as any).shipping_route || null,
        item_shipping_route: it?.shipping_route || null,
        job_completed_at: phaseTimestamps?.complete || null,
        forwarded_at: it?.forwarded_at || null,
      });
    }

    const itemIds = (items || []).map((i: any) => i.id);

    // Per-shipment list — only CLIENT-FACING shipments:
    //  - drop_ship items: the vendor→client direct shipment (ship_tracking).
    //  - ship_through items: the aggregated HPD→client forward (forward_tracking).
    // The inbound vendor→HPD leg of a ship-through item (its ship_tracking) is
    // internal logistics and is NOT surfaced. Vendor name is never returned
    // (drop_ship anonymity); decoratorId only lets the PDF scope the slip.
    const jobRoute = (job as any).shipping_route || "ship_through";
    let shipments: Array<{ decoratorId: string | null; tracking: string; itemCount: number; forwardTracking?: string }> = [];
    if (itemIds.length > 0) {
      const { data: assignments } = await sb
        .from("decorator_assignments")
        .select("item_id, decorator_id")
        .in("item_id", itemIds);
      const decByItem: Record<string, string | null> = {};
      for (const a of (assignments || [])) {
        decByItem[(a as any).item_id] = (a as any).decorator_id || null;
      }
      // Belt-and-suspenders: a drop_ship item's ship_tracking must belong to an
      // OUTBOUND (vendor→client) shipment. If it's an INBOUND (vendor→HPD) leg —
      // e.g. a drop-ship item wrongly bundled into an inbound multi-select — that
      // tracking is internal logistics and must NEVER surface to the client.
      const dsIds = (items || [])
        .filter((it: any) => ((it.shipping_route || jobRoute) === "drop_ship") && it.ship_tracking)
        .map((it: any) => it.id);
      const inboundItems = new Set<string>();
      if (dsIds.length > 0) {
        // Link via the LEDGER (shipment_id), not the tracking string — item
        // ship_tracking and shipments.tracking can differ in case/entry.
        const { data: mv } = await sb.from("movements").select("item_id, shipment_id").in("item_id", dsIds).not("shipment_id", "is", null);
        const shipIds = [...new Set((mv || []).map((m: any) => m.shipment_id))];
        if (shipIds.length > 0) {
          const { data: sh } = await sb.from("shipments").select("id, direction").in("id", shipIds);
          const inboundShipIds = new Set((sh || []).filter((s: any) => s.direction === "inbound").map((s: any) => s.id));
          for (const m of (mv || [])) if (inboundShipIds.has((m as any).shipment_id)) inboundItems.add((m as any).item_id);
        }
      }
      const grouped: Record<string, { decoratorId: string | null; tracking: string; itemCount: number; forwardTracking?: string }> = {};
      for (const it of (items || [])) {
        const route = (it as any).shipping_route || jobRoute;
        if (route === "drop_ship") {
          if (it.pipeline_stage !== "shipped" || !it.ship_tracking || inboundItems.has(it.id)) continue;
          const decId = decByItem[it.id] || null;
          const key = `ds__${decId || ""}__${it.ship_tracking}`;
          if (!grouped[key]) grouped[key] = { decoratorId: decId, tracking: it.ship_tracking, itemCount: 0 };
          grouped[key].itemCount++;
        } else if (route === "ship_through") {
          if (!(it as any).forward_tracking) continue;
          const key = `fw__${(it as any).forward_tracking}`;
          if (!grouped[key]) grouped[key] = { decoratorId: null, tracking: (it as any).forward_tracking, forwardTracking: (it as any).forward_tracking, itemCount: 0 };
          grouped[key].itemCount++;
        }
        // stage → client ship handled by ShipStation/Shopify, not listed here
      }
      shipments = Object.values(grouped);
    }

    // Live carrier status (EasyPost-fed, Phase 4): enrich each client-facing
    // shipment with its box's tracker fields, matched by tracking number.
    // Carrier name is safe to show; vendor identity still never leaves here.
    let shipmentsLive: any[] = shipments;
    if (shipments.length > 0) {
      const trks = shipments.map((s) => s.tracking).filter(Boolean);
      const { data: liveBoxes } = await sb
        .from("shipments")
        .select("tracking, carrier_status, carrier_detected, est_delivery_date, delivered_at, last_scan")
        .in("tracking", trks);
      const liveByTrk = new Map<string, any>();
      for (const b of (liveBoxes || []) as any[]) {
        if (!liveByTrk.has(b.tracking) || b.delivered_at) liveByTrk.set(b.tracking, b);
      }
      shipmentsLive = shipments.map((s) => {
        const lv = liveByTrk.get(s.tracking);
        if (!lv) return s;
        return {
          ...s,
          carrier: lv.carrier_detected || null,
          carrierStatus: lv.carrier_status || null,
          estDelivery: lv.est_delivery_date || null,
          deliveredAt: lv.delivered_at || null,
          lastScanLocation: lv.last_scan?.location || null,
        };
      });
    }

    let proofFiles: any[] = [];
    if (itemIds.length > 0) {
      const { data: files } = await sb
        .from("item_files")
        .select(
          "id, item_id, file_name, stage, approval, approved_at, drive_file_id, drive_link, created_at"
        )
        .in("item_id", itemIds)
        .in("stage", ["mockup", "proof"])
        .is("superseded_at", null)
        .order("created_at", { ascending: false });
      proofFiles = files || [];
    }

    const { data: payments } = await sb
      .from("payment_records")
      .select("id, type, amount, status, due_date, paid_date, invoice_number")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false });

    const { data: rawActivity } = await sb
      .from("job_activity")
      .select("id, message, created_at")
      .eq("job_id", job.id)
      .eq("type", "auto")
      .order("created_at", { ascending: false })
      .limit(50);

    // Group drop-ship per-item "shipped — tracking X" by tracking → one line.
    // Same tracking = same shipment, even if items were marked 10 min apart.
    const shipByTrack: Record<string, number> = {};
    const trackOf = (m: string) => (m.match(/ shipped — tracking:?\s*(.+?)\s*$/i) || [])[1] || "";
    const isDropShipShip = (m: string) => / shipped — tracking/i.test(m) && !/decorator|warehouse|production|forwarded/i.test(m);
    for (const a of (rawActivity || [])) {
      if (isDropShipShip(a.message || "")) { const t = trackOf(a.message); if (t) shipByTrack[t] = (shipByTrack[t] || 0) + 1; }
    }
    const emittedTracks = new Set<string>();
    const activity: any[] = [];
    const seen = new Set<string>();
    for (const a of (rawActivity || [])) {
      const msg = (a.message || "");
      if (/po sent|blanks|psd|costing|decorator|stage advanced|auto-email|buy sheet|assigned|reorder|qb invoice|auto-created|confirmation sent|proof generated|product proof|created in quickbooks|item created|created —|file uploaded|files uploaded|uploaded for|mockup generated|returned to production/i.test(msg)) continue;

      let clientMsg: string | null = null;
      if (/quote sent to client/i.test(msg)) clientMsg = "Quote delivered";
      else if (/quote approved/i.test(msg)) clientMsg = "Quote approved";
      else if (/quote rejected|revision requested/i.test(msg) && /quote/i.test(msg)) clientMsg = msg;
      else if (/invoice sent to client/i.test(msg)) {
        const provider = ((client as any).companies?.default_payment_provider || "quickbooks") as string;
        const tmInv = (job.type_meta as any) || {};
        const invNum = provider === "stripe" ? tmInv.stripe_invoice_number : tmInv.qb_invoice_number;
        clientMsg = invNum ? `Invoice #${invNum} delivered` : "Invoice delivered";
      }
      else if (/invoice \+ proofs sent/i.test(msg)) clientMsg = "Invoice and proofs delivered";
      else if (/payment received/i.test(msg)) clientMsg = msg;
      else if (/proof approved by client/i.test(msg)) {
        const match = msg.match(/for (.+)$/);
        clientMsg = match ? `${match[1]} proof approved` : "Proof approved";
      }
      else if (/proofs sent to client/i.test(msg)) clientMsg = "Proofs delivered";
      // Internal "All items shipped — invoice ready to update…" → strip the
      // ops invoicing tail; the client just needs the shipped milestone.
      else if (/all items shipped/i.test(msg)) clientMsg = "All Items Shipped";
      // Outbound forward — reword the internal "Forwarded N to client" log.
      else if (/forwarded \d+ items? to client/i.test(msg)) {
        const m = msg.match(/forwarded (\d+) items?.*?tracking[: ]+(.+?)\s*$/i);
        clientMsg = m ? `${m[1]} item${m[1] === "1" ? "" : "s"} shipped — tracking ${m[2]}` : "Your order shipped";
      }
      // Drop-ship per-item ship → one grouped line per tracking.
      else if (isDropShipShip(msg)) {
        const trk = trackOf(msg);
        if (emittedTracks.has(trk)) continue;
        emittedTracks.add(trk);
        const n = shipByTrack[trk] || 1;
        clientMsg = `${n} item${n === 1 ? "" : "s"} shipped — tracking ${trk}`;
      }
      else if (/shipped|tracking/i.test(msg) && !/decorator|warehouse|production/i.test(msg)) {
        // Scrub vendor / decorator names from shipped messages — the
        // client never needs to know which printer touched the order.
        // "Shipped by Battle Maple — Tee 3-PACK · Tracking: …" becomes
        // "Tee 3-PACK shipped · Tracking: …". Same de-anonymization
        // rule the shipments list applies.
        clientMsg = msg.replace(/^Shipped by [^—]+—\s*/i, "").replace(/^(.+?) · Tracking/i, "$1 shipped · Tracking");
      }

      if (!clientMsg) continue;
      if (seen.has(clientMsg)) continue;
      seen.add(clientMsg);

      activity.push({ ...a, message: clientMsg });
      if (activity.length >= 15) break;
    }

    const thumbnailMap: Record<string, string> = {};
    const seenThumb = new Set<string>();
    for (const f of proofFiles) {
      if (!seenThumb.has(f.item_id) && f.drive_file_id) {
        seenThumb.add(f.item_id);
        thumbnailMap[f.item_id] = f.drive_file_id;
      }
    }

    const costingData = job.costing_data as any;
    const costingSummary = job.costing_summary as any;
    const variancePushed = !!((job.type_meta as any)?.qb_variance_pushed_at || (job.type_meta as any)?.stripe_variance_pushed_at);
    const quoteItems: any[] = [];

    if (costingData?.costProds) {
      const costProds = costingData.costProds;
      for (const cp of costProds) {
        let item = (items || []).find((i: any) => i.id === cp.id);
        if (!item && cp.name) item = (items || []).find((i: any) => i.name === cp.name);

        let effectiveQtys: Record<string, number>;
        if (variancePushed && item) {
          const received = (item.received_qtys || {}) as Record<string, number>;
          const shipped = (item.ship_qtys || {}) as Record<string, number>;
          // Per-item route wins over the job route (migration 076).
          const itemRoute = (item as any).shipping_route || job.shipping_route;
          const prefersReceived = itemRoute === "ship_through" || itemRoute === "stage";
          const firstChoice = prefersReceived ? received : shipped;
          const secondChoice = prefersReceived ? shipped : received;
          const ordered = cp.qtys || {};
          effectiveQtys = {};
          for (const sz of Object.keys(ordered)) {
            const a = firstChoice[sz];
            const b = secondChoice[sz];
            effectiveQtys[sz] = a !== undefined ? a : b !== undefined ? b : (ordered[sz] || 0);
          }
        } else {
          effectiveQtys = cp.qtys || {};
        }

        let totalQty = Object.values(effectiveQtys).reduce(
          (a: number, v: any) => a + (Number(v) || 0),
          0
        );
        // the variance modal stores the qtys ACTUALLY billed — when present,
        // they beat raw shipped/received (Drake may have adjusted at finalize)
        const billable = variancePushed && item ? (((job.type_meta as any)?.qb_variance_billable_qtys) || {})[item.id] : undefined;
        if (billable != null && Number(billable) > 0) totalQty = Number(billable);
        if (totalQty <= 0) continue;

        let sellPerUnit = parseFloat(item?.sell_per_unit) || 0;
        if (sellPerUnit === 0 && cp.sellOverride) sellPerUnit = parseFloat(cp.sellOverride) || 0;
        if (sellPerUnit === 0 && costingSummary?.grossRev && costingSummary?.totalUnits) {
          sellPerUnit = Math.round((costingSummary.grossRev / costingSummary.totalUnits) * 100) / 100;
        }
        const grossRev = Math.round(sellPerUnit * totalQty * 100) / 100;

        quoteItems.push({
          name: cp.name || item?.name || "Item",
          style: cp.style || item?.blank_sku || "",
          color: cp.color || "",
          sizes: sortSizes(Object.keys(effectiveQtys).filter(sz => (effectiveQtys[sz] || 0) > 0)),
          qtys: effectiveQtys,
          qty: totalQty,
          sellPerUnit,
          total: grossRev,
          // Per-item canonical status — same vocabulary the Items tab
          // uses, so the client sees a consistent state model across
          // every surface (item card · order detail · history).
          status: item ? clientItemStatus(statusForItem(item), item.shipping_route || (job as any).shipping_route || null) : ("setup" as ItemState),
        });
      }
    }

    const typeMeta = (job.type_meta || {}) as any;

    // Non-item invoice lines (service fees, passthru charges, discounts) added
    // in OpsHub via type_meta.invoice_extra_lines. They live only in QB today,
    // which made the items-only subtotal diverge from the QB total and tripped
    // the invoiceStale "being updated" banner. Including them everywhere the
    // subtotal is computed keeps OpsHub matching the QuickBooks invoice.
    const extraLines = (Array.isArray(typeMeta.invoice_extra_lines) ? typeMeta.invoice_extra_lines : [])
      .map((l: any) => ({ description: String(l?.description || "Additional charge"), amount: Number(l?.amount) || 0 }));
    const extraTotal = extraLines.reduce((a: number, l: any) => a + l.amount, 0);
    // Display shape mirrors QB (qty 1 × amount); status null so no per-item pill.
    const extraQuoteItems = extraLines.map((l: any) => ({
      name: l.description, style: "", color: "", sizes: [], qtys: {},
      qty: 1, sellPerUnit: l.amount, total: l.amount, status: null,
    }));

    const itemsWithProofs = (items || []).map((item: any) => {
      const manualApproved = item.artwork_status === "approved";
      const itemProofs = proofFiles
        .filter((f: any) => f.item_id === item.id)
        .map((f: any) => ({
          id: f.id,
          fileName: f.file_name,
          stage: f.stage,
          approval: manualApproved ? "approved" : (f.approval || "none"),
          approvedAt: f.approved_at || null,
          driveLink: f.drive_link,
          driveFileId: f.drive_file_id,
          createdAt: f.created_at,
        }));
      // Total qty from buy sheet lines (pre-ship). Status per the
      // canonical resolver so this list reads with the same vocabulary
      // as the Items tab and the order row's hover summary.
      const qty = (item.buy_sheet_lines || []).reduce(
        (a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0
      );
      // Per-item ETA — derived forward from current actuals. Suppressed for items
      // past the in-transit phase (in_stock / complete / archived / cancelled)
      // — once it's at HPD the original prediction is fulfilled.
      // eta_tbd flags active items with no ETA set yet so the frontend
      // can render "TBD" instead of an em-dash.
      const status = statusForItem(item);
      // etaCutOff uses the INTERNAL status (in_stock = at HPD, ETA is moot);
      // the client only ever sees the collapsed status (locked model).
      const etaCutOff = status === "in_stock" || status === "complete" || status === "archived" || status === "cancelled";
      // Chain-resolved ETA (date model 2026-07-23): derived from PO ship-by, the
      // per-item ship/exit-factory edit (ship_est) in production, then the actual
      // land date (box expected_arrival) in receiving, + transit + route buffer.
      // client_eta is retired. in-hands is a note, not an ETA source.
      const etaDate = etaCutOff ? null : (() => {
        const dec = item.decorator_assignments?.[0]?.decorators || null;
        const tm = (job.type_meta || {}) as any;
        const keys = [dec?.name, dec?.short_code].filter(Boolean).map((s: string) => s.toLowerCase().trim());
        const findKey = (map: any): string | null => {
          if (!map) return null;
          for (const k of Object.keys(map)) if (keys.includes(k.toLowerCase().trim())) return k;
          return null;
        };
        const aK = findKey(tm.po_ship_dates), lK = findKey(tm.po_ship_live), mK = findKey(tm.po_ship_methods), sK = findKey(tm.po_sent_dates);
        return deriveDateChain({
          route: (item.shipping_route || job.shipping_route || "ship_through") as any,
          lead: dec?.lead_time_days ?? null,
          transitDefaults: dec?.transit_defaults || null,
          shipMethod: mK ? tm.po_ship_methods[mK] : null,
          poSentDate: sK ? tm.po_sent_dates[sK] : null,
          shipByAgreed: aK ? tm.po_ship_dates[aK] : null,
          shipByLive: lK ? tm.po_ship_live[lK]?.date : null,
          shipByItemOverride: item.ship_est || null,
          arrivalOverride: boxArrivalByItem[item.id] || item.expected_arrival || null,
        }).clientEta;
      })();
      const eta_tbd = !etaCutOff && !etaDate;
      const lines = (item.buy_sheet_lines || []) as any[];
      return {
        id: item.id,
        name: item.name,
        qty,
        status: clientItemStatus(status, item.shipping_route || (job as any).shipping_route || null),
        eta: etaDate,
        eta_tbd,
        eta_note: item.client_eta_note || null,
        proofs: itemProofs,
        // OrderExperience fields (shop-skin order view) — same shapes as the
        // per-job portal API so the shared component serves both doors.
        units: qty,
        sizes: Object.fromEntries(lines.filter((l: any) => l.qty_ordered > 0 && l.size).map((l: any) => [l.size, l.qty_ordered])),
        sellPerUnit: item.sell_per_unit ?? null,
        blankVendor: item.blank_vendor || null,
        blankSku: item.blank_sku || null,
        pipelineStage: item.pipeline_stage || null,
        shippingRoute: item.shipping_route || (job as any).shipping_route || "ship_through",
        receivedAtHpd: !!item.received_at_hpd,
        forwardedAt: item.forwarded_at || null,
        webstoreEnteredAt: item.webstore_entered_at || null,
        shipTracking: item.ship_tracking || null,
        internalApproved: manualApproved,
        proofSpec: item.proof_spec || null,
        proofSentAt: item.proof_sent_at || null,
      };
    });

    const phaseLabels: Record<string, string> = {
      intake: "Setting Up",
      pending: "Awaiting Approval",
      ready: "In Preparation",
      production: "In Production",
      receiving: "Shipping",
      fulfillment: "Shipping",
      complete: "Complete",
      on_hold: "On Hold",
      cancelled: "Cancelled",
    };

    // Quote section visibility is gated on quote_sent_at — until OpsHub
    // actually emails the quote, the per-line quote breakdown is hidden
    // in the portal. Supports the "draft internally, send invoice when
    // ready" flow where the client never sees a separate quote step.
    //
    // BUT the order total + tax need to be visible whenever EITHER the
    // quote or the invoice has been sent — otherwise the Payment block
    // on a skip-the-quote invoice would show Total: $0 even when the
    // client has been billed. Track that gate separately.
    // "Sent" for portal purposes = the client legitimately has this quote in
    // front of them. Jobs approved INTERNALLY (client PO by email/phone) never
    // set quote_sent_at — without this OR, the portal hid the quote AND the
    // whole approval panel, leaving revised proofs unapprovable (HPD-2606-038).
    const isQuoteSent = !!typeMeta.quote_sent_at || !!job.quote_approved;
    const isInvoiceSent = !!typeMeta.invoice_sent_at;
    // A pushed QB invoice (or Stripe invoice) means the client has been billed,
    // so the total must show even if OpsHub never emailed the quote/invoice
    // itself — otherwise the Payment block reads Total: $0 on a billed order
    // (e.g. invoice created + sent directly from QuickBooks).
    const showTotals = isQuoteSent || isInvoiceSent || !!typeMeta.qb_invoice_id || !!typeMeta.stripe_invoice_number;
    const portalQuoteItems = isQuoteSent ? [...quoteItems, ...extraQuoteItems] : [];

    return NextResponse.json({
      // PDF routes (invoice + quote) auth via the job's portal_token, not
      // the client's. Return it at the top level so the Client Hub page
      // can build valid PDF URLs.
      jobPortalToken: job.portal_token,
      project: {
        id: job.id,
        title: job.title,
        jobNumber: job.job_number,
        phase: job.phase,
        phaseLabel: phaseLabels[job.phase] || job.phase,
        shipDate: job.target_ship_date,
        // quoteApproved badge is meaningless to a client who never saw
        // the quote — gate on quote_sent_at too.
        quoteApproved: isQuoteSent ? job.quote_approved : false,
        quoteApprovedAt: isQuoteSent ? job.quote_approved_at : null,
        changeRequest: (job.type_meta as any)?.change_request || null,
        paymentTerms: job.payment_terms,
      },
      client: { name: clientName },
      // Tenant slug drives which Order Terms set the approval confirm shows —
      // same source (lib/order-terms) as the quote PDF footer.
      company: { slug: (client as any).companies?.slug || "hpd" },
      quote: {
        items: portalQuoteItems,
        subtotal: portalQuoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0),
        tax: showTotals ? (typeMeta.qb_tax_amount || 0) : 0,
        // Total comes from QB when pushed; falls back to the
        // server-computed quoteItems sum (NOT portalQuoteItems —
        // those are gated separately on quote_sent_at, but the
        // total should reflect what's owed even when the quote
        // breakdown is hidden).
        total: showTotals
          ? (typeMeta.qb_total_with_tax || (typeMeta.stripe_total_cents ? typeMeta.stripe_total_cents / 100 : 0) || quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0))
          : 0,
      },
      currentTotal: (() => {
        // Live order value — powers the payment band's "Updated total" on
        // revised-after-invoice jobs. AFTER a variance finalize the QB total
        // IS the live value (they were billed actuals; costing gross is the
        // ordered world and must not resurface as an "update" — HPD-2606-002
        // showed $14,304 against a finalized $14,178.75 invoice).
        if (variancePushed) {
          const t = Number(typeMeta.qb_total_with_tax) || 0;
          return showTotals && t > 0 ? Math.round(t * 100) / 100 : null;
        }
        const extrasTotal = (Array.isArray(typeMeta.invoice_extra_lines) ? typeMeta.invoice_extra_lines : [])
          .reduce((a: number, l: any) => a + (Number(l?.amount) || 0), 0);
        const gross = Number(costingSummary?.grossRev) || 0;
        const t = gross + extrasTotal;
        return showTotals && t > 0 ? Math.round(t * 100) / 100 : null;
      })(),
      invoiceStale: (() => {
        // Only "stale" when OpsHub actually pushed an invoice to QB.
        // Manually-entered invoice numbers have no OpsHub-side QB totals
        // to compare against, so the staleness check would always fire.
        if (!typeMeta.qb_invoice_id) return false;
        const quoteSubtotal = quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0) + extraTotal;
        const qbSubtotal = (typeMeta.qb_total_with_tax || 0) - (typeMeta.qb_tax_amount || 0);
        return Math.abs(quoteSubtotal - qbSubtotal) > 0.01;
      })(),
      items: itemsWithProofs,
      payments: (payments || []).map((p: any) => ({
        id: p.id,
        type: p.type,
        amount: p.amount,
        status: p.status,
        dueDate: p.due_date,
        paidDate: p.paid_date,
        invoiceNumber: p.invoice_number,
      })),
      // Invoice + pay link gated on invoice_sent_at. Provider-aware:
      // Stripe tenants use stripe_invoice_number + our white-label
      // /portal/{job_token}/pay URL. QB tenants use qb_*. Manual
      // payment records (issued/paid) also count as "sent" for legacy
      // out-of-band invoices.
      paymentLink: await (async () => {
        const sent = !!typeMeta.invoice_sent_at || (payments || []).some((p: any) => p.status && !["draft","void"].includes(p.status));
        if (!sent) return null;
        const provider = ((client as any).companies?.default_payment_provider || "quickbooks") as string;
        if (provider === "stripe") {
          if (!(job as any).portal_token) return null;
          const { appBaseUrl } = await import("@/lib/public-url");
          return `${await appBaseUrl()}/portal/${(job as any).portal_token}/pay`;
        }
        return typeMeta.qb_payment_link || null;
      })(),
      invoiceNumber: ((typeMeta.invoice_sent_at || (payments || []).some((p: any) => p.status && !["draft","void"].includes(p.status)))
        ? (((client as any).companies?.default_payment_provider === "stripe"
            ? typeMeta.stripe_invoice_number
            : typeMeta.qb_invoice_number) || null)
        : null),
      activity: (activity || []).map((a: any) => ({
        message: a.message,
        date: a.created_at,
      })),
      shipments: shipmentsLive,
      clientProjects,
    });
  } catch (e: any) {
    console.error("Client Hub per-order GET error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string; jobId: string } }
) {
  try {
    const auth = await authAndLoadJob(params.token, params.jobId);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { sb, job } = auth;

    const body = await req.json();
    const { action, fileId, note } = body;

    // ── Blanket package approval (V2) — shared with the per-job portal via
    //    lib/portal/approval-actions. ──
    if (action === "approve-package") {
      await approvePackage(sb, job.id, { via: params.token });
      return NextResponse.json({ success: true });
    }
    if (action === "request-changes") {
      await requestChanges(sb, job.id, note, body.itemIds);
      return NextResponse.json({ success: true });
    }

    // (Legacy per-item actions removed — blanket approve-package + request-changes
    //  above supersede them; shared in lib/portal/approval-actions.)

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("Client Hub per-order POST error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

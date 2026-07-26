import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortSizes } from "@/lib/theme";
import { approvePackage, requestChanges } from "@/lib/portal/approval-actions";
// Pricing source of truth: items.sell_per_unit

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// ── GET: Fetch portal data for a project (public, token = auth) ──
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const sb = admin();
    const { token } = params;

    // Look up job by portal token
    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select(
        "id, title, job_number, phase, payment_terms, target_ship_date, type_meta, quote_approved, quote_approved_at, costing_data, costing_summary, client_id, shipping_route"
      )
      .eq("portal_token", token)
      .single();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Client name + tenant (for portal branding — logo, wordmark)
    let clientName = "Client";
    let tenant = { name: "House Party Distro", slug: "hpd", default_payment_provider: "quickbooks" };
    if (job.client_id) {
      const { data: client } = await sb
        .from("clients")
        .select("name, companies:company_id(name, slug, default_payment_provider)")
        .eq("id", job.client_id)
        .single();
      if (client) {
        clientName = client.name;
        const t = (client as any).companies;
        if (t?.slug) tenant = { name: t.name, slug: t.slug, default_payment_provider: t.default_payment_provider || "quickbooks" };
      }
    }

    // All projects for this client (sidebar navigation)
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
        // Sidebar invoice number gated on invoice_sent_at — same rule
        // as the main view, so a project pushed to QB but not yet sent
        // doesn't leak its number on the side-nav either.
        const sentAt = (j.type_meta as any)?.invoice_sent_at;
        return {
          jobId: j.id,
          title: j.title,
          jobNumber: j.job_number,
          phase: j.phase,
          shipDate: j.target_ship_date,
          portalToken: j.portal_token,
          invoiceNumber: sentAt ? (((tenant.default_payment_provider === "stripe" ? (j.type_meta as any)?.stripe_invoice_number : (j.type_meta as any)?.qb_invoice_number)) || null) : null,
          isComplete: j.phase === "complete",
          itemCount,
          unitCount,
        };
      });
    }

    // Items (only fields the client should see; ship_qtys/received_qtys needed
    // for post-variance invoice line rendering)
    const { data: items } = await sb
      .from("items")
      .select(
        "id, name, sell_per_unit, pipeline_stage, sort_order, artwork_status, ship_qtys, received_qtys, blank_vendor, blank_sku, ship_tracking, forward_tracking, shipping_route, received_at_hpd, forwarded_at, webstore_entered_at, proof_spec, proof_sent_at, client_eta, expected_arrival, ship_est, buy_sheet_lines(size, qty_ordered)"
      )
      .eq("job_id", job.id)
      .order("sort_order");

    const itemIds = (items || []).map((i: any) => i.id);

    // Per-shipment list — only CLIENT-FACING shipments: drop_ship items'
    // vendor→client direct (ship_tracking) + ship_through items' aggregated
    // HPD→client forward (forward_tracking). The inbound vendor→HPD leg of a
    // ship-through item is internal and NOT surfaced. Vendor name never returned.
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
      // A drop_ship item's ship_tracking must be an OUTBOUND (vendor→client)
      // shipment. An INBOUND (vendor→HPD) tracking is internal — never surface it.
      const dsIds = (items || [])
        .filter((it: any) => ((it.shipping_route || jobRoute) === "drop_ship") && it.ship_tracking)
        .map((it: any) => it.id);
      const inboundItems = new Set<string>();
      if (dsIds.length > 0) {
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
      }
      shipments = Object.values(grouped);
    }

    // Proof/mockup files (only stages clients should see)
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

    // Payment records
    const { data: payments } = await sb
      .from("payment_records")
      .select("id, type, amount, status, due_date, paid_date, invoice_number")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false });

    // Recent auto activity — only client-safe events
    const { data: rawActivity } = await sb
      .from("job_activity")
      .select("id, message, created_at")
      .eq("job_id", job.id)
      .eq("type", "auto")
      .order("created_at", { ascending: false })
      .limit(50);

    // Pre-count drop-ship per-item "shipped — tracking X" entries by tracking,
    // so they collapse into one "N items shipped — tracking X" line. Same
    // tracking = same physical shipment, even if items were marked 10 min apart
    // (vendor lag); the grouped line shows at the most recent confirmation.
    const shipByTrack: Record<string, number> = {};
    const trackOf = (m: string) => (m.match(/ shipped — tracking:?\s*(.+?)\s*$/i) || [])[1] || "";
    const isDropShipShip = (m: string) => / shipped — tracking/i.test(m) && !/decorator|warehouse|production|forwarded/i.test(m);
    for (const a of (rawActivity || [])) {
      if (isDropShipShip(a.message || "")) { const t = trackOf(a.message); if (t) shipByTrack[t] = (shipByTrack[t] || 0) + 1; }
    }
    const emittedTracks = new Set<string>();

    // Only show events the client cares about — whitelist approach
    const activity: any[] = [];
    const seen = new Set<string>();
    for (const a of (rawActivity || [])) {
      const msg = (a.message || "");
      const msgLower = msg.toLowerCase();

      // Skip internal operations
      if (/po sent|blanks|psd|costing|decorator|stage advanced|auto-email|buy sheet|assigned|reorder|qb invoice|auto-created|confirmation sent|proof generated|product proof|created in quickbooks|item created|created —|file uploaded|files uploaded|uploaded for|mockup generated|returned to production/i.test(msg)) continue;

      // Only allow specific client-facing events
      let clientMsg = null;
      if (/quote sent to client/i.test(msg)) clientMsg = "Quote delivered";
      else if (/quote approved/i.test(msg)) clientMsg = "Quote approved";
      else if (/quote rejected|revision requested/i.test(msg) && /quote/i.test(msg)) clientMsg = msg;
      else if (/invoice sent to client/i.test(msg)) {
        const tmInv = (job.type_meta as any) || {};
        const invNum = tenant.default_payment_provider === "stripe" ? tmInv.stripe_invoice_number : tmInv.qb_invoice_number;
        clientMsg = invNum ? `Invoice #${invNum} delivered` : "Invoice delivered";
      }
      else if (/invoice \+ proofs sent/i.test(msg)) clientMsg = "Invoice and proofs delivered";
      else if (/payment received/i.test(msg)) clientMsg = msg;
      else if (/proof approved by client/i.test(msg)) {
        // Consolidate per-item approvals: extract item name, dedupe
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
      else if (/shipped|tracking/i.test(msg) && !/decorator|warehouse|production/i.test(msg)) clientMsg = msg;

      if (!clientMsg) continue;

      // Deduplicate: skip if same message already shown
      if (seen.has(clientMsg)) continue;
      seen.add(clientMsg);

      activity.push({ ...a, message: clientMsg });
      if (activity.length >= 15) break;
    }

    // Build thumbnail map: item_id → first mockup/proof driveFileId
    const thumbnailMap: Record<string, string> = {};
    const seenThumb = new Set<string>();
    for (const f of proofFiles) {
      if (!seenThumb.has(f.item_id) && f.drive_file_id) {
        seenThumb.add(f.item_id);
        thumbnailMap[f.item_id] = f.drive_file_id;
      }
    }

    // Build quote items — after variance push, use shipped qtys (what's
    // actually billed); before, use quoted qtys.
    const costingData = job.costing_data as any;
    const costingSummary = job.costing_summary as any;
    const variancePushed = !!((job.type_meta as any)?.qb_variance_pushed_at || (job.type_meta as any)?.stripe_variance_pushed_at);
    const quoteItems: any[] = [];

    if (costingData?.costProds) {
      const costProds = costingData.costProds;

      for (const cp of costProds) {
        // Match costing_data cp to an items row — first by id, then by name
        // (items get recreated via ProductBuilder → new UUIDs, but costing_data
        // still references the old ones).
        let item = (items || []).find((i: any) => i.id === cp.id);
        if (!item && cp.name) item = (items || []).find((i: any) => i.name === cp.name);

        // Qty source of truth = buy_sheet_lines (lock-protected, what QB + PO
        // read). costing_data.qtys is the drift-prone fallback that caused the
        // HPD-2607-028 bug. Post-variance we override with ship/received per-size.
        const bslQtys: Record<string, number> = {};
        for (const l of ((item as any)?.buy_sheet_lines || [])) bslQtys[l.size] = Number(l.qty_ordered) || 0;
        const ordered = Object.keys(bslQtys).length > 0 ? bslQtys : (cp.qtys || {});
        let effectiveQtys: Record<string, number>;
        if (variancePushed && item) {
          const received = (item.received_qtys || {}) as Record<string, number>;
          const shipped = (item.ship_qtys || {}) as Record<string, number>;
          // Per-item route wins over the job route (migration 076).
          const itemRoute = (item as any).shipping_route || job.shipping_route;
          const prefersReceived = itemRoute === "ship_through" || itemRoute === "stage";
          const firstChoice = prefersReceived ? received : shipped;
          const secondChoice = prefersReceived ? shipped : received;
          effectiveQtys = {};
          for (const sz of Object.keys(ordered)) {
            const a = firstChoice[sz];
            const b = secondChoice[sz];
            effectiveQtys[sz] = a !== undefined ? a : b !== undefined ? b : (ordered[sz] || 0);
          }
        } else {
          effectiveQtys = ordered;
        }

        const totalQty = Object.values(effectiveQtys).reduce(
          (a: number, v: any) => a + (Number(v) || 0),
          0
        );
        if (totalQty <= 0) continue;

        // items.sell_per_unit is the source of truth. Fallback chain when the
        // item row is missing or the value is 0 (legacy/ghost data):
        // costing_data cp.sellOverride → qb_total/totalQty (proportional).
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
        });
      }
    }

    // QB info
    const typeMeta = (job.type_meta || {}) as any;

    // Build items with their proof files
    // Respect both file-level approval AND item-level artwork_status override
    // Chain-resolved per-item ETAs (shared helper) — feeds the order's
    // estimated completion. Best-effort; never blocks the payload.
    let etaMap: Record<string, string | null> = {};
    try {
      const { etaByItemForJob } = await import("@/lib/portal/item-eta");
      etaMap = await etaByItemForJob(sb, { id: job.id, shipping_route: (job as any).shipping_route, type_meta: (job as any).type_meta }, items || []);
    } catch {}

    const itemsWithProofs = (items || []).map((item: any) => {
      const manualApproved = item.artwork_status === "approved";
      const itemProofs = proofFiles
        .filter((f: any) => f.item_id === item.id)
        .map((f: any) => ({
          id: f.id,
          fileName: f.file_name,
          stage: f.stage,
          // If item is manually marked approved, treat all its files as approved
          approval: manualApproved ? "approved" : (f.approval || "none"),
          approvedAt: f.approved_at || null,
          driveLink: f.drive_link,
          driveFileId: f.drive_file_id,
          createdAt: f.created_at,
        }));
      // Per-item lifecycle fields — the client-safe phase labels derive from
      // the SAME truth the internal engine reads (Jon's rule: never a parallel
      // state machine). Units/sizes feed the P1 item cards.
      const lines = (item.buy_sheet_lines || []) as any[];
      return {
        id: item.id, name: item.name, proofs: itemProofs,
        units: lines.reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0),
        sizes: Object.fromEntries(lines.filter((l: any) => l.qty_ordered > 0).map((l: any) => [l.size, l.qty_ordered])),
        sellPerUnit: item.sell_per_unit ?? null,
        blankVendor: item.blank_vendor || null,
        blankSku: item.blank_sku || null,
        pipelineStage: item.pipeline_stage || null,
        eta: etaMap[item.id] || null,
        shippingRoute: item.shipping_route || job.shipping_route || "ship_through",
        receivedAtHpd: !!item.received_at_hpd,
        forwardedAt: item.forwarded_at || null,
        webstoreEnteredAt: item.webstore_entered_at || null,
        shipTracking: item.ship_tracking || null,
        forwardTracking: (item as any).forward_tracking || null,
        internalApproved: manualApproved,
        // The proof document's content — the overlay renders the REAL proof
        // (ProofDocView, same single source as the PDF), not a flat image.
        proofSpec: item.proof_spec || null,
        proofSentAt: item.proof_sent_at || null,
      };
    });

    // Phase display names
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

    // Quote visibility is gated on quote_sent_at — same rule as the
    // /client/[token]/orders/[jobId] route. Until OpsHub emails the quote,
    // the client portal hides the quote section and the approved badge.
    // "Sent" for portal purposes = the client legitimately has this quote in
    // front of them. Jobs approved INTERNALLY (client PO by email/phone) never
    // set quote_sent_at — without this OR, the portal hid the quote AND the
    // whole approval panel, leaving revised proofs unapprovable (HPD-2606-038).
    const isQuoteSent = !!typeMeta.quote_sent_at || !!job.quote_approved;
    // Show the order total whenever the client has been BILLED — not only when
    // the quote was emailed. A quote approved internally (via client PO) never
    // sets quote_sent_at, so gating totals on isQuoteSent showed Total: $0 (and
    // hid the Pay button) on a fully-invoiced order. Mirror the client-hub route.
    const showTotals = isQuoteSent || !!typeMeta.invoice_sent_at || !!typeMeta.qb_invoice_id || !!typeMeta.stripe_invoice_number;
    const portalQuoteItems = isQuoteSent ? quoteItems : [];
    // Additional charges (fees/passthru/discounts) — shown as their own lines on
    // the quote, folded into the subtotal so it matches the amount due.
    const portalExtraLines = isQuoteSent
      ? (Array.isArray(typeMeta.invoice_extra_lines) ? typeMeta.invoice_extra_lines : [])
          .map((l: any) => ({ description: String(l?.description || "Additional charge"), amount: Number(l?.amount) || 0 }))
      : [];
    const productsSubtotal = portalQuoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0);
    const extrasSubtotalOut = portalExtraLines.reduce((a: number, l: any) => a + l.amount, 0);

    return NextResponse.json({
      project: {
        id: job.id,
        title: job.title,
        jobNumber: job.job_number,
        phase: job.phase,
        phaseLabel: phaseLabels[job.phase] || job.phase,
        shipDate: job.target_ship_date,
        quoteApproved: isQuoteSent ? job.quote_approved : false,
        quoteApprovedAt: isQuoteSent ? job.quote_approved_at : null,
        changeRequest: (job.type_meta as any)?.change_request || null,
        paymentTerms: job.payment_terms,
      },
      client: { name: clientName },
      company: tenant,
      quote: {
        items: portalQuoteItems,
        extraLines: portalExtraLines,
        subtotal: productsSubtotal + extrasSubtotalOut,
        tax: showTotals ? (typeMeta.qb_tax_amount || 0) : 0,
        total: showTotals ? (typeMeta.qb_total_with_tax || (typeMeta.stripe_total_cents ? typeMeta.stripe_total_cents / 100 : 0) || quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0)) : 0,
      },
      // The order's CURRENT value: live costing gross + additional charges.
      // When it outgrows the invoiced total (revised-after-paid jobs), the
      // payment band shows "Updated total" honestly — same math as the
      // internal status bar.
      currentTotal: (() => {
        const extrasTotal = (Array.isArray(typeMeta.invoice_extra_lines) ? typeMeta.invoice_extra_lines : [])
          .reduce((a: number, l: any) => a + (Number(l?.amount) || 0), 0);
        const gross = Number(costingSummary?.grossRev) || 0;
        const t = gross + extrasTotal;
        return showTotals && t > 0 ? Math.round(t * 100) / 100 : null;
      })(),
      invoiceStale: (() => {
        // Only "stale" when OpsHub actually pushed an invoice to QB
        // (qb_invoice_id set) AND costing drifted vs. the QB totals.
        // Manually-entered invoice numbers (qb_invoice_number set,
        // qb_invoice_id null) don't count — there's no OpsHub-side QB
        // record to compare against, so the staleness test is noise.
        if (!typeMeta.qb_invoice_id) return false;
        // QB total includes the additional charges (invoice_extra_lines), so the
        // comparison subtotal must too — otherwise any invoice with extra
        // charges reads as permanently "stale" and never shows a Pay button.
        const extrasTotal = (Array.isArray(typeMeta.invoice_extra_lines) ? typeMeta.invoice_extra_lines : [])
          .reduce((a: number, l: any) => a + (Number(l?.amount) || 0), 0);
        const quoteSubtotal = quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0) + extrasTotal;
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
      // Invoice + pay link gated on invoice_sent_at OR a manual non-draft
      // payment record. Pushing to QB doesn't expose anything to the portal.
      // Provider-aware. Stripe tenants surface stripe_invoice_number +
      // our white-label /portal/{token}/pay URL. QB tenants keep
      // qb_invoice_number + qb_payment_link.
      paymentLink: await (async () => {
        const sent = !!typeMeta.invoice_sent_at || (payments || []).some((p: any) => p.status && !["draft","void"].includes(p.status));
        if (!sent) return null;
        if (tenant.default_payment_provider === "stripe") {
          // The URL token IS this job's portal_token, so we don't need
          // to re-fetch it.
          const { appBaseUrl } = await import("@/lib/public-url");
          return `${await appBaseUrl()}/portal/${token}/pay`;
        }
        return typeMeta.qb_payment_link || null;
      })(),
      invoiceNumber: ((typeMeta.invoice_sent_at || (payments || []).some((p: any) => p.status && !["draft","void"].includes(p.status)))
        ? ((tenant.default_payment_provider === "stripe" ? typeMeta.stripe_invoice_number : typeMeta.qb_invoice_number) || null)
        : null),
      activity: (activity || []).map((a: any) => ({
        message: a.message,
        date: a.created_at,
      })),
      shipments,
      clientProjects,
    });
  } catch (e: any) {
    console.error("Portal GET error:", e);
    return NextResponse.json(
      { error: e.message || "Failed" },
      { status: 500 }
    );
  }
}

// ── POST: Client actions (approve quote, approve/revise proof) ──
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const sb = admin();
    const { token } = params;

    // Validate token
    const { data: job } = await sb
      .from("jobs")
      .select("id, title, client_id, type_meta")
      .eq("portal_token", token)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const { action, fileId, note } = body;

    // ── Blanket package approval (V2) — one Approve + one Request-changes for
    //    the whole package. Shared logic in lib/portal/approval-actions. ──
    if (action === "approve-package") {
      await approvePackage(sb, job.id, { via: token });
      return NextResponse.json({ success: true });
    }
    if (action === "request-changes") {
      await requestChanges(sb, job.id, note, body.itemIds);
      return NextResponse.json({ success: true });
    }

    // (Legacy per-item actions — approve-quote / reject-quote / approve-all-proofs
    //  / approve-proof / request-revision — removed. Blanket approve-package +
    //  request-changes above supersede them; shared in lib/portal/approval-actions.)
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("Portal POST error:", e);
    return NextResponse.json(
      { error: e.message || "Failed" },
      { status: 500 }
    );
  }
}

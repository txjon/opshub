import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveItemStatus, clientItemStatus } from "@/lib/item-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET /api/portal/client/[token]/orders
//
// Returns all jobs for the client the token belongs to — sanitized for
// client view (no decorators, no vendor names, no internal phase labels).
//
// Scope: active jobs + last 90 days delivered (toggle via ?archive=1).
// Cancelled always hidden. on_hold surfaces as "Paused" — not hidden.

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await db
      .from("clients")
      .select("id, name, companies:company_id(slug, default_payment_provider)")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const tenantProvider = ((client as any).companies?.default_payment_provider || "quickbooks") as string;
    // Resolve the tenant's public origin so Stripe-tenant pay links
    // can point at our white-label /portal/{job_token}/pay page on
    // their domain (vs sending the client to stripe.com hosted pages).
    const { appBaseUrl } = await import("@/lib/public-url");
    const tenantOrigin = await appBaseUrl();

    const url = new URL(req.url);
    const archive = url.searchParams.get("archive") === "1";

    // Base job query — active + recent delivered by default. Archive mode
    // returns everything except cancelled.
    const deliveredCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    let jobsQuery = db
      .from("jobs")
      .select(`
        id, job_number, title, phase, quote_approved, target_ship_date,
        created_at, updated_at, payment_terms, type_meta,
        portal_token, costing_summary,
        shipping_route, phase_timestamps
      `)
      .eq("client_id", client.id)
      .not("phase", "in", "(cancelled)")
      .order("updated_at", { ascending: false });

    const { data: allJobs } = await jobsQuery;
    const jobs = (allJobs || []).filter((j: any) => {
      // A job joins THEIR hub only once they've legitimately seen a number for
      // it — quote sent/approved or invoice sent (the same gate that hides
      // draft pricing per item). Before that it's internal prep: a bridged or
      // hand-built intake job is our workspace, not their order (Jon, Aug 4 —
      // HPD-2608-001 leaked into Forward's hub with "0 pcs").
      const tm = (j.type_meta || {}) as any;
      if (!tm.quote_sent_at && !j.quote_approved && !tm.invoice_sent_at) return false;
      if (archive) return true;
      if (j.phase !== "complete") return true;
      return (j.updated_at || "") >= deliveredCutoff;
    });

    const jobIds = jobs.map((j: any) => j.id);
    // Don't early-return when there are no jobs — we still want to surface
    // fulfillment invoices (below) for clients who are fulfillment-only.

    // Items — include the fields the canonical status resolver needs
    // so each item on a row can show its own state in the hover preview
    // (pipeline_stage, received_at_hpd, archived_at, completed_at,
    // shipping_route override, decorator assignment for po_sent lookup).
    const { data: items } = await db
      .from("items")
      .select("id, job_id, name, garment_type, mockup_color, artwork_status, sell_per_unit, ship_qtys, received_qtys, drive_link, sort_order, pipeline_stage, received_at_hpd, blanks_order_cost, archived_at, completed_at, shipping_route, forwarded_at, decorator_assignments(decorators(name, short_code))")
      .in("job_id", jobIds)
      .order("sort_order", { nullsFirst: false });

    // Pre-build the per-job po_sent_vendors set (lowercased) so the
    // resolver's po_sent input can be resolved cheaply per item.
    const jobById: Record<string, any> = {};
    for (const j of jobs) jobById[j.id] = j;
    const poSentByJob: Record<string, Set<string>> = {};
    for (const j of jobs) {
      const arr = ((j as any).type_meta?.po_sent_vendors || []) as string[];
      poSentByJob[j.id] = new Set(arr.map(s => (s || "").toLowerCase().trim()).filter(Boolean));
    }

    const itemsByJob: Record<string, any[]> = {};
    for (const it of (items || [])) {
      (itemsByJob[it.job_id] ||= []).push(it);
    }

    // Pick the best thumbnail per item. Preference: mockup (rendered comp,
    // most client-friendly) → proof → print_ready. Folder-level drive_link
    // on items themselves isn't thumb-able.
    const itemIds = (items || []).map((i: any) => i.id);
    const thumbByItem: Record<string, string | null> = {};
    const jobIdByItem: Record<string, string> = {};
    for (const i of (items || [])) jobIdByItem[(i as any).id] = (i as any).job_id;
    const internallyApprovedItems = new Set((items || []).filter((i: any) => i.artwork_status === "approved").map((i: any) => i.id));
    const pendingProofsByJob: Record<string, number> = {};
    if (itemIds.length > 0) {
      const { data: files } = await db
        .from("item_files")
        .select("item_id, stage, drive_file_id, created_at, approval")
        .in("item_id", itemIds)
        .in("stage", ["mockup", "proof", "print_ready"])
        .is("superseded_at", null)
        .not("drive_file_id", "is", null)
        .order("created_at", { ascending: false });
      // Live proofs still awaiting client approval, rolled up per job —
      // powers the hub's Needs-you surfacing. An item marked approved
      // INTERNALLY (artwork_status — client PO / verbal / email sign-off)
      // settles its proofs too: same disjunction the internal lifecycle
      // gate uses, never a parallel state machine.
      for (const f of (files || [])) {
        if (f.stage === "proof" && f.approval === "pending" && !internallyApprovedItems.has(f.item_id)) {
          const jid = jobIdByItem[f.item_id];
          if (jid) pendingProofsByJob[jid] = (pendingProofsByJob[jid] || 0) + 1;
        }
      }
      const rank: Record<string, number> = { mockup: 3, proof: 2, print_ready: 1 };
      const bestRank: Record<string, number> = {};
      for (const f of (files || [])) {
        const fRank = rank[f.stage] || 0;
        if (fRank > (bestRank[f.item_id] || 0)) {
          bestRank[f.item_id] = fRank;
          thumbByItem[f.item_id] = f.drive_file_id;
        }
      }
    }

    // Buy sheet lines for qty roll-up (since items.ship_qtys only populates
    // after the decorator ships). Using sum of lines.qty for the pre-ship total.
    const { data: bsLines } = await db
      .from("buy_sheet_lines")
      .select("item_id, qty_ordered")
      .in("item_id", (items || []).map((i: any) => i.id));
    const qtyByItem: Record<string, number> = {};
    for (const l of (bsLines || [])) {
      qtyByItem[l.item_id] = (qtyByItem[l.item_id] || 0) + (Number(l.qty_ordered) || 0);
    }

    // Payment records — roll up paid vs outstanding
    const { data: payments } = await db
      .from("payment_records")
      .select("id, job_id, type, amount, status, paid_date, invoice_number, due_date")
      .in("job_id", jobIds);
    const paysByJob: Record<string, any[]> = {};
    for (const p of (payments || [])) {
      (paysByJob[p.job_id] ||= []).push(p);
    }

    // ── ShipStation fulfillment invoices ──
    // Pulled in alongside project orders so the client sees every invoice
    // they might owe money on in one place. We only surface reports that
    // made it to QB (have qb_invoice_id) — drafts are noise.
    // Show any report that has an invoice number — either pushed to QB
    // (qb_invoice_id set) or entered manually (qb_invoice_number set
    // without qb_invoice_id, for historical invoices or bundled ones
    // created outside OpsHub).
    // Only surface reports that have actually been sent — sent_at is the
    // gate. Drafts and "pushed to QB but not emailed yet" stay hidden so
    // the client doesn't see invoice numbers / pay links before HPD is
    // ready for them to.
    const { data: shipReports } = await db
      .from("shipstation_reports")
      .select("id, report_type, postage_mode, period_label, totals, postage_totals, per_package_fee, qb_invoice_id, qb_invoice_number, qb_payment_link, sent_at, created_at, paid_at, paid_amount")
      .eq("client_id", client.id)
      .not("qb_invoice_number", "is", null)
      .not("sent_at", "is", null);

    const fulfillmentOrders = (shipReports || []).map((r: any) => {
      const totals = r.totals || {};
      const isPostage = r.report_type === "postage";
      const isCombined = r.report_type === "combined";
      // Fulfillment-only: client pays their own postage, billed = the
      // per-package fee total (totals.fulfillment).
      const isFulfillment = r.report_type === "fulfillment";
      // What the client owes. Has to match the QB invoice line items:
      //   Sales-only  → totals.fee
      //   Postage     → totals.billed + totals.fulfillment (carrier
      //                 cost+insurance + per-package handling). Older
      //                 readers used totals.billed alone, which dropped
      //                 the fulfillment fee — fixed here.
      //   Combined    → fee + postage_totals.billed + postage_totals.fulfillment
      let total: number;
      if (isCombined) {
        const post = r.postage_totals || {};
        total = (Number(totals.fee) || 0)
          + (Number(post.billed) || 0)
          + (Number(post.fulfillment) || 0);
      } else if (isPostage) {
        total = (Number(totals.billed) || 0) + (Number(totals.fulfillment) || 0);
      } else if (isFulfillment) {
        total = Number(totals.fulfillment) || 0;
      } else {
        total = Number(totals.fee) || 0;
      }
      const isBulk = (isPostage || isCombined) && r.postage_mode === "bulk";
      // Bulk postage has no unit/shipment count — use the purchase count
      // so the portal copy reads "N postage purchases" instead of "0 units".
      const bulkCount = isCombined ? (Number((r.postage_totals || {}).purchases) || 0) : (Number(totals.purchases) || 0);
      const totalQty = isCombined
        ? (Number(totals.qty) || 0) + (isBulk ? bulkCount : (Number((r.postage_totals || {}).shipments) || 0))
        : (isPostage || isFulfillment)
          ? (isBulk ? bulkCount : (Number(totals.shipments) || 0))
          : (Number(totals.qty) || 0);
      // paid_at + paid_amount are set by the QB webhook when the client
      // pays via the Pay Online link (see /api/qb/webhook2).
      const paidAmount = Number(r.paid_amount) || 0;
      const balance = Math.max(0, total - paidAmount);
      const payment_status: "paid" | "unpaid" | "partial" | "deposit" | "none" =
        balance <= 0.01 && paidAmount > 0 ? "paid"
        : paidAmount > 0 ? "partial"
        : "unpaid";
      return {
        id: r.id,
        kind: "fulfillment" as const,
        job_number: null,
        title: `${isCombined ? "Full Service Invoice" : isFulfillment ? "Fulfillment Invoice" : isPostage ? (isBulk ? "Postage Invoice" : "Postage Report") : "Services Invoice"} — ${r.period_label}`,
        phase: "fulfillment_invoice",
        target_ship_date: null,
        created_at: r.created_at,
        updated_at: r.sent_at || r.created_at,
        items: [],
        total_qty: totalQty,
        proofs_pending: 0,
        total,
        paid_amount: paidAmount,
        balance,
        payment_status,
        paid_at: r.paid_at || null,
        qb_invoice_number: r.qb_invoice_number || null,
        qb_payment_link: r.qb_payment_link || null,
        has_invoice: true,
        period_label: r.period_label,
        report_type: r.report_type || "sales",
        postage_mode: r.postage_mode || "per_shipment",
        bulk_count: bulkCount,
      };
    });

    const orders = jobs.map((j: any) => {
      const jobItems = itemsByJob[j.id] || [];
      const jobPays = paysByJob[j.id] || [];

      // Total — prefer QB total_with_tax (source of truth after invoice push),
      // else the per-item all-inclusive price × qty (sell_per_unit). NEVER costing
      // grossRev — it folds the internal shipping/CC guideline on top (Jon, Jul 28).
      const typeMeta = (j.type_meta || {}) as any;
      let total = Number(typeMeta.qb_total_with_tax) || 0;
      if (total === 0 && Number(typeMeta.stripe_total_cents)) total = Number(typeMeta.stripe_total_cents) / 100;
      if (total === 0) {
        for (const it of jobItems) {
          const qty = qtyByItem[it.id] || 0;
          total += (Number(it.sell_per_unit) || 0) * qty;
        }
      }

      // Paid amount — sum of paid payments. Only count invoices that have
      // actually been issued ("sent" onwards) toward the unpaid/partial state;
      // drafts don't put the client "on the hook" yet.
      const paidPays = jobPays.filter((p: any) => p.status === "paid");
      const paidAmount = paidPays.reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
      // Most recent paid date — used as the "Paid · {date}" stamp on the row.
      const paidAt = paidPays
        .map((p: any) => p.paid_date)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;
      const hasIssued = jobPays.some((p: any) =>
        p.status && !["draft", "void"].includes(p.status)
      );
      // Only treat the invoice as "visible to client" once it's actually
      // been sent from OpsHub (invoice_sent_at) OR a manual payment record
      // already exists (legacy / out-of-band invoices). Pushing to QB alone
      // doesn't expose anything to the portal — that's the producer-side
      // step before review-and-send.
      const isInvoiceSent = !!typeMeta.invoice_sent_at || hasIssued;
      const isInvoiced = isInvoiceSent;
      // Pricing visible once the client has seen a number — quote sent,
      // invoice sent, or a manual payment record exists. Before that the
      // order shows in the list (so the client knows it's in flight) but
      // no dollar amount.
      const isPricingVisible = !!typeMeta.quote_sent_at || isInvoiceSent;
      const visibleTotal = isPricingVisible ? total : 0;
      const visiblePaidAmount = isPricingVisible ? paidAmount : 0;
      const balance = Math.max(0, visibleTotal - visiblePaidAmount);

      let paymentStatus: "paid" | "unpaid" | "partial" | "deposit" | "none" = "none";
      // Resolve payment status. Zero-total orders need special
      // handling: a $0 invoice with an explicit paid payment record
      // (settled at zero — fully credited, adjusted, etc.) should
      // flip to "paid" so OpsHub's payment gate doesn't get stuck.
      // Only force "none" when there's neither a real total nor an
      // issued paid record — that's the legitimate "noise" case
      // (voided / migrated history that we don't want surfacing
      // "Unpaid · $0").
      const hasPaidRecord = paidPays.length > 0;
      if (total <= 0.01 && !hasPaidRecord) paymentStatus = "none";
      else if (total <= 0.01 && hasPaidRecord) paymentStatus = "paid";
      else if (paidAmount > 0 && balance <= 0.01) paymentStatus = "paid";
      else if (paidAmount > 0) paymentStatus = "partial";
      else if (isInvoiced) paymentStatus = "unpaid";

      // Total qty
      const totalQty = jobItems.reduce((a: number, it: any) => a + (qtyByItem[it.id] || 0), 0);

      return {
        id: j.id,
        kind: "project" as const,
        job_number: j.job_number,
        title: j.title,
        phase: j.phase,
        target_ship_date: j.target_ship_date,
        created_at: j.created_at,
        updated_at: j.updated_at,
        items: jobItems.map((it: any) => {
          const assignment = it.decorator_assignments?.[0];
          const decName = assignment?.decorators?.name || null;
          const decShort = assignment?.decorators?.short_code || null;
          const sentSet = poSentByJob[j.id] || new Set();
          const poSent = !!(
            (decName && sentSet.has(decName.toLowerCase())) ||
            (decShort && sentSet.has(decShort.toLowerCase()))
          );
          // client-facing: collapse the internal vendor→HPD legs to In Production
          // so the client is only told "shipped" once it left to them (locked
          // model) — EXCEPT stage-route items, which show In Transit / In Stock
          // (fulfillment clients; route arg below).
          const status = clientItemStatus(resolveItemStatus({
            archived_at: it.archived_at,
            completed_at: it.completed_at,
            pipeline_stage: it.pipeline_stage,
            received_at_hpd: !!it.received_at_hpd,
            sell_per_unit: it.sell_per_unit != null ? Number(it.sell_per_unit) : null,
            blanks_order_cost: it.blanks_order_cost != null ? Number(it.blanks_order_cost) : null,
            po_sent: poSent,
            job_phase: j.phase || null,
            job_shipping_route: (j as any).shipping_route || null,
            item_shipping_route: it.shipping_route || null,
            job_completed_at: ((j as any).phase_timestamps || {}).complete || null,
            forwarded_at: it.forwarded_at || null,
          }), it.shipping_route || (j as any).shipping_route || null);
          return {
            id: it.id,
            name: it.name,
            garment_type: it.garment_type,
            mockup_color: it.mockup_color,
            qty: qtyByItem[it.id] || 0,
            // Drive folder link — for "open in Drive" side-nav, not thumbnail.
            drive_link: it.drive_link,
            // Thumb-able file id (mockup > proof > print_ready). Null if none.
            thumb_id: thumbByItem[it.id] || null,
            // Canonical per-item state (lib/item-status). Drives the hover
            // preview chip + lets the client see at-a-glance what's where
            // on a mixed-state job.
            status,
          };
        }),
        total_qty: totalQty,
        proofs_pending: pendingProofsByJob[j.id] || 0,
        quote_approved: !!j.quote_approved,
        // total / paid_amount / balance gated on isPricingVisible —
        // before quote/invoice has been sent, client sees the order
        // and items but no dollar amount.
        total: visibleTotal,
        paid_amount: visiblePaidAmount,
        balance,
        payment_status: paymentStatus,
        paid_at: paidAt,
        // Provider-agnostic invoice fields. For Stripe tenants the pay
        // link routes through our white-label page; for QB tenants it's
        // the QB-hosted payment URL. Legacy qb_* fields kept populated
        // (only for QB tenants) so older portal builds still work.
        invoice_number: isInvoiceSent
          ? (tenantProvider === "stripe"
              ? (typeMeta.stripe_invoice_number || null)
              : (typeMeta.qb_invoice_number || null))
          : null,
        payment_link: isInvoiceSent
          ? (tenantProvider === "stripe"
              ? (j.portal_token ? `${tenantOrigin}/portal/${j.portal_token}/pay` : null)
              : (typeMeta.qb_payment_link || null))
          : null,
        qb_invoice_number: isInvoiceSent && tenantProvider !== "stripe" ? (typeMeta.qb_invoice_number || null) : null,
        qb_payment_link: isInvoiceSent && tenantProvider !== "stripe" ? (typeMeta.qb_payment_link || null) : null,
        has_invoice: isInvoiced,
        pricing_visible: isPricingVisible,
      };
    });

    // Merge fulfillment invoices with project orders, newest first.
    const combined = [...orders, ...fulfillmentOrders].sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || "")
    );

    return NextResponse.json({
      client: { name: client.name },
      orders: combined,
      archive,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

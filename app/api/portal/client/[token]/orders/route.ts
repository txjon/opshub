import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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
      .select("id, name")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const url = new URL(req.url);
    const archive = url.searchParams.get("archive") === "1";

    // Base job query — active + recent delivered by default. Archive mode
    // returns everything except cancelled.
    const deliveredCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    let jobsQuery = db
      .from("jobs")
      .select(`
        id, job_number, title, phase, target_ship_date,
        created_at, updated_at, payment_terms, type_meta,
        portal_token, costing_summary
      `)
      .eq("client_id", client.id)
      .not("phase", "in", "(cancelled)")
      .order("updated_at", { ascending: false });

    const { data: allJobs } = await jobsQuery;
    const jobs = (allJobs || []).filter((j: any) => {
      if (archive) return true;
      if (j.phase !== "complete") return true;
      return (j.updated_at || "") >= deliveredCutoff;
    });

    const jobIds = jobs.map((j: any) => j.id);
    // Don't early-return when there are no jobs — we still want to surface
    // fulfillment invoices (below) for clients who are fulfillment-only.

    // Items — just the fields we need for the row preview. Detail view does
    // a second fetch for sizes/tracking if needed.
    const { data: items } = await db
      .from("items")
      .select("id, job_id, name, garment_type, mockup_color, sell_per_unit, ship_qtys, received_qtys, drive_link, sort_order")
      .in("job_id", jobIds)
      .order("sort_order", { nullsFirst: false });

    const itemsByJob: Record<string, any[]> = {};
    for (const it of (items || [])) {
      (itemsByJob[it.job_id] ||= []).push(it);
    }

    // Pick the best thumbnail per item. Preference: mockup (rendered comp,
    // most client-friendly) → proof → print_ready. Folder-level drive_link
    // on items themselves isn't thumb-able.
    const itemIds = (items || []).map((i: any) => i.id);
    const thumbByItem: Record<string, string | null> = {};
    if (itemIds.length > 0) {
      const { data: files } = await db
        .from("item_files")
        .select("item_id, stage, drive_file_id, created_at")
        .in("item_id", itemIds)
        .in("stage", ["mockup", "proof", "print_ready"])
        .is("superseded_at", null)
        .not("drive_file_id", "is", null)
        .order("created_at", { ascending: false });
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
      .select("id, report_type, period_label, totals, qb_invoice_id, qb_invoice_number, qb_payment_link, sent_at, created_at, paid_at, paid_amount")
      .eq("client_id", client.id)
      .not("qb_invoice_number", "is", null)
      .not("sent_at", "is", null);

    const fulfillmentOrders = (shipReports || []).map((r: any) => {
      const totals = r.totals || {};
      const isPostage = r.report_type === "postage";
      // Sales → totals.fee is what we bill. Postage → totals.billed.
      const total = isPostage
        ? (Number(totals.billed) || 0)
        : (Number(totals.fee) || 0);
      const totalQty = isPostage
        ? (Number(totals.shipments) || 0)
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
        title: `${isPostage ? "Postage Report" : "Services Invoice"} — ${r.period_label}`,
        phase: "fulfillment_invoice",
        target_ship_date: null,
        created_at: r.created_at,
        updated_at: r.sent_at || r.created_at,
        items: [],
        total_qty: totalQty,
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
      };
    });

    const orders = jobs.map((j: any) => {
      const jobItems = itemsByJob[j.id] || [];
      const jobPays = paysByJob[j.id] || [];

      // Total — prefer QB total_with_tax (source of truth after invoice push),
      // fall back to costing_summary.grossRev, fall back to sum(sell × qty).
      const typeMeta = (j.type_meta || {}) as any;
      const costingSummary = (j.costing_summary || {}) as any;
      let total = Number(typeMeta.qb_total_with_tax) || 0;
      if (total === 0) total = Number(costingSummary.grossRev) || 0;
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
      const balance = Math.max(0, total - paidAmount);
      // Only treat the invoice as "visible to client" once it's actually
      // been sent from OpsHub (invoice_sent_at) OR a manual payment record
      // already exists (legacy / out-of-band invoices). Pushing to QB alone
      // doesn't expose anything to the portal — that's the producer-side
      // step before review-and-send.
      const isInvoiceSent = !!typeMeta.invoice_sent_at || hasIssued;
      const isInvoiced = isInvoiceSent;

      let paymentStatus: "paid" | "unpaid" | "partial" | "deposit" | "none" = "none";
      // Zero-total orders (voided, migrated history, etc.) carry no
      // payment status — nothing to pay, so "Unpaid · $0" is noise.
      if (total <= 0.01) paymentStatus = "none";
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
        items: jobItems.map((it: any) => ({
          id: it.id,
          name: it.name,
          garment_type: it.garment_type,
          mockup_color: it.mockup_color,
          qty: qtyByItem[it.id] || 0,
          // Drive folder link — for "open in Drive" side-nav, not thumbnail.
          drive_link: it.drive_link,
          // Thumb-able file id (mockup > proof > print_ready). Null if none.
          thumb_id: thumbByItem[it.id] || null,
        })),
        total_qty: totalQty,
        total,
        paid_amount: paidAmount,
        balance,
        payment_status: paymentStatus,
        paid_at: paidAt,
        qb_invoice_number: isInvoiceSent ? (typeMeta.qb_invoice_number || null) : null,
        qb_payment_link: isInvoiceSent ? (typeMeta.qb_payment_link || null) : null,
        has_invoice: isInvoiced,
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

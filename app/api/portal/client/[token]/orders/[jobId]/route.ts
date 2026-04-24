import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortSizes } from "@/lib/theme";
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
    .select("id, name")
    .eq("portal_token", token)
    .single();
  if (!client) return { error: "Invalid link", status: 404 as const };

  const { data: job, error: jobErr } = await sb
    .from("jobs")
    .select(
      "id, title, job_number, phase, payment_terms, target_ship_date, type_meta, quote_approved, quote_approved_at, costing_data, costing_summary, client_id, shipping_route, portal_token"
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
        return {
          jobId: j.id,
          title: j.title,
          jobNumber: j.job_number,
          phase: j.phase,
          shipDate: j.target_ship_date,
          portalToken: j.portal_token,
          invoiceNumber: (j.type_meta as any)?.qb_invoice_number || null,
          isComplete: j.phase === "complete",
          itemCount,
          unitCount,
        };
      });
    }

    const { data: items } = await sb
      .from("items")
      .select(
        "id, name, sell_per_unit, pipeline_stage, sort_order, artwork_status, ship_qtys, received_qtys, blank_vendor, blank_sku"
      )
      .eq("job_id", job.id)
      .order("sort_order");

    const itemIds = (items || []).map((i: any) => i.id);

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
        const invNum = (job.type_meta as any)?.qb_invoice_number;
        clientMsg = invNum ? `Invoice #${invNum} delivered` : "Invoice delivered";
      }
      else if (/invoice \+ proofs sent/i.test(msg)) clientMsg = "Invoice and proofs delivered";
      else if (/payment received/i.test(msg)) clientMsg = msg;
      else if (/proof approved by client/i.test(msg)) {
        const match = msg.match(/for (.+)$/);
        clientMsg = match ? `${match[1]} proof approved` : "Proof approved";
      }
      else if (/proofs sent to client/i.test(msg)) clientMsg = "Proofs delivered";
      else if (/shipped|tracking/i.test(msg) && !/decorator|warehouse|production/i.test(msg)) clientMsg = msg;

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
    const variancePushed = !!(job.type_meta as any)?.qb_variance_pushed_at;
    const prefersReceived = job.shipping_route === "ship_through" || job.shipping_route === "stage";
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

        const totalQty = Object.values(effectiveQtys).reduce(
          (a: number, v: any) => a + (Number(v) || 0),
          0
        );
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
        });
      }
    }

    const typeMeta = (job.type_meta || {}) as any;

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
      return { id: item.id, name: item.name, proofs: itemProofs };
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
        quoteApproved: job.quote_approved,
        quoteApprovedAt: job.quote_approved_at,
        paymentTerms: job.payment_terms,
      },
      client: { name: clientName },
      quote: {
        items: quoteItems,
        subtotal: quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0),
        tax: typeMeta.qb_tax_amount || 0,
        total: typeMeta.qb_total_with_tax || quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0),
      },
      invoiceStale: (() => {
        // Only "stale" when OpsHub actually pushed an invoice to QB.
        // Manually-entered invoice numbers have no OpsHub-side QB totals
        // to compare against, so the staleness check would always fire.
        if (!typeMeta.qb_invoice_id) return false;
        const quoteSubtotal = quoteItems.reduce((a: number, qi: any) => a + (qi.total || 0), 0);
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
      paymentLink: typeMeta.qb_payment_link || null,
      invoiceNumber: typeMeta.qb_invoice_number || null,
      activity: (activity || []).map((a: any) => ({
        message: a.message,
        date: a.created_at,
      })),
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

    if (action === "reject-quote") {
      await sb
        .from("jobs")
        .update({ quote_rejection_notes: note || "Client requested changes" })
        .eq("id", job.id);
      await sb.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: `Quote rejected by client via portal${note ? `: "${note}"` : ""}`,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "approve-quote") {
      const now = new Date().toISOString();
      await sb
        .from("jobs")
        .update({ quote_approved: true, quote_approved_at: now, quote_rejection_notes: null })
        .eq("id", job.id);
      await sb.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: "Quote approved by client via portal",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "approve-all-proofs") {
      const { data: jobItems } = await sb.from("items").select("id").eq("job_id", job.id);
      const itemIds = (jobItems || []).map((it: any) => it.id);
      if (itemIds.length > 0) {
        await sb.from("item_files")
          .update({ approval: "approved", approved_at: new Date().toISOString() })
          .in("item_id", itemIds)
          .eq("stage", "proof")
          .eq("approval", "pending")
          .is("superseded_at", null);
        await sb.from("items")
          .update({ artwork_status: "approved" })
          .in("id", itemIds);
      }
      await sb.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: "All proofs approved by client via portal",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "approve-proof" && fileId) {
      const { data: target } = await sb
        .from("item_files")
        .select("id, superseded_at, item_id")
        .eq("id", fileId)
        .single();
      if (!target || target.superseded_at) {
        return NextResponse.json({ error: "This proof is no longer active. Please refresh." }, { status: 400 });
      }
      // Guard: verify this file belongs to an item on the job the token
      // has access to. Prevents a valid client token from approving
      // proofs on another client's jobs.
      const { data: fileItem } = await sb.from("items").select("job_id").eq("id", target.item_id).single();
      if (!fileItem || fileItem.job_id !== job.id) {
        return NextResponse.json({ error: "Invalid proof" }, { status: 403 });
      }
      await sb
        .from("item_files")
        .update({ approval: "approved", approved_at: new Date().toISOString() })
        .eq("id", fileId);
      const { data: item } = await sb.from("items").select("name").eq("id", target.item_id).single();
      await sb.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: `Proof approved by client via portal for ${item?.name || "Item"}`,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "request-revision" && fileId) {
      const { data: target } = await sb
        .from("item_files")
        .select("id, superseded_at, item_id")
        .eq("id", fileId)
        .single();
      if (!target || target.superseded_at) {
        return NextResponse.json({ error: "This proof is no longer active. Please refresh." }, { status: 400 });
      }
      const { data: fileItem } = await sb.from("items").select("job_id").eq("id", target.item_id).single();
      if (!fileItem || fileItem.job_id !== job.id) {
        return NextResponse.json({ error: "Invalid proof" }, { status: 403 });
      }
      await sb
        .from("item_files")
        .update({
          approval: "revision_requested",
          ...(note ? { notes: note } : {}),
        })
        .eq("id", fileId);
      const { data: item } = await sb.from("items").select("name").eq("id", target.item_id).single();
      const noteText = note ? ` — "${note}"` : "";
      await sb.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: `Revision requested by client via portal for ${item?.name || "Item"}${noteText}`,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("Client Hub per-order POST error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

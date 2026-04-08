import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendClientNotification } from "@/lib/auto-email";
import { buildPrintersMap, calcCostProduct } from "@/lib/pricing";

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

    // Client name
    let clientName = "Client";
    if (job.client_id) {
      const { data: client } = await sb
        .from("clients")
        .select("name")
        .eq("id", job.client_id)
        .single();
      if (client) clientName = client.name;
    }

    // Items (only fields the client should see)
    const { data: items } = await sb
      .from("items")
      .select(
        "id, name, sell_per_unit, pipeline_stage, sort_order, artwork_status"
      )
      .eq("job_id", job.id)
      .order("sort_order");

    const itemIds = (items || []).map((i: any) => i.id);

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

    // Filter to events the client should see (hide internal ops like POs, blanks, PSD processing)
    const CLIENT_SAFE_KEYWORDS = [
      "quote", "proof", "mockup", "payment", "invoice", "approved",
      "revision", "shipped", "tracking", "delivered", "sent to client",
    ];
    const INTERNAL_KEYWORDS = [
      "PO sent", "blanks", "PSD processed", "Item created from PSD",
      "costing", "decorator", "stage advanced", "auto-email",
      "buy sheet", "assigned", "reorder", "QB Invoice", "auto-created",
      "confirmation sent to", "Print proof generated",
      "created in quickbooks",
    ];
    const activity = (rawActivity || []).filter((a: any) => {
      const msg = (a.message || "").toLowerCase();
      if (INTERNAL_KEYWORDS.some(k => msg.includes(k.toLowerCase()))) return false;
      return CLIENT_SAFE_KEYWORDS.some(k => msg.includes(k.toLowerCase()));
    }).map((a: any) => {
      let msg = a.message || "";
      // Rewrite messages for client view
      if (/quote sent to client/i.test(msg)) msg = "Quote delivered";
      if (/invoice sent to client/i.test(msg)) {
        const invNum = (job.type_meta as any)?.qb_invoice_number;
        msg = invNum ? `Invoice #${invNum} delivered` : "Invoice delivered";
      }
      return { ...a, message: msg };
    }).slice(0, 15);

    // Build thumbnail map: item_id → first mockup/proof driveFileId
    const thumbnailMap: Record<string, string> = {};
    const seenThumb = new Set<string>();
    for (const f of proofFiles) {
      if (!seenThumb.has(f.item_id) && f.drive_file_id) {
        seenThumb.add(f.item_id);
        thumbnailMap[f.item_id] = f.drive_file_id;
      }
    }

    // Build quote items using shared pricing engine (same as quote PDF)
    const costingData = job.costing_data as any;
    const costingSummary = job.costing_summary as any;
    const quoteItems: any[] = [];

    if (costingData?.costProds) {
      // Load decorator pricing for accurate per-item calculation
      const vendorKeys = [...new Set(costingData.costProds.map((cp: any) => cp.printVendor).filter(Boolean))];
      let printers: Record<string, any> = {};
      if (vendorKeys.length > 0) {
        const { data: decs } = await sb
          .from("decorators")
          .select("name, short_code, pricing_data")
          .or(vendorKeys.map((k: string) => `short_code.eq.${k},name.eq.${k}`).join(","));
        printers = buildPrintersMap(decs || []);
      }

      const costMargin = costingData.margin || "30%";
      const inclShip = costingData.inclShip ?? false;
      const inclCC = costingData.inclCC ?? false;
      const costProds = costingData.costProds;

      for (const cp of costProds) {
        const item = (items || []).find((i: any) => i.id === cp.id);
        const totalQty =
          cp.totalQty ||
          Object.values(cp.qtys || {}).reduce(
            (a: number, v: any) => a + (Number(v) || 0),
            0
          );
        if (totalQty <= 0) continue;

        // Use pricing engine for accurate sell price
        const r = calcCostProduct(cp, costMargin, inclShip, inclCC, costProds, printers);
        const sellPerUnit = r ? r.sellPerUnit : (item?.sell_per_unit || 0);
        const grossRev = r ? r.grossRev : sellPerUnit * totalQty;

        quoteItems.push({
          name: cp.name || item?.name || "Item",
          qty: totalQty,
          sellPerUnit: Math.round(sellPerUnit * 100) / 100,
          total: Math.round(grossRev * 100) / 100,
          thumbnailFileId: item ? thumbnailMap[item.id] || null : null,
        });
      }
    }

    // QB info
    const typeMeta = (job.type_meta || {}) as any;

    // Build items with their proof files
    // Respect both file-level approval AND item-level artwork_status override
    const itemsWithProofs = (items || []).map((item: any) => {
      const manualApproved = item.artwork_status === "approved";
      const itemProofs = proofFiles
        .filter((f: any) => f.item_id === item.id)
        .map((f: any) => ({
          id: f.id,
          fileName: f.file_name,
          stage: f.stage,
          // If item is manually marked approved, treat all its files as approved
          approval: manualApproved ? "approved" : (f.stage === "mockup" && f.approval === "none" ? "approved" : f.approval),
          approvedAt: f.approved_at || null,
          driveLink: f.drive_link,
          driveFileId: f.drive_file_id,
          createdAt: f.created_at,
        }));
      return { id: item.id, name: item.name, proofs: itemProofs };
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

    return NextResponse.json({
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
        subtotal: costingSummary?.grossRev || 0,
        tax: typeMeta.qb_tax_amount || 0,
        total: typeMeta.qb_total_with_tax || costingSummary?.grossRev || 0,
      },
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

    if (action === "reject-quote") {
      await sb
        .from("jobs")
        .update({ quote_rejection_notes: note || "Client requested changes" })
        .eq("id", job.id);

      await sb.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: `Quote rejected by client via portal${note ? `: "${note}"` : ""}`,
      });

      let clientName = "Client";
      if (job.client_id) {
        const { data: c } = await sb.from("clients").select("name").eq("id", job.client_id).single();
        if (c) clientName = c.name;
      }
      const { data: profiles } = await sb.from("profiles").select("id");
      if (profiles?.length) {
        await sb.from("notifications").insert(
          profiles.map((p: any) => ({
            user_id: p.id, type: "alert",
            message: `Quote rejected — ${clientName} · ${job.title}`,
            reference_id: job.id, reference_type: "job",
          }))
        );
      }

      return NextResponse.json({ success: true });
    }

    if (action === "approve-quote") {
      const now = new Date().toISOString();
      await sb
        .from("jobs")
        .update({ quote_approved: true, quote_approved_at: now, quote_rejection_notes: null })
        .eq("id", job.id);

      // Log activity
      await sb.from("job_activity").insert({
        job_id: job.id,
        user_id: null,
        type: "auto",
        message: "Quote approved by client via portal",
      });

      // Notify team
      let clientName = "Client";
      if (job.client_id) {
        const { data: c } = await sb
          .from("clients")
          .select("name")
          .eq("id", job.client_id)
          .single();
        if (c) clientName = c.name;
      }

      const { data: profiles } = await sb.from("profiles").select("id");
      if (profiles?.length) {
        await sb.from("notifications").insert(
          profiles.map((p: any) => ({
            user_id: p.id,
            type: "approval",
            message: `Quote approved — ${clientName} · ${job.title}`,
            reference_id: job.id,
            reference_type: "job",
          }))
        );
      }

      // Auto-email client confirmation (fire-and-forget)
      sendClientNotification({ jobId: job.id, type: "quote_approved" }).catch(() => {});


      return NextResponse.json({ success: true });
    }

    if (action === "approve-proof" && fileId) {
      await sb
        .from("item_files")
        .update({ approval: "approved", approved_at: new Date().toISOString() })
        .eq("id", fileId);

      // Get item name for logging
      const { data: file } = await sb
        .from("item_files")
        .select("item_id, file_name")
        .eq("id", fileId)
        .single();
      let itemName = "Item";
      if (file) {
        const { data: item } = await sb
          .from("items")
          .select("name")
          .eq("id", file.item_id)
          .single();
        if (item) itemName = item.name;
      }

      await sb.from("job_activity").insert({
        job_id: job.id,
        user_id: null,
        type: "auto",
        message: `Proof approved by client via portal for ${itemName}`,
      });

      // Notify team
      const { data: profiles } = await sb.from("profiles").select("id");
      if (profiles?.length) {
        await sb.from("notifications").insert(
          profiles.map((p: any) => ({
            user_id: p.id,
            type: "approval",
            message: `Proof approved — ${itemName} · ${job.title}`,
            reference_id: job.id,
            reference_type: "job",
          }))
        );
      }

      return NextResponse.json({ success: true });
    }

    if (action === "request-revision" && fileId) {
      await sb
        .from("item_files")
        .update({
          approval: "revision_requested",
          ...(note ? { notes: note } : {}),
        })
        .eq("id", fileId);

      const { data: file } = await sb
        .from("item_files")
        .select("item_id, file_name")
        .eq("id", fileId)
        .single();
      let itemName = "Item";
      if (file) {
        const { data: item } = await sb
          .from("items")
          .select("name")
          .eq("id", file.item_id)
          .single();
        if (item) itemName = item.name;
      }

      const noteText = note ? ` — "${note}"` : "";
      await sb.from("job_activity").insert({
        job_id: job.id,
        user_id: null,
        type: "auto",
        message: `Revision requested by client via portal for ${itemName}${noteText}`,
      });

      // Notify team
      const { data: profiles } = await sb.from("profiles").select("id");
      if (profiles?.length) {
        await sb.from("notifications").insert(
          profiles.map((p: any) => ({
            user_id: p.id,
            type: "alert",
            message: `Revision requested — ${itemName} · ${job.title}${noteText}`,
            reference_id: job.id,
            reference_type: "job",
          }))
        );
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("Portal POST error:", e);
    return NextResponse.json(
      { error: e.message || "Failed" },
      { status: 500 }
    );
  }
}

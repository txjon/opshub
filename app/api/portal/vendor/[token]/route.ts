import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendClientNotification } from "@/lib/auto-email";
import { buildPrintersMap, calcDecorationLines } from "@/lib/pricing";
import { Resend } from "resend";
import { renderBrandedEmail } from "@/lib/email-template";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// ── GET: All active work for this decorator ──
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const sb = admin();

    // Look up decorator by token
    const { data: decorator, error: decErr } = await sb
      .from("decorators")
      .select("id, name, short_code")
      .eq("external_token", params.token)
      .single();

    if (decErr || !decorator) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Get all items assigned to this decorator via costing data
    // Items are linked by decorator name in costing_data.costProds[].printVendor
    // Also check decorator_assignments table
    const { data: assignments } = await sb
      .from("decorator_assignments")
      .select("item_id, pipeline_stage, tracking_number, notes, sent_to_decorator_date, est_completion_date, actual_completion_date")
      .eq("decorator_id", decorator.id);

    const assignedItemIds = (assignments || []).map((a: any) => a.item_id);

    // Also find items where costing references this decorator by name
    // We query all items from active jobs and check costing_data
    const { data: activeJobs } = await sb
      .from("jobs")
      .select("id, title, job_number, phase, target_ship_date, type_meta, client_id, costing_data, shipping_route")
      .in("phase", ["intake", "pending", "ready", "production", "receiving", "fulfillment"])
      .order("target_ship_date", { ascending: true });

    // Completed pagination params
    const completedOffset = parseInt(req.nextUrl.searchParams.get("completed_offset") || "0");
    const completedLimit = parseInt(req.nextUrl.searchParams.get("completed_limit") || "10");
    const completedSearch = (req.nextUrl.searchParams.get("completed_search") || "").trim();

    // Collect client names
    const clientIds = [...new Set((activeJobs || []).map((j: any) => j.client_id).filter(Boolean))];
    let clientMap: Record<string, string> = {};
    if (clientIds.length > 0) {
      const { data: clients } = await sb
        .from("clients")
        .select("id, name")
        .in("id", clientIds);
      clientMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.name]));
    }

    // Load decorator pricing for decoration line calculations
    const { data: allDecs } = await sb
      .from("decorators")
      .select("name, short_code, pricing_data");
    const printers = buildPrintersMap(allDecs || []);

    // For each active job, find items that belong to this decorator
    const orders: any[] = [];
    const completed: any[] = [];

    for (const job of activeJobs) {
      const costingData = job.costing_data as any;
      if (!costingData?.costProds?.length) continue;

      const allCostProds = costingData.costProds;

      // Find items in this job assigned to this decorator
      const decItems = allCostProds.filter((cp: any) =>
        cp.printVendor === decorator.name || cp.printVendor === decorator.short_code
      );

      if (decItems.length === 0) continue;

      const itemIds = decItems.map((cp: any) => cp.id);

      // Fetch full item data
      const { data: items } = await sb
        .from("items")
        .select("id, name, garment_type, blank_vendor, blank_sku, pipeline_stage, drive_link, incoming_goods, production_notes_po, packing_notes, ship_tracking, ship_qtys, blanks_order_number, blanks_order_cost, sort_order, buy_sheet_lines(size, qty_ordered)")
        .in("id", itemIds)
        .order("sort_order");

      if (!items?.length) continue;

      // Build order data
      const typeMeta = (job.type_meta || {}) as any;
      const poSent = (typeMeta.po_sent_vendors || []).includes(decorator.name) ||
                     (typeMeta.po_sent_vendors || []).includes(decorator.short_code);

      // Only show jobs where PO has been sent to this decorator
      if (!poSent) continue;

      // Fetch mockup thumbnails for items in this order
      const { data: mockupFiles } = await sb
        .from("item_files")
        .select("item_id, drive_file_id")
        .in("item_id", itemIds)
        .eq("stage", "mockup")
        .order("created_at", { ascending: false });
      const mockupByItem: Record<string, string> = {};
      for (const f of (mockupFiles || [])) {
        if (!mockupByItem[f.item_id]) mockupByItem[f.item_id] = f.drive_file_id;
      }

      // Get all items in this job for letter assignment (sorted by sort_order)
      const { data: allJobItems } = await sb
        .from("items")
        .select("id, sort_order")
        .eq("job_id", job.id)
        .order("sort_order");
      const letterMap: Record<string, string> = {};
      (allJobItems || []).forEach((it: any, idx: number) => {
        letterMap[it.id] = String.fromCharCode(65 + idx);
      });

      // Get ship-to address for this vendor
      const poShipTo = typeMeta.po_ship_to?.[decorator.name] || typeMeta.po_ship_to?.[decorator.short_code]
        || (job.shipping_route === "drop_ship" ? (typeMeta.venue_address || null) : "House Party Distro\n4670 W Silverado Ranch Blvd, STE 120\nLas Vegas, NV 89139");
      const poShipMethod = typeMeta.po_ship_methods?.[decorator.name] || typeMeta.po_ship_methods?.[decorator.short_code] || null;

      let grandTotal = 0;
      const orderItems = items.map((item: any) => {
        const costProd = decItems.find((cp: any) => cp.id === item.id);
        const lines = item.buy_sheet_lines || [];
        const sizes = lines.map((l: any) => l.size);
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const totalQty = lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);

        // Calculate decoration lines using shared pricing engine
        const decoLines = costProd
          ? calcDecorationLines({ ...costProd, totalQty }, allCostProds, printers)
          : [];
        const itemTotal = decoLines.reduce((a: number, l: any) => a + l.total, 0);
        grandTotal += itemTotal;

        // Supplier from costing data
        const supplier = costProd?.supplier || item.blank_vendor || "";
        const incoming = item.incoming_goods || (supplier ? "Blanks from " + supplier : "");

        return {
          id: item.id,
          name: item.name,
          letter: letterMap[item.id] || "",
          garmentType: item.garment_type,
          blankVendor: item.blank_vendor,
          blankSku: item.blank_sku || costProd?.color || "",
          pipelineStage: item.pipeline_stage || "pending",
          driveLink: item.drive_link,
          incomingGoods: incoming,
          productionNotes: item.production_notes_po,
          packingNotes: item.packing_notes,
          shipTracking: item.ship_tracking,
          shipQtys: item.ship_qtys,
          sizes,
          qtys,
          totalQty,
          decoLines,
          itemTotal,
          mockupThumb: mockupByItem[item.id] ? `/api/files/thumbnail?id=${mockupByItem[item.id]}` : null,
          blanksOrdered: ((item as any).blanks_order_cost ?? 0) > 0,
        };
      });

      const isAllComplete = orderItems.every((i: any) => i.pipelineStage === "shipped" || i.pipelineStage === "complete");
      const totalUnits = orderItems.reduce((a: number, i: any) => a + i.totalQty, 0);

      // PO sent date — prefer type_meta.po_sent_dates, fall back to assignments, then null
      const poSentDate = typeMeta.po_sent_dates?.[decorator.name]
        || typeMeta.po_sent_dates?.[decorator.short_code]
        || (assignments || []).find((a: any) => itemIds.includes(a.item_id) && a.sent_to_decorator_date)?.sent_to_decorator_date
        || null;

      // Ship date — match PO PDF: prefer per-vendor date from type_meta.po_ship_dates,
      // fall back to the job-level target_ship_date.
      const vendorShipDate = typeMeta.po_ship_dates?.[decorator.name]
        || typeMeta.po_ship_dates?.[decorator.short_code]
        || job.target_ship_date;

      const order = {
        jobId: job.id,
        jobNumber: typeMeta.qb_invoice_number || job.job_number,
        jobTitle: job.title,
        clientName: clientMap[job.client_id] || "Client",
        phase: job.phase,
        shipDate: vendorShipDate,
        shippingRoute: job.shipping_route,
        poSent,
        poSentDate,
        shipTo: poShipTo,
        shipMethod: poShipMethod,
        shippingAccount: typeMeta.shipping_account || ((poShipMethod || "").toLowerCase().includes("ups") ? "W28Y51" : ""),
        grandTotal,
        totalUnits,
        items: orderItems,
      };

      if (!isAllComplete) {
        orders.push(order);
      }
    }

    // Sort active: soonest ship date first
    orders.sort((a: any, b: any) => {
      if (!a.shipDate) return 1;
      if (!b.shipDate) return -1;
      return new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime();
    });

    // ── Completed orders — separate query, paginated, searchable ──
    let completedQuery = sb
      .from("jobs")
      .select("id, title, job_number, phase, target_ship_date, type_meta, client_id, costing_data, shipping_route", { count: "exact" })
      .in("phase", ["complete"])
      .order("job_number", { ascending: false });

    if (completedSearch) {
      completedQuery = completedQuery.or(`job_number.ilike.%${completedSearch}%,title.ilike.%${completedSearch}%`);
    }

    const { data: completedJobs, count: completedTotal } = await completedQuery.range(completedOffset, completedOffset + completedLimit - 1);

    // Load any missing client names for completed jobs
    const missingClientIds = (completedJobs || []).map((j: any) => j.client_id).filter((id: string) => id && !clientMap[id]);
    if (missingClientIds.length > 0) {
      const { data: moreClients } = await sb.from("clients").select("id, name").in("id", [...new Set(missingClientIds)]);
      for (const c of (moreClients || [])) clientMap[c.id] = c.name;
    }

    const completedOrders: any[] = [];
    for (const job of (completedJobs || [])) {
      const costingData = job.costing_data as any;
      if (!costingData?.costProds?.length) continue;
      const allCostProds = costingData.costProds;
      const decItems = allCostProds.filter((cp: any) =>
        cp.printVendor === decorator.short_code || cp.printVendor === decorator.name
      );
      if (decItems.length === 0) continue;

      const itemIds = decItems.map((cp: any) => cp.id);
      const { data: cItems } = await sb
        .from("items")
        .select("id, name, garment_type, blank_vendor, blank_sku, pipeline_stage, drive_link, incoming_goods, production_notes_po, packing_notes, ship_tracking, ship_qtys, blanks_order_number, blanks_order_cost, sort_order, buy_sheet_lines(size, qty_ordered)")
        .in("id", itemIds)
        .order("sort_order");

      if (!cItems?.length) continue;

      const typeMeta = (job.type_meta || {}) as any;
      const poSent = (typeMeta.po_sent_vendors || []).includes(decorator.name) ||
                     (typeMeta.po_sent_vendors || []).includes(decorator.short_code);

      // Fetch mockup thumbnails
      const { data: cMockups } = await sb
        .from("item_files")
        .select("item_id, drive_file_id")
        .in("item_id", itemIds)
        .eq("stage", "mockup")
        .order("created_at", { ascending: false });
      const cMockupByItem: Record<string, string> = {};
      for (const f of (cMockups || [])) {
        if (!cMockupByItem[f.item_id]) cMockupByItem[f.item_id] = f.drive_file_id;
      }

      // Letter map
      const { data: cAllJobItems } = await sb
        .from("items")
        .select("id, sort_order")
        .eq("job_id", job.id)
        .order("sort_order");
      const cLetterMap: Record<string, string> = {};
      (cAllJobItems || []).forEach((it: any, idx: number) => {
        cLetterMap[it.id] = String.fromCharCode(65 + idx);
      });

      const poShipTo = typeMeta.po_ship_to?.[decorator.name] || typeMeta.po_ship_to?.[decorator.short_code]
        || (job.shipping_route === "drop_ship" ? (typeMeta.venue_address || null) : "House Party Distro\n4670 W Silverado Ranch Blvd, STE 120\nLas Vegas, NV 89139");
      const poShipMethod = typeMeta.po_ship_methods?.[decorator.name] || typeMeta.po_ship_methods?.[decorator.short_code] || null;

      let grandTotal = 0;
      const orderItems = cItems.map((item: any) => {
        const costProd = decItems.find((cp: any) => cp.id === item.id);
        const lines = item.buy_sheet_lines || [];
        const sizes = lines.map((l: any) => l.size);
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const totalQty = lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);
        const decoLines = costProd
          ? calcDecorationLines({ ...costProd, totalQty }, allCostProds, printers)
          : [];
        const itemTotal = decoLines.reduce((a: number, l: any) => a + l.total, 0);
        grandTotal += itemTotal;
        const supplier = costProd?.supplier || item.blank_vendor || "";
        const incoming = item.incoming_goods || (supplier ? "Blanks from " + supplier : "");
        return {
          id: item.id,
          name: item.name,
          letter: cLetterMap[item.id] || "",
          garmentType: item.garment_type,
          blankVendor: item.blank_vendor,
          blankSku: item.blank_sku || costProd?.color || "",
          pipelineStage: item.pipeline_stage || "complete",
          driveLink: item.drive_link,
          incomingGoods: incoming,
          productionNotes: item.production_notes_po,
          packingNotes: item.packing_notes,
          shipTracking: item.ship_tracking,
          shipQtys: item.ship_qtys,
          sizes,
          qtys,
          totalQty,
          decoLines,
          itemTotal,
          mockupThumb: cMockupByItem[item.id] ? `/api/files/thumbnail?id=${cMockupByItem[item.id]}` : null,
          blanksOrdered: ((item as any).blanks_order_cost ?? 0) > 0,
        };
      });

      const totalUnits = orderItems.reduce((a: number, i: any) => a + i.totalQty, 0);

      const poSentDate = typeMeta.po_sent_dates?.[decorator.name]
        || typeMeta.po_sent_dates?.[decorator.short_code]
        || null;
      const vendorShipDate = typeMeta.po_ship_dates?.[decorator.name]
        || typeMeta.po_ship_dates?.[decorator.short_code]
        || job.target_ship_date;

      completedOrders.push({
        jobId: job.id,
        jobNumber: job.job_number || "",
        jobTitle: job.title || "",
        clientName: clientMap[job.client_id] || "",
        phase: job.phase,
        shipDate: vendorShipDate,
        shippingRoute: job.shipping_route,
        poSent,
        poSentDate,
        shipTo: poShipTo,
        shipMethod: poShipMethod,
        shippingAccount: typeMeta.shipping_account || "",
        grandTotal,
        totalUnits,
        items: orderItems,
      });
    }

    return NextResponse.json({
      decorator: { name: decorator.name, shortCode: decorator.short_code },
      orders,
      completed: completedOrders,
      completedTotal: completedTotal || 0,
      completedOffset,
    });
  } catch (e: any) {
    console.error("Vendor portal GET error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// ── POST: Decorator actions ──
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const sb = admin();

    // Validate token
    const { data: decorator } = await sb
      .from("decorators")
      .select("id, name")
      .eq("external_token", params.token)
      .single();

    if (!decorator) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const { action, itemId, jobId, tracking, carrier, note, shipQtys } = body;

    // Notifications table deprecated — bell UI was removed. Helper is a no-op.
    async function notify(_message: string, _type: string, _refId: string) {
      return;
    }

    // Helper: get item + job info
    async function getItemContext(iId: string) {
      const { data: item } = await sb.from("items").select("id, name, job_id").eq("id", iId).single();
      if (!item) return null;
      const { data: job } = await sb.from("jobs").select("id, title, job_number, shipping_route").eq("id", item.job_id).single();
      return { item, job };
    }

    // (confirm_received / undo_received actions removed — HPD doesn't
    // need that vendor-side acknowledgement and the button was deleted
    // from the portal. Discrepancy reporting is the only flag vendors
    // actively send back.)

    // ── ENTER TRACKING: Item shipped from decorator ──
    if (action === "enter_tracking" && itemId && tracking) {
      const updates: any = {
        pipeline_stage: "shipped",
        ship_tracking: tracking,
      };
      if (shipQtys) updates.ship_qtys = shipQtys;

      await sb.from("items").update(updates).eq("id", itemId);
      await sb.from("decorator_assignments").update({
        pipeline_stage: "shipped",
        tracking_number: tracking,
        actual_completion_date: new Date().toISOString().split("T")[0],
      }).eq("item_id", itemId).eq("decorator_id", decorator.id);

      const ctx = await getItemContext(itemId);
      if (ctx) {
        const carrierText = carrier ? ` via ${carrier}` : "";
        await sb.from("job_activity").insert({
          job_id: ctx.job.id, user_id: null, type: "auto",
          message: `Shipped by ${decorator.name}${carrierText} — ${ctx.item.name} · Tracking: ${tracking}`,
        });
        await notify(
          `Shipped — ${ctx.item.name} · ${ctx.job.title}${carrierText} · ${tracking}`,
          "production", ctx.job.id
        );

        // Auto-email client if drop_ship and all decorator's items on this job are now shipped.
        // Same path ProductionTab uses — notify route handles idempotency.
        if (ctx.job.shipping_route === "drop_ship") {
          try {
            const { data: decoratorItems } = await sb
              .from("items")
              .select("id, pipeline_stage")
              .eq("job_id", ctx.job.id)
              .eq("decorator", decorator.name);
            const allShipped = (decoratorItems || []).every(
              (it: any) => it.id === itemId || it.pipeline_stage === "shipped"
            );
            if (allShipped) {
              const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
              await fetch(`${baseUrl}/api/email/notify`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
                },
                body: JSON.stringify({
                  jobId: ctx.job.id,
                  type: "order_shipped_vendor",
                  decoratorId: decorator.id,
                  vendorName: decorator.name,
                  trackingNumber: tracking,
                  carrier: carrier || undefined,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }
      return NextResponse.json({ success: true });
    }

    // ── FLAG ISSUE: Vendor reports a discrepancy ──
    // Three places it surfaces for HPD:
    //   1. decorator_assignments.last_issue_note + last_issue_at — the
    //      structured signal the Command Center decorators bucket reads.
    //   2. job_activity entry — historical trace on the project page.
    //   3. Email to production@housepartydistro.com — so the team sees
    //      the alert immediately even if no one's looking at the dashboard.
    if (action === "flag_issue" && itemId && note) {
      await sb.from("decorator_assignments").update({
        last_issue_note: note,
        last_issue_at: new Date().toISOString(),
        issue_resolved_at: null,
      }).eq("item_id", itemId).eq("decorator_id", decorator.id);

      const ctx = await getItemContext(itemId);
      if (ctx) {
        await sb.from("job_activity").insert({
          job_id: ctx.job.id, user_id: null, type: "auto",
          message: `Issue flagged by ${decorator.name} for ${ctx.item.name}: "${note}"`,
        });

        // Email production@ — same address PO emails use as their
        // From, so replies thread back to the right inbox.
        try {
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            const resend = new Resend(resendKey);
            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
              || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
            const projectRef = ctx.job.job_number || ctx.job.title;
            await resend.emails.send({
              from: process.env.EMAIL_FROM_PO || "production@housepartydistro.com",
              to: "production@housepartydistro.com",
              subject: `Vendor discrepancy — ${decorator.name} · ${ctx.item.name} · ${projectRef}`,
              html: renderBrandedEmail({
                heading: `Vendor flagged a discrepancy`,
                bodyHtml: `<strong>${decorator.name}</strong> reported an issue on <strong>${ctx.item.name}</strong> (${projectRef}):<br/><br/><em>"${note.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}"</em>`,
                cta: { label: "Open project", url: `${baseUrl}/jobs/${ctx.job.id}`, style: "dark" },
                hint: "Reply directly to this thread to follow up with the vendor on next steps.",
                closing: "House Party Distro",
                align: "left",
              }),
            });
          }
        } catch (e) {
          console.error("[vendor portal] discrepancy email failed:", (e as any)?.message);
        }
      }
      return NextResponse.json({ success: true });
    }

    // (bulk_confirm action removed — was the bulk equivalent of the
    // deleted Mark Blanks Received button. Vendor portal no longer
    // surfaces a bulk action.)

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("Vendor portal POST error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

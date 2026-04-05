import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendClientNotification } from "@/lib/auto-email";

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

    if (!activeJobs?.length) {
      return NextResponse.json({
        decorator: { name: decorator.name },
        orders: [],
        completed: [],
      });
    }

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

    // For each active job, find items that belong to this decorator
    const orders: any[] = [];
    const completed: any[] = [];

    for (const job of activeJobs) {
      const costingData = job.costing_data as any;
      if (!costingData?.costProds?.length) continue;

      // Find items in this job assigned to this decorator
      const decItems = costingData.costProds.filter((cp: any) =>
        cp.printVendor === decorator.name || cp.printVendor === decorator.short_code
      );

      if (decItems.length === 0) continue;

      const itemIds = decItems.map((cp: any) => cp.id);

      // Fetch full item data
      const { data: items } = await sb
        .from("items")
        .select("id, name, garment_type, blank_vendor, blank_sku, pipeline_stage, drive_link, incoming_goods, production_notes_po, packing_notes, ship_tracking, ship_qtys, blanks_order_number, sort_order, buy_sheet_lines(size, qty_ordered)")
        .in("id", itemIds)
        .order("sort_order");

      if (!items?.length) continue;

      // Build order data
      const typeMeta = (job.type_meta || {}) as any;
      const poSent = (typeMeta.po_sent_vendors || []).includes(decorator.name) ||
                     (typeMeta.po_sent_vendors || []).includes(decorator.short_code);

      // Get ship-to address for this vendor
      const poShipTo = typeMeta.po_ship_to?.[decorator.name] || typeMeta.po_ship_to?.[decorator.short_code] || null;
      const poShipMethod = typeMeta.po_ship_methods?.[decorator.name] || typeMeta.po_ship_methods?.[decorator.short_code] || null;

      const orderItems = items.map((item: any) => {
        const costProd = decItems.find((cp: any) => cp.id === item.id);
        const assignment = (assignments || []).find((a: any) => a.item_id === item.id);
        const lines = item.buy_sheet_lines || [];
        const sizes = lines.map((l: any) => l.size);
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const totalQty = lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);

        // Build decoration summary from costing
        const printLocations: string[] = [];
        if (costProd?.printLocations) {
          for (const [loc, data] of Object.entries(costProd.printLocations)) {
            if ((data as any)?.location || (data as any)?.screens > 0) {
              printLocations.push((data as any)?.location || `Location ${loc}`);
            }
          }
        }

        return {
          id: item.id,
          name: item.name,
          garmentType: item.garment_type,
          blankVendor: item.blank_vendor,
          blankSku: item.blank_sku,
          pipelineStage: item.pipeline_stage || "pending",
          driveLink: item.drive_link,
          incomingGoods: item.incoming_goods,
          productionNotes: item.production_notes_po,
          packingNotes: item.packing_notes,
          shipTracking: item.ship_tracking,
          shipQtys: item.ship_qtys,
          sizes,
          qtys,
          totalQty,
          printLocations,
          blanksOrdered: !!item.blanks_order_number,
        };
      });

      const isAllComplete = orderItems.every((i: any) => i.pipelineStage === "shipped" || i.pipelineStage === "complete");

      const order = {
        jobId: job.id,
        jobNumber: job.job_number,
        jobTitle: job.title,
        clientName: clientMap[job.client_id] || "Client",
        phase: job.phase,
        shipDate: job.target_ship_date,
        shippingRoute: job.shipping_route,
        poSent,
        shipTo: poShipTo,
        shipMethod: poShipMethod,
        items: orderItems,
      };

      if (isAllComplete) {
        completed.push(order);
      } else {
        orders.push(order);
      }
    }

    // Sort: soonest ship date first for active, most recent for completed
    orders.sort((a: any, b: any) => {
      if (!a.shipDate) return 1;
      if (!b.shipDate) return -1;
      return new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime();
    });

    return NextResponse.json({
      decorator: { name: decorator.name },
      orders,
      completed: completed.slice(0, 10),
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

    // Helper: notify team
    async function notify(message: string, type: string, refId: string) {
      const { data: profiles } = await sb.from("profiles").select("id");
      if (profiles?.length) {
        await sb.from("notifications").insert(
          profiles.map((p: any) => ({
            user_id: p.id,
            type,
            message,
            reference_id: refId,
            reference_type: "job",
          }))
        );
      }
    }

    // Helper: get item + job info
    async function getItemContext(iId: string) {
      const { data: item } = await sb.from("items").select("id, name, job_id").eq("id", iId).single();
      if (!item) return null;
      const { data: job } = await sb.from("jobs").select("id, title, job_number, shipping_route").eq("id", item.job_id).single();
      return { item, job };
    }

    // ── CONFIRM RECEIVED: Decorator acknowledges the PO ──
    if (action === "confirm_received" && itemId) {
      await sb.from("items").update({ pipeline_stage: "in_production" }).eq("id", itemId);
      await sb.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("item_id", itemId).eq("decorator_id", decorator.id);

      const ctx = await getItemContext(itemId);
      if (ctx) {
        await sb.from("job_activity").insert({
          job_id: ctx.job.id, user_id: null, type: "auto",
          message: `${decorator.name} confirmed receipt — ${ctx.item.name} is in production`,
        });
        await notify(
          `In production — ${ctx.item.name} · ${ctx.job.title} (${decorator.name})`,
          "production", ctx.job.id
        );
      }
      return NextResponse.json({ success: true });
    }

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

        // Auto-email client if drop_ship (goes direct to them)
        if (ctx.job.shipping_route === "drop_ship") {
          sendClientNotification({
            jobId: ctx.job.id,
            type: "tracking_update",
            itemName: ctx.item.name,
            trackingNumber: tracking,
            carrier: carrier || undefined,
          }).catch(() => {});
        }
      }
      return NextResponse.json({ success: true });
    }

    // ── FLAG ISSUE: Decorator reports a problem ──
    if (action === "flag_issue" && itemId && note) {
      const ctx = await getItemContext(itemId);
      if (ctx) {
        await sb.from("job_activity").insert({
          job_id: ctx.job.id, user_id: null, type: "auto",
          message: `Issue flagged by ${decorator.name} for ${ctx.item.name}: "${note}"`,
        });
        await notify(
          `Issue flagged — ${ctx.item.name} · ${ctx.job.title} · ${decorator.name}: "${note}"`,
          "alert", ctx.job.id
        );
      }
      return NextResponse.json({ success: true });
    }

    // ── BULK CONFIRM: Multiple items at once ──
    if (action === "bulk_confirm" && body.itemIds?.length) {
      for (const iId of body.itemIds) {
        await sb.from("items").update({ pipeline_stage: "in_production" }).eq("id", iId);
        await sb.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("item_id", iId).eq("decorator_id", decorator.id);
      }
      const ctx = await getItemContext(body.itemIds[0]);
      if (ctx) {
        await sb.from("job_activity").insert({
          job_id: ctx.job.id, user_id: null, type: "auto",
          message: `${decorator.name} confirmed receipt of ${body.itemIds.length} item(s) — in production`,
        });
        await notify(
          `In production — ${body.itemIds.length} items · ${ctx.job.title} (${decorator.name})`,
          "production", ctx.job.id
        );
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("Vendor portal POST error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendClientNotification } from "@/lib/auto-email";
import { buildPrintersMap, calcDecorationLines } from "@/lib/pricing";
import { overlayCostProds } from "@/lib/costing-summary";
import { Resend } from "resend";
import { renderBrandedEmail } from "@/lib/email-template";
import { shipFromProduction } from "@/lib/production2-ship";
import { getPdfBranding } from "@/lib/branding";
import { ensureTracker } from "@/lib/inbound-tracking";

// costProds in ITEM sort order — "first item in a share group" (who carries
// the screen fees) resolves by array position in the pricing engine; every
// surface must order like the costing UI / PO PDF or screens land on the
// wrong item (or read as missing).
function orderProdsByItemSort(costProds: any[], itemsById: Record<string, any>): any[] {
  return [...(costProds || [])].sort((a: any, b: any) =>
    ((itemsById[a?.id]?.sort_order ?? 1e9) as number) - ((itemsById[b?.id]?.sort_order ?? 1e9) as number));
}

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// Batch-prefetch everything the per-job shaping loops need. The loops used to
// run 3 sequential queries PER JOB (items, mockups, letter map) — ~170 round
// trips for a busy vendor ≈ 9s. Now it's ~6 chunked queries total.
async function prefetchJobData(sb: any, jobs: any[], decorator: any) {
  const wantedIds: string[] = [];
  const jobIds: string[] = [];
  for (const job of jobs || []) {
    const cps = (job.costing_data as any)?.costProds || [];
    const dec = cps.filter((cp: any) => cp.printVendor === decorator.name || cp.printVendor === decorator.short_code);
    if (dec.length) { jobIds.push(job.id); for (const cp of dec) if (cp.id) wantedIds.push(cp.id); }
  }
  const itemsById: Record<string, any> = {};
  for (let i = 0; i < wantedIds.length; i += 150) {
    const { data } = await sb.from("items")
      .select("id, job_id, name, garment_type, blank_vendor, blank_sku, pipeline_stage, drive_link, incoming_goods, production_notes_po, packing_notes, ship_tracking, ship_qtys, blanks_order_number, blanks_order_cost, sort_order, buy_sheet_lines(size, qty_ordered)")
      .in("id", wantedIds.slice(i, i + 150));
    for (const it of (data || [])) itemsById[it.id] = it;
  }
  const mockupByItem: Record<string, string> = {};
  for (let i = 0; i < wantedIds.length; i += 150) {
    const { data } = await sb.from("item_files").select("item_id, drive_file_id")
      .in("item_id", wantedIds.slice(i, i + 150)).eq("stage", "mockup")
      .order("created_at", { ascending: false });
    for (const f of (data || [])) if (!mockupByItem[f.item_id]) mockupByItem[f.item_id] = f.drive_file_id;
  }
  const lettersByJob: Record<string, Record<string, string>> = {};
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data } = await sb.from("items").select("id, job_id, sort_order").in("job_id", jobIds.slice(i, i + 150)).order("sort_order");
    const grouped: Record<string, any[]> = {};
    for (const it of (data || [])) (grouped[it.job_id] ||= []).push(it);
    for (const jid of Object.keys(grouped)) {
      const m: Record<string, string> = {};
      grouped[jid].forEach((it: any, idx: number) => { m[it.id] = String.fromCharCode(65 + idx); });
      lettersByJob[jid] = m;
    }
  }
  return { itemsById, mockupByItem, lettersByJob };
}

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

    // Candidate jobs SQL-side: every job that has an item assigned to this
    // decorator. Replaces the old "load EVERY job's costing_data and filter in
    // JS" scan that made the portal crawl as history grew. (Assignments are
    // auto-created whenever costing maps a printVendor, so membership matches
    // the old costProds check in practice.)
    const candidateJobIds = new Set<string>();
    for (let i = 0; i < assignedItemIds.length; i += 200) {
      const { data: itemJobs } = await sb.from("items").select("job_id").in("id", assignedItemIds.slice(i, i + 200));
      for (const r of (itemJobs || [])) if ((r as any).job_id) candidateJobIds.add((r as any).job_id);
    }
    const candidateIds = Array.from(candidateJobIds);

    // Fast path (?job_id=): the order page needs exactly ONE order — load just
    // that job (any phase) and skip the company-wide completed scan below.
    // Without it this endpoint reads every job's costing_data JSONB, which
    // grows with history and was making the portal crawl.
    const jobIdParam = req.nextUrl.searchParams.get("job_id");
    // Hub initial load passes skip_completed=1 — the Past tab lazy-loads its
    // history on first open instead of paying the scan on every page view.
    const skipCompleted = req.nextUrl.searchParams.get("skip_completed") === "1";

    // Also find items where costing references this decorator by name
    // We query all items from active jobs and check costing_data
    let activeJobsQuery = sb
      .from("jobs")
      .select("id, title, job_number, phase, target_ship_date, type_meta, client_id, costing_data, shipping_route")
      .order("target_ship_date", { ascending: true });
    activeJobsQuery = jobIdParam
      ? activeJobsQuery.eq("id", jobIdParam)
      : activeJobsQuery.in("phase", ["intake", "pending", "ready", "production", "receiving", "fulfillment"]).in("id", candidateIds);
    const { data: activeJobs } = jobIdParam || candidateIds.length ? await activeJobsQuery : { data: [] as any[] };

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

    // Load decorator pricing for decoration line calculations — only THIS
    // vendor's rates are ever looked up (items here all print with them).
    const { data: allDecs } = await sb
      .from("decorators")
      .select("name, short_code, pricing_data")
      .eq("id", decorator.id);
    const printers = buildPrintersMap(allDecs || []);

    // For each active job, find items that belong to this decorator
    const orders: any[] = [];
    const completed: any[] = [];
    const pre = await prefetchJobData(sb, activeJobs || [], decorator);

    for (const job of activeJobs || []) {
      const costingData = job.costing_data as any;
      if (!costingData?.costProds?.length) continue;

      // Live-truth overlay before pricing — share-group partners must carry
      // buy-sheet totalQty, not the stored copy (see PO route note).
      const allCostProds = orderProdsByItemSort(overlayCostProds(costingData.costProds || [], Object.values(pre.itemsById || {})), pre.itemsById);

      // Find items in this job assigned to this decorator
      const decItems = allCostProds.filter((cp: any) =>
        cp.printVendor === decorator.name || cp.printVendor === decorator.short_code
      );

      if (decItems.length === 0) continue;

      const itemIds = decItems.map((cp: any) => cp.id);

      // Item data / mockups / letters — from the batch prefetch (no per-job queries)
      const items = itemIds.map((id: string) => pre.itemsById[id]).filter(Boolean)
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      if (!items?.length) continue;

      // Build order data
      const typeMeta = (job.type_meta || {}) as any;
      const poSent = (typeMeta.po_sent_vendors || []).includes(decorator.name) ||
                     (typeMeta.po_sent_vendors || []).includes(decorator.short_code);

      // Only show jobs where PO has been sent to this decorator
      if (!poSent) continue;

      const mockupByItem = pre.mockupByItem;
      const letterMap: Record<string, string> = pre.lettersByJob[job.id] || {};

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
          mockupThumb: mockupByItem[item.id] ? `/api/files/thumbnail?id=${mockupByItem[item.id]}&thumb=1&size=400` : null,
          blanksOrdered: (item as any).blanks_order_cost != null,
          // impressions = units × print passes per garment: ACTIVE locations
          // (named + colors set — a named-but-empty row isn't printed) + the
          // tag print (it's a printed pass too, repeat or not).
          impressions: totalQty * (
            Object.values((costProd?.printLocations || {}) as Record<string, any>).filter((l: any) => l?.location && (parseFloat(l?.screens) || 0) > 0).length
            + (costProd?.tagPrint ? 1 : 0)
          ),
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
        // DELIBERATE (Jon): vendors get the QB invoice number as the PO
        // reference — their invoices then match our invoiced jobs 1:1.
        // Do NOT "fix" this to job_number.
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
      } else {
        // Vendor's items are all shipped, but the JOB might still be
        // in production/receiving/fulfillment because HPD hasn't
        // received them yet. From the vendor's POV their work is done,
        // so show this order under Completed regardless of job phase.
        completed.push(order);
      }
    }

    // Sort active: ASAP first, then soonest ship date, then no-date last.
    orders.sort((a: any, b: any) => {
      if (a.shipDate === "ASAP" && b.shipDate !== "ASAP") return -1;
      if (b.shipDate === "ASAP" && a.shipDate !== "ASAP") return 1;
      if (!a.shipDate) return 1;
      if (!b.shipDate) return -1;
      return new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime();
    });

    // ── Completed orders — this vendor only, paginated, searchable ──
    // Vendor membership lives in costing_data.costProds[].printVendor (JSONB), which can't
    // be filtered or counted in SQL. So load all complete jobs and filter in JS — the same
    // way the active side above does — then paginate the FILTERED set. (Previously this used
    // a raw count() over every complete job, so "Past (N)" showed all completed jobs
    // company-wide, not just the ones sent to this vendor.)
    let allCompletedQuery = sb
      .from("jobs")
      .select("id, title, job_number, phase, target_ship_date, type_meta, client_id, costing_data, shipping_route")
      .in("phase", ["complete"])
      .in("id", candidateIds)
      .order("job_number", { ascending: false });

    if (completedSearch) {
      allCompletedQuery = allCompletedQuery.or(`job_number.ilike.%${completedSearch}%,title.ilike.%${completedSearch}%`);
    }

    // job_id fast path / skip_completed: don't scan the whole completed
    // history (every job's costing_data JSONB — the slow part of this route).
    const { data: allCompletedJobs } = (jobIdParam || skipCompleted) ? { data: [] as any[] } : await allCompletedQuery;

    const vendorCompletedJobs = (allCompletedJobs || []).filter((job: any) => {
      const cps = (job.costing_data as any)?.costProds;
      if (!cps?.length) return false;
      return cps.some((cp: any) =>
        cp.printVendor === decorator.short_code || cp.printVendor === decorator.name
      );
    });

    const completedTotal = vendorCompletedJobs.length;
    const completedJobs = vendorCompletedJobs.slice(completedOffset, completedOffset + completedLimit);

    // Load any missing client names for completed jobs
    const missingClientIds = (completedJobs || []).map((j: any) => j.client_id).filter((id: string) => id && !clientMap[id]);
    if (missingClientIds.length > 0) {
      const { data: moreClients } = await sb.from("clients").select("id, name").in("id", [...new Set(missingClientIds)]);
      for (const c of (moreClients || [])) clientMap[c.id] = c.name;
    }

    const completedOrders: any[] = [];
    const cPre = await prefetchJobData(sb, completedJobs || [], decorator);
    for (const job of (completedJobs || [])) {
      const costingData = job.costing_data as any;
      if (!costingData?.costProds?.length) continue;
      const allCostProds = orderProdsByItemSort(overlayCostProds(costingData.costProds || [], Object.values(cPre.itemsById || {})), cPre.itemsById);
      const decItems = allCostProds.filter((cp: any) =>
        cp.printVendor === decorator.short_code || cp.printVendor === decorator.name
      );
      if (decItems.length === 0) continue;

      const itemIds = decItems.map((cp: any) => cp.id);
      const cItems = itemIds.map((id: string) => cPre.itemsById[id]).filter(Boolean)
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      if (!cItems?.length) continue;

      const typeMeta = (job.type_meta || {}) as any;
      const poSent = (typeMeta.po_sent_vendors || []).includes(decorator.name) ||
                     (typeMeta.po_sent_vendors || []).includes(decorator.short_code);

      const cMockupByItem = cPre.mockupByItem;
      const cLetterMap: Record<string, string> = cPre.lettersByJob[job.id] || {};

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
          mockupThumb: cMockupByItem[item.id] ? `/api/files/thumbnail?id=${cMockupByItem[item.id]}&thumb=1&size=400` : null,
          blanksOrdered: (item as any).blanks_order_cost != null,
          // impressions = units × print passes per garment: ACTIVE locations
          // (named + colors set — a named-but-empty row isn't printed) + the
          // tag print (it's a printed pass too, repeat or not).
          impressions: totalQty * (
            Object.values((costProd?.printLocations || {}) as Record<string, any>).filter((l: any) => l?.location && (parseFloat(l?.screens) || 0) > 0).length
            + (costProd?.tagPrint ? 1 : 0)
          ),
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

    // Merge vendor-done-but-job-not-complete orders into the completed
    // list. They appear first (most recent activity) since they're
    // freshly shipped. Search applies to them too so the search field
    // doesn't show non-matching results above matches.
    const completedSearchLower = completedSearch.toLowerCase();
    const completedFromActive = completedSearch
      ? completed.filter(o =>
          (o.jobNumber || "").toLowerCase().includes(completedSearchLower) ||
          (o.jobTitle || "").toLowerCase().includes(completedSearchLower))
      : completed;
    const mergedCompleted = completedOffset === 0
      ? [...completedFromActive, ...completedOrders]
      : completedOrders;

    // Bill-to from tenant branding — the SAME source the PO PDF renders, so
    // the portal can never disagree with the paper (was hardcoded stale).
    const branding = await getPdfBranding().catch(() => null);
    const billTo = branding ? {
      name: branding.name,
      addressHtml: branding.billToAddressHtml,
      email: branding.fromEmailBilling || "",
    } : null;

    return NextResponse.json({
      decorator: { name: decorator.name, shortCode: decorator.short_code },
      billTo,
      orders,
      completed: mergedCompleted,
      completedTotal: (completedTotal || 0) + (completedOffset === 0 ? completedFromActive.length : 0),
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

    // Helper: get item + job info
    async function getItemContext(iId: string) {
      const { data: item } = await sb.from("items").select("id, name, job_id").eq("id", iId).single();
      if (!item) return null;
      const { data: job } = await sb.from("jobs").select("id, title, job_number, shipping_route, companies:company_id(slug)").eq("id", item.job_id).single();
      return { item, job };
    }

    // (confirm_received / undo_received actions removed — HPD doesn't
    // need that vendor-side acknowledgement and the button was deleted
    // from the portal. Discrepancy reporting is the only flag vendors
    // actively send back.)

    // ── ENTER TRACKING: Item shipped from decorator ──
    // Routes through the SAME ship path production2 uses (shipFromProduction:
    // shipment box + ledger movement + item state + phase recalc). The old
    // handler wrote only the flat item fields, so vendor-entered ships never
    // created a box — invisible to receiving2 and the ledger (fixed
    // 2026-07-16, tracking-plan phase 1).
    if (action === "enter_tracking" && itemId && tracking) {
      const ctx = await getItemContext(itemId);
      if (!ctx || !ctx.job) return NextResponse.json({ error: "Item not found" }, { status: 404 });

      // qtys for the wave: vendor-entered per-size counts, else the full order
      let qtys: Record<string, number> = shipQtys || {};
      if (!Object.values(qtys).some(n => Number(n) > 0)) {
        const { data: bsl } = await sb.from("buy_sheet_lines").select("size, qty_ordered").eq("item_id", itemId);
        qtys = {};
        for (const l of bsl || []) qtys[l.size] = (qtys[l.size] || 0) + (Number(l.qty_ordered) || 0);
      }

      const shipRes = await shipFromProduction(sb, {
        method: "tracking", tracking, carrier: carrier || null,
        decoratorId: decorator.id, decoratorName: decorator.name,
        items: [{ itemId, jobId: ctx.job.id, itemName: ctx.item.name, qtys, final: false }],
      });
      if (!shipRes.ok) return NextResponse.json({ error: shipRes.error || "Ship failed" }, { status: 500 });

      // vendor-portal-specific stamps shipFromProduction doesn't own
      await sb.from("decorator_assignments").update({
        tracking_number: tracking,
        actual_completion_date: new Date().toISOString().split("T")[0],
      }).eq("item_id", itemId).eq("decorator_id", decorator.id);

      // register live tracking on the new box(es) — guarded, never throws
      for (const boxId of shipRes.boxIds) {
        await ensureTracker(sb, boxId).catch(() => {});
      }

      if (ctx) {
        const carrierText = carrier ? ` via ${carrier}` : "";
        await sb.from("job_activity").insert({
          job_id: ctx.job!.id, user_id: null, type: "auto",
          message: `Shipped by ${decorator.name}${carrierText} — ${ctx.item.name} · Tracking: ${tracking}`,
        });

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
          job_id: ctx.job!.id, user_id: null, type: "auto",
          message: `Issue flagged by ${decorator.name} for ${ctx.item.name}: "${note}"`,
        });

        // Email production@ — same address PO emails use as their
        // From, so replies thread back to the right inbox.
        try {
          const { resendForSlug } = await import("@/lib/resend-client");
          const tenantSlug = ((ctx.job as any)?.companies?.slug || "hpd") as string;
          const resend = resendForSlug(tenantSlug);
          if (resend) {
            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
              || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
            const projectRef = ctx.job!.job_number || ctx.job!.title;
            await resend.emails.send({
              from: process.env.EMAIL_FROM_PO || "production@housepartydistro.com",
              to: "production@housepartydistro.com",
              subject: `Vendor discrepancy — ${decorator.name} · ${ctx.item.name} · ${projectRef}`,
              html: renderBrandedEmail({
                heading: `Vendor flagged a discrepancy`,
                bodyHtml: `<strong>${decorator.name}</strong> reported an issue on <strong>${ctx.item.name}</strong> (${projectRef}):<br/><br/><em>"${note.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}"</em>`,
                cta: { label: "Open project", url: `${baseUrl}/jobs/${ctx.job!.id}`, style: "dark" },
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

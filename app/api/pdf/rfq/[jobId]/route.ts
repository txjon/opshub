export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding } from "@/lib/branding";

// RFQ PDF — mirrors PO layout (so the cohesive look carries when the
// same decorator later receives the actual PO) but strips per-line cost
// rates, totals, and grand totals. In their place each item shows a
// "decoration spec" panel: print locations, color counts, tag, specialty,
// finishing/packaging — everything the decorator needs to quote.

const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
const sortSizes = (sizes: string[]) => [...sizes].sort((a, b) => {
  const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1; if (bi === -1) return -1;
  return ai - bi;
});

// Build a list of decoration spec lines per item — what the decorator
// needs to know to quote: each print location with color count + share
// flag, tag print spec, specialty effects, finishing/packaging needs,
// and any custom callouts. No rates or totals.
function buildDecoSpec(p: any): { label: string; detail: string }[] {
  const lines: { label: string; detail: string }[] = [];
  if (!p) return lines;

  // Print locations
  for (const loc of [1,2,3,4,5,6]) {
    const ld = p.printLocations?.[loc];
    if (!ld) continue;
    const name = ld.location;
    const screens = parseFloat(ld.screens) || 0;
    if (!name && !screens) continue;
    const parts: string[] = [];
    if (screens > 0) parts.push(`${screens} color${screens !== 1 ? "s" : ""}`);
    if (ld.shared && ld.shareGroup) parts.push(`shared (group ${ld.shareGroup})`);
    if (ld.puffColors) parts.push(`${ld.puffColors} puff`);
    lines.push({ label: name || `Location ${loc}`, detail: parts.join(" · ") || "—" });
  }

  // Tag print
  if (p.tagPrint) {
    lines.push({
      label: "Tag print",
      detail: [p.tagRepeat ? "repeat tag" : "new tag", p.tagShared ? `shared${p.tagShareGroup ? ` (group ${p.tagShareGroup})` : ""}` : ""].filter(Boolean).join(" · "),
    });
  }

  // Specialty (puff, glow, etc.)
  if (p.specialtyQtys) {
    const activeLocs = [1,2,3,4,5,6].filter(l => {
      const ld = p.printLocations?.[l];
      return ld?.location || ld?.screens > 0;
    }).length;
    for (const k of Object.keys(p.specialtyQtys)) {
      if (k.endsWith("_on") && p.specialtyQtys[k]) {
        const name = k.replace("_on", "");
        if (name.toLowerCase().includes("fleece")) continue; // fleece handled by toggle
        const stored = p.specialtyQtys[name + "_count"] || 0;
        const count = stored > 0 && stored < activeLocs ? stored : activeLocs;
        lines.push({ label: name.replace(/([A-Z])/g, " $1").trim(), detail: count > 0 ? `${count} location${count !== 1 ? "s" : ""}` : "—" });
      }
    }
  }

  // Fleece flag
  if (p.isFleece) lines.push({ label: "Fleece upcharge", detail: "applies" });

  // Finishing & packaging
  if (p.finishingQtys) {
    if (p.finishingQtys["Packaging_on"]) {
      const variant = p.isFleece ? "Fleece" : (p.finishingQtys["Packaging_variant"] || "Tee");
      lines.push({ label: "Packaging", detail: variant });
    }
    for (const fk of Object.keys(p.finishingQtys)) {
      if (fk.endsWith("_on") && p.finishingQtys[fk] && fk !== "Packaging_on") {
        const key = fk.replace("_on", "");
        lines.push({ label: key.replace(/([A-Z])/g, " $1").trim(), detail: "yes" });
      }
    }
  }

  // Custom callouts
  for (const c of (p.customCosts || [])) {
    if (c.desc) lines.push({ label: c.desc, detail: "custom" });
  }

  return lines;
}


function renderRFQHTML(data: any): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;
  const mono = `ui-monospace, monospace`;

  const itemBlocks = data.items.map((item: any) => {
    const lines = sortSizes(Object.keys(item.qtys).filter((sz: string) => (item.qtys[sz] || 0) > 0));
    const sizeStr = lines.map((sz: string) => `${sz} ${item.qtys[sz]}`).join("  ·  ");
    const incoming = item.incoming_goods || (item.supplier ? "Blanks from " + item.supplier : "");
    const decoSpec: { label: string; detail: string }[] = item.decoSpec || [];

    const decoSection = decoSpec.length > 0 ? `
      <div style="margin-top:6px;border-top:0.5px solid #e8e8e8;padding-top:5px">
        <div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:3px">Decoration spec — please quote</div>
        <table style="width:100%;border-collapse:collapse;font-size:9px">
          ${decoSpec.map((l: any) => `
            <tr>
              <td style="padding:1px 0;color:#444;font-weight:600;width:40%">${l.label}</td>
              <td style="padding:1px 0;color:#666">${l.detail}</td>
            </tr>`).join("")}
        </table>
      </div>` : "";

    const thumbHtml = item.mockupThumb ? `<img src="${item.mockupThumb}" style="height:120px;width:auto;object-fit:contain;border-radius:4px;background:#f7f7f7;flex-shrink:0" crossorigin="anonymous" />` : "";

    return `<div style="border-left:3px solid #1a1a1a;padding-left:16px;margin-bottom:16px;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700">${item.letter} — ${item.name}</div>
        <div style="font-size:10px;color:#888">${item.totalQty.toLocaleString()} units</div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:4px;font-size:9px;color:#555">
        ${item.blank_vendor ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Brand</span>${item.blank_vendor}</div>` : ""}
        ${item.blank_sku ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Color</span>${item.blank_sku}</div>` : ""}
      </div>
      ${sizeStr ? `<div style="font-size:9px;color:#555;padding:3px 8px;background:#f7f7f7;border-radius:3px;margin-bottom:4px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;margin-right:6px">Sizes</span>${sizeStr}
      </div>` : ""}
      ${item.drive_link ? `<div style="font-size:9px;margin-bottom:4px;padding:3px 8px;background:#f0f5ff;border-radius:3px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-right:6px">Art / reference</span>
        <a href="${item.drive_link}" style="color:#1a56db">${item.drive_link}</a>
      </div>` : ""}
      <div style="display:flex;gap:16px;align-items:flex-start">
        ${thumbHtml ? `<div style="flex-shrink:0">${thumbHtml}</div>` : ""}
        <div style="flex:1;min-width:0">${decoSection}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">
        ${incoming ? `<div style="background:#f9f9f9;padding:4px 8px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Incoming goods</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5">${incoming}</div>
        </div>` : "<div></div>"}
        ${item.production_notes_po ? `<div style="background:#f9f9f9;padding:4px 8px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Production notes</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5;white-space:pre-wrap">${item.production_notes_po}</div>
        </div>` : "<div></div>"}
        ${item.packing_notes ? `<div style="background:#f9f9f9;padding:4px 8px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Packing / shipping</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5;white-space:pre-wrap">${item.packing_notes}</div>
        </div>` : "<div></div>"}
      </div>
    </div>`;
  }).join("");

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const shipDate = data.target_ship_date
    ? new Date(data.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "—";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:780px;margin:0 auto">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #111;margin-bottom:18px">
    <div>
      ${data.branding.logoSvg}
      <div style="font-size:11px;color:#666;line-height:1.7;margin-top:8px">
        ${data.branding.headerAddressHtml.replace(/<br\/>/g, " · ")}${data.branding.fromEmailProduction ? "<br/>" + data.branding.fromEmailProduction : ""}
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a">QUOTE REQUEST</div>
      <div style="font-size:11px;color:#666;margin-top:2px;font-weight:600">HPD ${data.job_number || "—"}</div>
      <div style="font-size:10px;color:#888;margin-top:4px">${data.client_name} · ${data.vendor_name}</div>
    </div>
  </div>

  <div style="display:flex;gap:0;border:0.5px solid #ccc;margin-bottom:16px">
    ${[["Date",today],["Target ship",shipDate],["Vendor",data.vendor_short_code||data.vendor_name],["Items",String(data.items.length)],["Total units",data.items.reduce((a: number, it: any) => a + it.totalQty, 0).toLocaleString()]].map(([k,v],i,arr)=>`<div style="flex:1;padding:5px 8px;${i<arr.length-1?"border-right:0.5px solid #ccc":""}"><div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div><div style="font-size:10px;font-weight:600;color:#1a1a1a">${v}</div></div>`).join("")}
  </div>

  <div style="margin-bottom:16px;font-size:10px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa">Ship to <span style="color:#666">(for shipping cost estimate)</span></span>
      <span style="font-size:8px;padding:1px 6px;border-radius:99;background:${data.shipping_route === "drop_ship" ? "#dcfce7" : "#dbeafe"};color:${data.shipping_route === "drop_ship" ? "#15803d" : "#1d4ed8"};font-weight:600">${data.shipping_route === "drop_ship" ? "Drop ship" : "HPD warehouse"}</span>
    </div>
    <div style="line-height:1.7;white-space:pre-wrap">${data.ship_to_address || "—"}</div>
  </div>

  <div style="background:#fffbe6;border:0.5px solid #f0d000;padding:8px 12px;border-radius:4px;margin-bottom:16px;font-size:10px;color:#5a4400;line-height:1.5">
    <strong style="font-weight:700">This is a request for a quote, not a purchase order.</strong> Please review the decoration spec for each item below and reply with your pricing. We'll send a formal PO once pricing is confirmed and the client approves.
  </div>

  ${itemBlocks}

  <div style="border-top:0.5px solid #ddd;padding-top:10px;margin-top:8px;font-size:9px;color:#666;line-height:1.6">
    <strong style="font-size:10px;font-weight:700;color:#333;display:block;margin-bottom:4px">Notes for quoting</strong>
    Please confirm: per-unit decoration price for each item, any setup fees (screens, seps, etc.), expected lead time from blanks-in-hand to ready-to-ship, and any minimum-order considerations. If anything in the spec is unclear or if you need additional artwork or samples, reach out and we'll send through.
  </div>

</div>
</body></html>`;
}

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!internal) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const branding = await getPdfBranding();
    const { jobId } = params;
    const vendorFilter = req.nextUrl.searchParams.get("vendor") ?? null;
    const itemsParam = req.nextUrl.searchParams.get("items") ?? "";
    const itemIdsFilter = itemsParam ? itemsParam.split(",").filter(Boolean) : null;

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*, clients(name)")
      .eq("id", jobId)
      .single();

    if (jobError || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { data: items, error: itemsError } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId)
      .order("sort_order");

    if (itemsError) return NextResponse.json({ error: "Failed to fetch items", detail: itemsError?.message }, { status: 500 });

    // Mockup thumbnails
    const itemIds = (items || []).map((it: any) => it.id);
    const { data: mockupFiles } = await supabase
      .from("item_files")
      .select("item_id, drive_file_id")
      .in("item_id", itemIds)
      .eq("stage", "mockup")
      .order("created_at", { ascending: false });
    const mockupByItem: Record<string, string> = {};
    for (const f of (mockupFiles || [])) {
      if (!mockupByItem[f.item_id]) mockupByItem[f.item_id] = f.drive_file_id;
    }

    const costingData = job.costing_data || {};
    const costProds: any[] = costingData.costProds || [];

    const sortedItems = [...(items || [])].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

    const allMapped = sortedItems.map((it: any, sortedIdx: number) => {
      const qtys: Record<string, number> = {};
      for (const l of (it.buy_sheet_lines || [])) { qtys[l.size] = l.qty_ordered || 0; }
      const totalQty = Object.values(qtys).reduce((a: number, v: any) => a + v, 0);
      const cp = costProds.find((p: any) => p.id === it.id);
      const decoSpec = cp ? buildDecoSpec({ ...cp, totalQty }) : [];

      const mockupFileId = mockupByItem[it.id];
      return {
        id: it.id,
        name: it.name,
        blank_vendor: it.blank_vendor,
        blank_sku: it.blank_sku,
        drive_link: it.drive_link,
        mockupThumb: mockupFileId ? `https://lh3.googleusercontent.com/d/${mockupFileId}=w300` : null,
        incoming_goods: it.incoming_goods,
        production_notes_po: it.production_notes_po,
        packing_notes: it.packing_notes,
        printVendor: cp?.printVendor || "",
        supplier: cp?.supplier || "",
        qtys,
        totalQty,
        decoSpec,
        letter: String.fromCharCode(65 + sortedIdx),
      };
    });

    let mappedItems = allMapped.filter((it: any) => it.totalQty > 0);
    if (itemIdsFilter && itemIdsFilter.length > 0) {
      mappedItems = mappedItems.filter((it: any) => itemIdsFilter.includes(it.id));
    } else if (vendorFilter) {
      mappedItems = mappedItems.filter((it: any) => it.printVendor === vendorFilter);
    }

    if (mappedItems.length === 0) return NextResponse.json({ error: "No items selected for RFQ" }, { status: 404 });

    const vendorName = vendorFilter || mappedItems[0]?.printVendor || "Decorator";
    const { data: decoratorRecord } = await supabase
      .from("decorators").select("*").ilike("name", vendorName).single()
      .then((r: any) => r).catch(() => ({ data: null, error: null }));

    const itemLetters = mappedItems.map((it: any) => it.letter).join("");

    // Ship-to logic mirrors the PO route so decorators see the same address
    // they'll later receive on the actual purchase order. For drop-ship jobs
    // that's the client's venue; for ship-through/stage it's the active
    // tenant's warehouse (from companies.warehouse_address). If a per-vendor
    // override has already been entered on the PO tab, use that.
    // ship_through default — prefer fulfillment address (IHM uses HPD's
    // warehouse) then fall back to the tenant's own header address.
    const tenantWarehouse = `${branding.name}\n${(branding.fulfillmentAddressHtml || branding.headerAddressHtml).replace(/<br\/>/g, "\n")}`;
    const route = (job as any).shipping_route || "ship_through";
    const perVendorShipTo = (job.type_meta as any)?.po_ship_to?.[vendorName];
    const shipToAddress = perVendorShipTo
      || (route === "drop_ship"
        ? ((job.type_meta as any)?.venue_address || "Drop ship address — to be confirmed")
        : tenantWarehouse);

    const rfqData = {
      job_number: (job.job_number || "—") + (itemLetters ? `-${itemLetters}` : ""),
      client_name: (job.clients as any)?.name || "—",
      target_ship_date: job.target_ship_date,
      vendor_name: vendorName,
      vendor_short_code: (decoratorRecord as any)?.short_code || vendorName,
      ship_to_address: shipToAddress,
      shipping_route: route,
      items: mappedItems,
      branding,
    };

    const html = renderRFQHTML(rfqData);
    const pdfBuffer = await generatePDF(html);

    const slug = (job.title || jobId).replace(/\s+/g, "-");
    const vendorSlug = vendorName.replace(/\s+/g, "-");
    const filename = `HPD-RFQ-${job.job_number || jobId}${itemLetters ? `-${itemLetters}` : ""}-${vendorSlug}-${slug}.pdf`;

    const isDownload = req.nextUrl.searchParams.get("download");
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF RFQ Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}

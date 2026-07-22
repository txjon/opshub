import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderBrandedEmail, trackingBlock } from "@/lib/email-template";
import { resendForSlug } from "@/lib/resend-client";

// Production v2 — warehouse (or ready-for-pickup) notification. Its own path, no
// invoice gate. Emails warehouse@ with client → items → qtys (no job numbers) +
// links to the uploaded vendor packing slips + carrier/tracking. `test:true`
// sends to the caller instead so we can preview without spamming the warehouse.

const WAREHOUSE_EMAIL = "warehouse@housepartydistro.com";
const tot = (q: any) => Object.values(q || {}).reduce((a: number, n: any) => a + (Number(n) || 0), 0);
const sizeStr = (q: any) => Object.entries(q || {}).filter(([, n]) => (Number(n) || 0) > 0).map(([s, n]) => `${s} ${n}`).join(" · ");
const esc = (s: string) => String(s || "").replace(/</g, "&lt;");

export async function POST(req: NextRequest) {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { shipmentIds, note, test } = await req.json();
    if (!Array.isArray(shipmentIds) || !shipmentIds.length) return NextResponse.json({ error: "No shipments" }, { status: 400 });

    const { data: ships } = await sb.from("shipments").select("id, tracking, carrier, pickup, decorators(name)").in("id", shipmentIds);
    if (!ships?.length) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    const { data: lines } = await sb
      .from("shipment_lines").select("item_id, description, ship_qtys, items(name), jobs(clients(name))").in("shipment_id", shipmentIds);

    // group by client (no job numbers), collect item ids for the slip lookup
    const byClient = new Map<string, { name: string; qty: number; sizes: string }[]>();
    const itemIds: string[] = [];
    let totalUnits = 0;
    for (const l of lines || []) {
      const client = (l as any).jobs?.clients?.name || "—";
      const t = tot((l as any).ship_qtys); totalUnits += t;
      if (l.item_id) itemIds.push(l.item_id);
      const arr = byClient.get(client) || [];
      arr.push({ name: (l as any).items?.name || l.description || "Item", qty: t, sizes: sizeStr((l as any).ship_qtys) });
      byClient.set(client, arr);
    }

    // uploaded vendor packing slips → Drive links
    const { data: slips } = await sb.from("item_files").select("file_name, drive_link").in("item_id", itemIds).eq("stage", "packing_slip").not("drive_link", "is", null);
    const uniqSlips = Array.from(new Map((slips || []).map((s: any) => [s.drive_link, s])).values());

    const isPickup = (ships as any[]).every(s => s.pickup);
    const vendor = (ships as any[])[0]?.decorators?.name || "a vendor";
    const trackings = Array.from(new Set((ships as any[]).map(s => s.tracking).filter(Boolean)));
    const carriers = Array.from(new Set((ships as any[]).map(s => s.carrier).filter(Boolean)));

    const clientBlocks = Array.from(byClient.entries()).map(([client, items]) => `
      <div style="border:1px solid #eee;border-radius:8px;padding:14px 16px;margin:0 0 12px;">
        <div style="font-weight:700;font-size:15px;margin-bottom:10px;">${esc(client)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${items.map(it => `<tr>
            <td style="padding:5px 0;border-top:1px solid #f2f2f2;">${esc(it.name)}<div style="font-size:11px;color:#999;">${esc(it.sizes)}</div></td>
            <td style="padding:5px 0;border-top:1px solid #f2f2f2;text-align:right;font-weight:700;font-size:16px;white-space:nowrap;">${it.qty}</td>
          </tr>`).join("")}
        </table>
      </div>`).join("");

    const slipBlock = uniqSlips.length ? `
      <div style="margin:16px 0 4px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#888;margin-bottom:8px;">Vendor packing slip${uniqSlips.length > 1 ? "s" : ""}</div>
        ${uniqSlips.map((s: any) => `<a href="${s.drive_link}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 14px;background:#f6f8fb;border:1px solid #dcdce0;border-radius:8px;color:#2563eb;text-decoration:none;font-weight:600;font-size:13px;">📎 ${esc(s.file_name || "Packing slip")}</a>`).join("")}
      </div>` : "";

    const noteBlock = note ? `<div style="margin:8px 0 14px;padding:10px 14px;background:#f6f8fb;border-left:3px solid #2563eb;border-radius:4px;font-size:13px;color:#333;white-space:pre-wrap;">${esc(note)}</div>` : "";

    const html = renderBrandedEmail({
      eyebrow: isPickup ? "Warehouse · Ready for pickup" : "Warehouse · Incoming",
      heading: isPickup ? `Ready for pickup — ${totalUnits} units` : `Incoming — ${totalUnits} units`,
      greeting: isPickup ? `Hey warehouse — this is ready for pickup at ${esc(vendor)}.` : `Hey warehouse — here's what's ready and headed your way.`,
      bodyHtml: noteBlock + clientBlocks + slipBlock,
      extraHtml: `<div style="font-size:12px;color:#666;margin:10px 0 0;">Coming from <strong>${esc(vendor)}</strong></div>` + (isPickup ? "" : trackingBlock(trackings.join(", ") || null, carriers.join(", ") || null)),
      closing: "— House Party Distro",
    });

    const subject = isPickup
      ? `Ready for pickup — ${vendor}`
      : `Incoming — ${[carriers.join(", "), trackings.join(", ")].filter(Boolean).join(" · ") || vendor}`;

    const resend = resendForSlug("hpd");
    const from = process.env.EMAIL_FROM_PO || "production@housepartydistro.com";
    // In test mode NEVER fall back to the real warehouse — send to the caller,
    // and if we can't resolve their email, fail loudly instead of emailing ops.
    const to = test ? user.email : WAREHOUSE_EMAIL;
    if (!to) return NextResponse.json({ error: "Couldn't resolve your email for the test send." }, { status: 400 });
    const r: any = await resend.emails.send({
      from: `House Party Distro <${from}>`, to, subject: test ? `[TEST] ${subject}` : subject, html,
    });
    if (r?.error) return NextResponse.json({ error: r.error.message || "Send failed" }, { status: 500 });
    await sb.from("shipments").update({ warehouse_notified_at: new Date().toISOString(), warehouse_notified_to: to || null } as never).in("id", shipmentIds);
    return NextResponse.json({ success: true, to });
  } catch (e: any) {
    console.error("[production2/notify-warehouse]", e);
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { resolveSlugFromHost } from "@/lib/tenants";

// Internal "ready for pickup at {Vendor}" alert to the warehouse runners.
// Fired from Production → Mark Shipped when an item is flagged pickup_ready.
//
// Batching: ONE email per vendor per pickup cycle. We only send on the 0→1
// transition — i.e. when the just-marked item is the ONLY ready-and-unreceived
// pickup item at that vendor. Additional same-day marks (while the batch is
// still waiting to be grabbed) don't re-send; once the batch is picked up +
// received, the next mark starts a fresh cycle and re-triggers.
const PICKUP_RECIPIENTS = ["goose@housepartydistro.com", "dante@housepartydistro.com"];

export async function POST(req: NextRequest) {
  try {
    const { itemId } = await req.json();
    if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: marked } = await sb.from("items")
      .select("id, name, job_id, pickup_ready, decorator_assignments(decorator_id, decorators(name))")
      .eq("id", itemId).single();
    if (!marked || !(marked as any).pickup_ready) return NextResponse.json({ sent: false, reason: "not a pickup item" });
    const decoratorId = (marked as any).decorator_assignments?.[0]?.decorator_id || null;
    const vendorName = (marked as any).decorator_assignments?.[0]?.decorators?.name || "vendor";

    // Current ready batch at this vendor (pickup_ready + not yet received).
    let batch: any[] = [marked];
    if (decoratorId) {
      const { data: asn } = await sb.from("decorator_assignments").select("item_id").eq("decorator_id", decoratorId);
      const ids = (asn || []).map((a: any) => a.item_id);
      const { data: ready } = await sb.from("items")
        .select("id, name, job_id")
        .in("id", ids.length ? ids : [itemId])
        .eq("pickup_ready", true).eq("received_at_hpd", false);
      if (ready && ready.length) batch = ready;
    }
    // Already announced this cycle → stay quiet.
    if (batch.length > 1) return NextResponse.json({ sent: false, reason: "batch already announced", batch: batch.length });

    const jobIds = [...new Set(batch.map(b => b.job_id))];
    const { data: jobs } = await sb.from("jobs").select("id, job_number, type_meta, clients(name)").in("id", jobIds);
    const jobById: Record<string, any> = Object.fromEntries((jobs || []).map((j: any) => [j.id, j]));
    const lines = batch.map(b => {
      const j = jobById[b.job_id];
      const num = j?.type_meta?.qb_invoice_number || j?.job_number || "";
      return `<li style="margin:3px 0">${b.name}${num ? ` — <strong>${num}</strong>` : ""}${j?.clients?.name ? ` · ${j.clients.name}` : ""}</li>`;
    }).join("");

    const slug = resolveSlugFromHost(req.headers.get("host"));
    const resend = resendForSlug(slug);
    const from = process.env.EMAIL_FROM_PO || "production@housepartydistro.com";
    const html = renderBrandedEmail({
      eyebrow: "Warehouse",
      heading: `Ready for pickup — ${vendorName}`,
      bodyHtml: `There ${batch.length === 1 ? "is" : "are"} <strong>${batch.length}</strong> item${batch.length !== 1 ? "s" : ""} ready to grab at <strong>${vendorName}</strong>:<ul style="margin:10px 0 4px;padding-left:20px">${lines}</ul>More may be staged by the time you arrive — check the Receiving board for the full list.`,
      closing: "House Party Distro",
    });
    const r = await resend.emails.send({ from, to: PICKUP_RECIPIENTS, subject: `Ready for pickup — ${vendorName}`, html });
    if ((r as any)?.error) throw new Error((r as any).error.message || "Resend rejected the send");
    return NextResponse.json({ sent: true, vendor: vendorName, recipients: PICKUP_RECIPIENTS, items: batch.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

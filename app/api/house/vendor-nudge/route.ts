import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The House's act-in-place vendor nudge. Two shapes:
//   POST { jobId, preview? }      — chase a ship-by promise on a production job
//   POST { shipmentId, preview? } — chase a landing that blew past its expected date
// preview:true returns { vendor, recipients, subject, body } WITHOUT sending, so
// the action sheet shows exactly who gets the email before anyone commits.
// Send logs to job_activity so the nudge lands on the wire.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const fmt = (iso: string) => new Date(iso + "T00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });

async function decoratorByName(db: any, name: string) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const { data } = await db.from("decorators")
    .select("id, name, contacts_list")
    .or(`name.ilike.${clean},short_code.ilike.${clean}`)
    .limit(1).maybeSingle();
  return data || null;
}

async function decoratorByItems(db: any, itemIds: string[]) {
  if (!itemIds.length) return null;
  const { data } = await db.from("decorator_assignments")
    .select("decorator_id, decorators(id, name, contacts_list)")
    .in("item_id", itemIds).not("decorator_id", "is", null).limit(1);
  return (data || [])[0]?.decorators || null;
}

function recipients(decorator: any): { name: string; email: string }[] {
  return ((decorator?.contacts_list || []) as any[])
    .filter(c => c?.email)
    .map(c => ({ name: c.name || decorator.name, email: String(c.email).trim() }));
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();
    const body = await req.json().catch(() => ({}));
    let subject = "", text = "", decorator: any = null;
    let logTargets: { jobId: string; line: string }[] = [];

    if (body.jobId) {
      const { data: job } = await db.from("jobs")
        .select("id, job_number, title, target_ship_date, type_meta, clients(name), items(id, name, pipeline_stage, buy_sheet_lines(qty_ordered))")
        .eq("id", body.jobId).single();
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      const tm: any = (job as any).type_meta || {};
      const dated: [string, string][] = ([
        ...Object.entries(tm.po_ship_live || {}).map(([k, v]: any) => [k, v?.date]),
        ...Object.entries(tm.po_ship_dates || {}),
      ] as [string, string][]).filter(([, d]) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")));
      dated.sort((a, b) => a[1].localeCompare(b[1]));
      const promised = dated[0]?.[1] || null;
      const vendorName = dated[0]?.[0]
        || Object.keys(tm.po_ship_dates || {})[0] || Object.keys(tm.po_ship_live || {})[0] || null;

      const inProd = ((job as any).items || []).filter((i: any) => i.pipeline_stage === "in_production");
      decorator = (vendorName ? await decoratorByName(db, vendorName) : null)
        || await decoratorByItems(db, inProd.map((i: any) => i.id));
      if (!decorator) return NextResponse.json({ error: "Couldn't match this job to a vendor on the Vendors page" }, { status: 404 });

      const clientName = (job as any).clients?.name || "";
      const lines = inProd.map((i: any) => {
        const units = (i.buy_sheet_lines || []).reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0);
        return `  - ${i.name}${units ? `, ${units.toLocaleString()} pcs` : ""}`;
      }).join("\n");
      const needBy = promised
        ? `We have ${fmt(promised)} as the ship-by on this order.`
        : (job as any).target_ship_date
          ? `This needs to be moving by ${fmt(new Date(new Date((job as any).target_ship_date + "T00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10))} for us to hit our ship date.`
          : "We are checking on where this stands.";

      subject = `${(job as any).job_number} (${clientName}) ship date check-in`;
      text = `Hey ${decorator.name},

Checking in on ${(job as any).job_number} for ${clientName}:
${lines || "  - (items on this order)"}

${needBy}

Can you confirm it ships on time? If the date has moved, reply with the real date and we will plan around it. Tracking when it ships is appreciated.

Thanks,
House Party Distro
production@housepartydistro.com`;
      logTargets = [{ jobId: (job as any).id, line: `Vendor nudge emailed to ${decorator.name}` }];

    } else if (body.shipmentId) {
      const { data: ship } = await db.from("shipments")
        .select("id, expected_arrival, status, carrier, tracking_number, carrier_status, shipment_lines(item_id, items(id, name, job_id, jobs(id, job_number, clients(name))))")
        .eq("id", body.shipmentId).single();
      if (!ship) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });

      const lines = ((ship as any).shipment_lines || []).map((l: any) => l.items).filter(Boolean);
      decorator = await decoratorByItems(db, lines.map((i: any) => i.id));
      if (!decorator) return NextResponse.json({ error: "Couldn't match this shipment to a vendor on the Vendors page" }, { status: 404 });

      const jobNumbers = Array.from(new Set(lines.map((i: any) => i.jobs?.job_number).filter(Boolean)));
      const state = ((ship as any).carrier_status || (ship as any).status || "").replace(/_/g, " ");
      const trackLine = (ship as any).tracking_number
        ? `Tracking: ${[(ship as any).carrier, (ship as any).tracking_number].filter(Boolean).join(" ")} (showing ${state})`
        : "We do not have tracking on file for this one.";

      subject = `${jobNumbers.join(" / ") || "Shipment"} check-in, expected ${fmt((ship as any).expected_arrival)}`;
      text = `Hey ${decorator.name},

This shipment was expected ${fmt((ship as any).expected_arrival)} and has not landed:
${lines.map((i: any) => `  - ${i.name} (${i.jobs?.job_number || ""})`).join("\n")}

${trackLine}

Can you check on it and let us know where it stands? If it has not shipped yet, reply with the real date.

Thanks,
House Party Distro
production@housepartydistro.com`;
      const jobIds = Array.from(new Set(lines.map((i: any) => i.jobs?.id || i.job_id).filter(Boolean))) as string[];
      logTargets = jobIds.map(jobId => ({ jobId, line: `Vendor nudge emailed to ${decorator.name} (late landing)` }));

    } else {
      return NextResponse.json({ error: "jobId or shipmentId required" }, { status: 400 });
    }

    const to = recipients(decorator);
    if (!to.length) return NextResponse.json({ error: `No email on file for ${decorator.name}. Add a contact on the Vendors page first.` }, { status: 400 });

    if (body.preview) {
      return NextResponse.json({ vendor: decorator.name, recipients: to, subject, body: text });
    }

    const resend = new Resend(process.env.RESEND_API_KEY!);
    const from = process.env.EMAIL_FROM_PO || "production@housepartydistro.com";
    const { error: sendErr } = await resend.emails.send({
      from: `House Party Distro <${from}>`,
      to: to.map(r => r.email),
      subject, text,
    });
    if (sendErr) return NextResponse.json({ error: sendErr.message || "Send failed" }, { status: 500 });

    for (const t of logTargets) {
      await db.from("job_activity").insert({
        job_id: t.jobId, user_id: null, type: "auto",
        message: `${t.line} (${to.map(r => r.email).join(", ")})`, metadata: {},
      });
    }
    return NextResponse.json({ success: true, sentTo: to.map(r => r.email) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

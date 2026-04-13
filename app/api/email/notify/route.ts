export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendClientNotification } from "@/lib/auto-email";

/**
 * Trigger an auto-email notification to client.
 * Used by client-side components that can't call sendClientNotification directly.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, type, trackingNumber, carrier } = await req.json();
    if (!jobId || !type) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    // For shipping notifications, only send if the shipping route matches
    if (type === "order_shipped_dropship") {
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: job } = await sb.from("jobs").select("shipping_route").eq("id", jobId).single();
      if (job?.shipping_route !== "drop_ship") return NextResponse.json({ success: true, skipped: true });
    }

    // Order shipped — send packing slip PDF
    if (type === "order_shipped") {
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const { Resend } = await import("resend");
      const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const resend = new Resend(process.env.RESEND_API_KEY);

      const { data: job } = await sb.from("jobs").select("*, clients(name)").eq("id", jobId).single();
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      // Get client email
      const { data: contacts } = await sb.from("job_contacts").select("contacts(email)").eq("job_id", jobId);
      const clientEmail = contacts?.map((c: any) => c.contacts?.email).filter(Boolean)[0];
      if (!clientEmail) return NextResponse.json({ success: true, skipped: "no email" });

      // Fetch packing slip PDF
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
      const pdfRes = await fetch(`${baseUrl}/api/pdf/packing-slip/${jobId}`, {
        headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! },
      });
      if (!pdfRes.ok) return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

      const portalToken = job.portal_token;
      const portalUrl = portalToken ? `${baseUrl}/portal/${portalToken}` : "";
      const portalButton = portalUrl ? `<p style="margin:16px 0"><a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#f3f3f5;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;border:1px solid #dcdce0">View Order in Portal</a></p>` : "";
      const invoiceNum = (job.type_meta as any)?.qb_invoice_number || job.job_number || "";

      await resend.emails.send({
        from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
        to: clientEmail,
        subject: `Your Order Has Shipped — ${(job.clients as any)?.name || ""} · ${job.title}`,
        html: `<p>Hi,</p><p>Your order has shipped! Your packing slip with tracking information is attached.</p>${portalButton}<p>Welcome to the party,<br/>House Party Distro</p>`,
        attachments: [{ filename: `HPD-PackingSlip-${invoiceNum}.pdf`, content: pdfBuffer.toString("base64") }],
      });

      return NextResponse.json({ success: true });
    }

    // Invoice revised — send updated invoice PDF to client
    if (type === "invoice_revised") {
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const { Resend } = await import("resend");
      const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const resend = new Resend(process.env.RESEND_API_KEY);

      const { data: job } = await sb.from("jobs").select("*, clients(name)").eq("id", jobId).single();
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      const { data: contacts } = await sb.from("job_contacts").select("contacts(email)").eq("job_id", jobId);
      const clientEmail = contacts?.map((c: any) => c.contacts?.email).filter(Boolean)[0];
      if (!clientEmail) return NextResponse.json({ success: true, skipped: "no email" });

      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
      const pdfRes = await fetch(`${baseUrl}/api/pdf/invoice/${jobId}`, {
        headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! },
      });
      if (!pdfRes.ok) return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

      const invoiceNum = (job.type_meta as any)?.qb_invoice_number || job.job_number || "";
      const portalToken = job.portal_token;
      const portalUrl = portalToken ? `${baseUrl}/portal/${portalToken}` : "";
      const portalButton = portalUrl ? `<p style="margin:16px 0"><a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#f3f3f5;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;border:1px solid #dcdce0">View in Portal</a></p>` : "";

      await resend.emails.send({
        from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
        to: clientEmail,
        subject: `Revised Invoice #${invoiceNum} — ${(job.clients as any)?.name || ""} · ${job.title}`,
        html: `<p>Hi,</p><p>Your invoice has been updated with revised pricing. The updated invoice is attached.</p>${portalButton}<p>Welcome to the party,<br/>House Party Distro</p>`,
        attachments: [{ filename: `HPD-Invoice-${invoiceNum}-Revised.pdf`, content: pdfBuffer.toString("base64") }],
      });

      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: `Revised invoice #${invoiceNum} sent to client (${clientEmail})`,
      });

      return NextResponse.json({ success: true });
    }

    await sendClientNotification({ jobId, type, trackingNumber, carrier });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

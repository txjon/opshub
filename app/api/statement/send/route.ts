export const runtime = "nodejs";
export const maxDuration = 60;

// Send an account statement to a client's AP contacts, from the tenant's
// billing address, with the statement PDF attached. Client-scoped (no job),
// which is why this lives apart from /api/email/send's job-centric flow.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renderBrandedEmail } from "@/lib/email-template";
import { resendForSlug } from "@/lib/resend-client";
import { resolveSlugFromHost } from "@/lib/tenants";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientId, recipients, subject, body } = await req.json();
    if (!clientId || !Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: "Missing clientId or recipients" }, { status: 400 });
    }

    const slug = resolveSlugFromHost(req.headers.get("host"));
    const resend = resendForSlug(slug);
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: companyRow } = await admin.from("companies")
      .select("name, from_email_quotes, from_email_billing")
      .eq("slug", slug)
      .single();
    const companyName = (companyRow as any)?.name || "House Party Distro";
    const fromBilling = (companyRow as any)?.from_email_billing || (companyRow as any)?.from_email_quotes || "onboarding@resend.dev";

    const { data: clientRow } = await admin.from("clients").select("name").eq("id", clientId).single();
    const clientName = (clientRow as any)?.name || "client";

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const pdfRes = await fetch(`${baseUrl}/api/pdf/statement/${clientId}?download=1`, {
      headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "", "x-company-slug": slug },
    });
    if (!pdfRes.ok) {
      const text = await pdfRes.text();
      return NextResponse.json({ error: `Statement PDF failed: ${text}` }, { status: 500 });
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const cd = pdfRes.headers.get("content-disposition") || "";
    const filename = /filename\*?="?([^";]+)"?/.exec(cd)?.[1] || `Statement-${clientName.replace(/\s+/g, "-")}.pdf`;

    const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = renderBrandedEmail({
      eyebrow: companyName,
      heading: "Account Statement",
      bodyHtml: esc(String(body || "")).replace(/\n/g, "<br/>"),
      closing: `${companyName} · Billing\n${fromBilling}`,
    });

    const { error } = await resend.emails.send({
      from: `${companyName} <${fromBilling}>`,
      to: recipients,
      replyTo: fromBilling,
      subject: subject || `Account Statement — ${clientName} — ${dateLabel}`,
      html,
      attachments: [{ filename, content: pdfBuffer.toString("base64") }],
    });
    if (error) return NextResponse.json({ error: error.message || "Send failed" }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Statement Send Error]", err);
    return NextResponse.json({ error: err.message || "Send failed" }, { status: 500 });
  }
}

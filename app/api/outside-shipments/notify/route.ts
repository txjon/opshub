export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resendForSlug } from "@/lib/resend-client";
import { resolveSlugFromHost } from "@/lib/tenants";
import { renderBrandedEmail, trackingBlock, tenantClosing } from "@/lib/email-template";

// Lightweight "your forwarded package has shipped" notice for outside packages.
// Outside packages aren't invoiced and aren't tied to a job, so this is decoupled
// from the job/invoice-gated /api/email/notify flow — it just emails the linked
// client's selected contacts the outbound tracking.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { recipients, tracking, description, clientName } = await req.json();
    const to = (recipients || []).filter((e: any) => typeof e === "string" && e.includes("@"));
    if (to.length === 0) return NextResponse.json({ error: "No recipients" }, { status: 400 });
    if (!tracking) return NextResponse.json({ error: "Missing tracking" }, { status: 400 });

    const slug = resolveSlugFromHost(req.headers.get("host"));
    const resend = resendForSlug(slug);
    const from = process.env.EMAIL_FROM_PO || process.env.EMAIL_FROM_QUOTES || "production@housepartydistro.com";

    const what = description ? `<strong>${description}</strong>` : "your package";
    const bodyHtml = `${clientName ? `Hi ${clientName},<br/><br/>` : ""}${what} has shipped on its way to you.
      ${trackingBlock(tracking, null)}`;
    const html = renderBrandedEmail({
      eyebrow: "House Party Distro",
      heading: "Your shipment is on the way",
      bodyHtml,
      closing: tenantClosing(slug, "House Party Distro"),
    });

    await resend.emails.send({ from, to, subject: `Your shipment has shipped — ${tracking}`, html });
    return NextResponse.json({ success: true, sentTo: to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to send" }, { status: 500 });
  }
}

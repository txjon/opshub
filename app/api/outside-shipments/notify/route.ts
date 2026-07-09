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
    const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!internal) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { recipients, tracking, description, clientName } = body;
    const slug = resolveSlugFromHost(req.headers.get("host"));
    const resend = resendForSlug(slug);
    const from = process.env.EMAIL_FROM_PO || process.env.EMAIL_FROM_QUOTES || "production@housepartydistro.com";

    // ── Warehouse heads-up: fired when an outside package is LOGGED, so the
    //    warehouse knows a package is inbound. Goes to warehouse@ (not a client),
    //    no tracking required. ────────────────────────────────────────────────
    if (body.mode === "warehouse_incoming") {
      const { carrier, sender, route, lineItems } = body;
      const to = body.testRecipient ? [body.testRecipient] : ["warehouse@housepartydistro.com"];
      const meta = (label: string, val: string | null) =>
        val ? `<p style="margin:0 0 6px;font-size:13px;color:#444;"><strong>${label}:</strong> ${String(val).replace(/</g, "&lt;")}</p>` : "";
      const itemsHtml = Array.isArray(lineItems) && lineItems.length
        ? `<ul style="margin:8px 0 0;padding-left:20px;">${lineItems.map((it: any) => {
            const sizeStr = Object.entries(it.sizes || {}).filter(([, n]) => (Number(n) || 0) > 0).map(([s, n]) => `${s}-${n}`).join(", ");
            return `<li style="margin:4px 0;font-size:13px;color:#444;">${String(it.name || "Item").replace(/</g, "&lt;")}${sizeStr ? ` — <span style="font-family:monospace;color:#666;">${sizeStr}</span>` : ""}</li>`;
          }).join("")}</ul>`
        : "";
      const bodyHtml = `A package has been logged as inbound to the warehouse.
        ${meta("From", sender)}${meta("For client", clientName)}${meta("Carrier", carrier)}${meta("Tracking", tracking)}
        ${meta("After receiving", route === "stage" ? "Stage / fulfillment" : "Forward to client")}
        ${description ? `<p style="margin:8px 0 0;font-size:13px;color:#444;"><strong>Details:</strong> ${String(description).replace(/</g, "&lt;")}</p>` : ""}
        ${itemsHtml}`;
      const html = renderBrandedEmail({
        eyebrow: "House Party Distro",
        heading: "Incoming package logged",
        greeting: "Heads up — a package is inbound.",
        bodyHtml,
        closing: "— House Party Distro",
      });
      const subj = `${body.testRecipient ? "[TEST] " : ""}Incoming package — ${sender || description || tracking || "outside shipment"}`;
      await resend.emails.send({ from, to, subject: subj, html });
      return NextResponse.json({ success: true, sentTo: to });
    }

    const to = (recipients || []).filter((e: any) => typeof e === "string" && e.includes("@"));
    if (to.length === 0) return NextResponse.json({ error: "No recipients" }, { status: 400 });
    if (!tracking) return NextResponse.json({ error: "Missing tracking" }, { status: 400 });

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

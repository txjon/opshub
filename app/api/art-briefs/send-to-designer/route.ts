import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renderBrandedEmail } from "@/lib/email-template";
import { appBaseUrl } from "@/lib/public-url";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id, designer_id } = await req.json();
    if (!brief_id || !designer_id) return NextResponse.json({ error: "brief_id and designer_id required" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: designer } = await admin.from("designers").select("id, name, email, portal_token, active").eq("id", designer_id).single();
    if (!designer || !designer.active) return NextResponse.json({ error: "Designer not found or inactive" }, { status: 404 });

    const { data: brief } = await admin.from("art_briefs").select("id, title, clients(name)").eq("id", brief_id).single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    const now = new Date().toISOString();
    await admin.from("art_briefs").update({
      assigned_designer_id: designer_id,
      assigned_to: designer.name,
      state: "sent",
      sent_to_designer_at: now,
      updated_at: now,
    }).eq("id", brief_id);

    // Email designer if they have an address + Resend is configured
    const portalUrl = `${await appBaseUrl()}/design/${designer.portal_token}`;
    let emailed = false;

    if (designer.email && process.env.RESEND_API_KEY) {
      try {
        const subject = `New art brief: ${brief.title || "Untitled"}`;
        const clientName = (brief as any).clients?.name || "a client";
        const html = renderBrandedEmail({
          heading: `New brief for ${clientName}`,
          bodyHtml: `<strong>${brief.title || "Untitled Brief"}</strong> is ready for you to work on.`,
          cta: { label: "Open your dashboard →", url: portalUrl, style: "dark" },
          hint: "This link is permanent — bookmark it and come back anytime.",
          closing: "",
        });
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
            to: designer.email,
            subject,
            html,
          }),
        });
        emailed = resendRes.ok;
      } catch {}
    }

    return NextResponse.json({ success: true, emailed, portalUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

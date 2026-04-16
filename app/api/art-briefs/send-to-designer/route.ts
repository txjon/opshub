import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://app.housepartydistro.com";
    const portalUrl = `${siteUrl}/design/${designer.portal_token}`;
    let emailed = false;

    if (designer.email && process.env.RESEND_API_KEY) {
      try {
        const subject = `New art brief: ${brief.title || "Untitled"}`;
        const clientName = (brief as any).clients?.name || "a client";
        const html = `
          <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
            <div style="font-size: 11px; color: #888; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px;">House Party Distro</div>
            <h1 style="font-size: 22px; margin: 0 0 16px;">New brief for ${clientName}</h1>
            <p style="font-size: 14px; color: #444; line-height: 1.5;">
              <strong>${brief.title || "Untitled Brief"}</strong> is ready for you to work on.
            </p>
            <a href="${portalUrl}" style="display: inline-block; margin-top: 14px; padding: 12px 24px; background: #222; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
              Open your dashboard →
            </a>
            <p style="font-size: 12px; color: #888; margin-top: 20px;">This link is permanent — bookmark it and come back anytime.</p>
          </div>
        `;
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

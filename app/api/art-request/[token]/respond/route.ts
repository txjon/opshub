export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { appBaseUrlForSlug } from "@/lib/public-url";

// The designer submits a structured quote (price + screen count + note) from
// the public gallery. Token IS the auth. Stores it on the request, flips
// status -> 'quoted', logs to the job feed, and emails the sender so it's
// captured in-app (no freeform email reply). Price is applied to the quote
// manually as an Additional charge.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await req.json().catch(() => ({}));
    const note = (body.note || "").toString().trim() || null;

    // Per-item quotes: [{ item_id, item_name, amount, screens }]. Validate + clean.
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const quotedItems: Array<{ item_id: string; item_name: string; amount: number; screens: number | null }> = [];
    for (const r of rawItems) {
      const amt = Number(r?.amount);
      if (!r?.item_id || isNaN(amt) || amt < 0) {
        return NextResponse.json({ error: "Every item needs a valid price." }, { status: 400 });
      }
      const scr = r.screens == null || r.screens === "" ? null : parseInt(r.screens, 10);
      quotedItems.push({ item_id: r.item_id, item_name: (r.item_name || "").toString(), amount: amt, screens: scr != null && !isNaN(scr) ? scr : null });
    }
    if (quotedItems.length === 0) {
      return NextResponse.json({ error: "Enter at least one item price." }, { status: 400 });
    }
    const total = quotedItems.reduce((a, r) => a + r.amount, 0);

    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: reqRow } = await admin
      .from("art_requests")
      .select("id, job_id, designer_email, designer_name")
      .eq("token", token)
      .single();
    if (!reqRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error: upErr } = await admin
      .from("art_requests")
      .update({
        quoted_items: quotedItems,
        quoted_amount: total, // summed total, for the subject line + summary
        quoted_note: note,
        responded_at: new Date().toISOString(),
        status: "quoted",
      })
      .eq("id", (reqRow as any).id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Job + tenant for branding / notify.
    const { data: job } = await admin
      .from("jobs")
      .select("id, title, job_number, companies:company_id(slug, name)")
      .eq("id", (reqRow as any).job_id)
      .single();
    const slug = (job as any)?.companies?.slug || "hpd";
    const jobLabel = (job as any)?.title || (job as any)?.job_number || "a project";
    const who = (reqRow as any).designer_name || (reqRow as any).designer_email;
    const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const totalMoney = fmt(total);
    const multi = quotedItems.length > 1;

    // Log to the job feed so it shows in activity.
    await admin.from("job_activity").insert({
      job_id: (reqRow as any).job_id,
      user_id: null,
      type: "auto",
      message: `Art quote received from ${who}: ${totalMoney}${multi ? ` across ${quotedItems.length} items` : (quotedItems[0].screens != null ? ` · ${quotedItems[0].screens} screens` : "")}`,
      metadata: { art_request_id: (reqRow as any).id, items: quotedItems, total, note },
    });

    // Notify the sender by email — per-item breakdown.
    try {
      const resend = resendForSlug(slug);
      const from = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
      const jobUrl = `${appBaseUrlForSlug(slug)}/jobs/${(reqRow as any).job_id}`;
      const rowsHtml = quotedItems.map(r =>
        `<tr>` +
        `<td style="padding:6px 12px 6px 0;font-size:14px;color:#1a1a1a;">${escapeHtml(r.item_name || "Item")}</td>` +
        `<td style="padding:6px 12px;font-size:14px;color:#555;white-space:nowrap;">${r.screens != null ? `${r.screens} screen${r.screens === 1 ? "" : "s"}` : "—"}</td>` +
        `<td style="padding:6px 0 6px 12px;font-size:14px;color:#1a1a1a;font-weight:700;text-align:right;white-space:nowrap;">${fmt(r.amount)}</td>` +
        `</tr>`
      ).join("");
      const html = renderBrandedEmail({
        eyebrow: (job as any)?.companies?.name || "House Party Distro",
        heading: "Art quote received",
        bodyHtml:
          `<p style="margin:0 0 14px;"><strong>${escapeHtml(who)}</strong> quoted the artwork for <strong>${escapeHtml(String(jobLabel))}</strong>.</p>` +
          `<table style="border-collapse:collapse;margin:0 0 8px;">${rowsHtml}` +
          `<tr><td colspan="2" style="padding:10px 12px 0 0;font-size:14px;color:#555;border-top:1px solid #e0e0e4;">Total</td>` +
          `<td style="padding:10px 0 0 12px;font-size:15px;font-weight:800;text-align:right;border-top:1px solid #e0e0e4;">${totalMoney}</td></tr></table>` +
          (note ? `<p style="margin:12px 0 0;white-space:pre-wrap;color:#555;">"${escapeHtml(note)}"</p>` : ""),
        cta: { label: "Open the project", url: jobUrl, style: "dark" },
        hint: "Add each item's price to the quote as an Additional charge when you're ready.",
      });
      await resend.emails.send({
        from,
        to: "jon@housepartydistro.com",
        subject: `Art quote — ${totalMoney} · ${jobLabel}`,
        html,
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

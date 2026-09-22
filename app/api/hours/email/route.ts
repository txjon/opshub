export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { entryHours, fmtHours, fmtTime, weekSnapshot } from "@/lib/hours";

function fmtDateShort(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" , timeZone: "America/Los_Angeles" }); }
function fmtMD(s: string) { const [, m, d] = s.split("-").map(Number); return `${m}/${d}`; }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Always to Jon, regardless of who submits.
    const to = "jon@housepartydistro.com";

    const { weekStart, weekEnd } = await req.json();
    if (!weekStart || !weekEnd) return NextResponse.json({ error: "Missing week range" }, { status: 400 });

    const { data: contractors } = await supabase.from("contractors").select("id, name, active").order("sort_order").order("name");
    const { data: entries } = await supabase.from("contractor_time_entries").select("*")
      .gte("work_date", weekStart).lte("work_date", weekEnd).order("work_date");

    const byContractor = (cid: string) => (entries || []).filter((e: any) => e.contractor_id === cid).sort((a: any, b: any) => a.work_date.localeCompare(b.work_date));
    const grandTotal = (entries || []).reduce((a: number, e: any) => a + entryHours(e), 0);

    // Build the breakdown — one block per contractor that logged time.
    const td = "padding:5px 10px;font-size:13px;color:#333;border-bottom:1px solid #eee;";
    const blocks = (contractors || [])
      .filter((c: any) => c.active && byContractor(c.id).length > 0)
      .map((c: any) => {
        const es = byContractor(c.id);
        const total = es.reduce((a: number, e: any) => a + entryHours(e), 0);
        const rows = es.map((e: any) => `<tr>
          <td style="${td}">${fmtDateShort(e.work_date)}</td>
          <td style="${td}font-family:monospace;">${fmtTime(e.time_in)} – ${fmtTime(e.time_out)}</td>
          <td style="${td}color:#888;">${e.break_minutes ? e.break_minutes + "m break" : ""}</td>
          <td style="${td}text-align:right;font-family:monospace;font-weight:700;">${fmtHours(entryHours(e))}</td>
        </tr>`).join("");
        return `<div style="margin:0 0 18px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:4px;margin-bottom:4px;">
            <strong style="font-size:15px;">${c.name}</strong>
            <strong style="font-size:15px;font-family:monospace;">${fmtHours(total)} hrs</strong>
          </div>
          <table style="width:100%;border-collapse:collapse;">${rows}</table>
        </div>`;
      }).join("");

    const bodyHtml = `Contractor hours for <strong>${fmtMD(weekStart)} – ${fmtMD(weekEnd)}</strong>.
      <div style="margin-top:16px;">${blocks || '<div style="color:#888;">No hours logged this week.</div>'}</div>
      <div style="margin-top:8px;padding-top:10px;border-top:2px solid #1a1a1a;display:flex;justify-content:space-between;align-items:baseline;">
        <strong style="font-size:14px;text-transform:uppercase;letter-spacing:0.06em;">Total</strong>
        <strong style="font-size:18px;font-family:monospace;">${fmtHours(grandTotal)} hrs</strong>
      </div>`;

    const html = renderBrandedEmail({
      eyebrow: "House Party Distro",
      heading: "Contractor hours",
      bodyHtml,
      closing: "—\nHouse Party Distro",
    });

    // Record the submission first — it's what tells /hours the week was sent.
    // If the email then fails, drop the record so the week doesn't read as submitted.
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
    const { data: sub, error: subErr } = await supabase.from("hours_submissions").insert({
      week_start: weekStart, week_end: weekEnd,
      total_hours: Math.round(grandTotal * 100) / 100,
      snapshot: weekSnapshot(entries || []),
      submitted_by: user.id, submitted_by_name: prof?.full_name || user.email || null,
    }).select("id").single();
    if (subErr || !sub) return NextResponse.json({ error: "Couldn't record submission: " + (subErr?.message || "unknown") }, { status: 500 });

    const resend = resendForSlug("hpd");
    const from = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
    const sent = await resend.emails.send({ from, to, subject: `Contractor hours · ${fmtMD(weekStart)}–${fmtMD(weekEnd)}`, html });
    if (sent.error) {
      await supabase.from("hours_submissions").delete().eq("id", sub.id);
      return NextResponse.json({ error: sent.error.message || "Email failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, sentTo: to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to send" }, { status: 500 });
  }
}

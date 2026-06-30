export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getAccountRefByName, createBill } from "@/lib/quickbooks";

// Push a contractor's logged hours for a period to QuickBooks as a vendor Bill.
// Hours are entered rate-blind in /hours; rate is applied here (billing-gated).
// One bill per contractor (QB Bills are per-vendor). Posts to the contractor-labor
// account. Records a pay_run and stamps the punches so the same hours can't be
// pushed twice.
const CONTRACTOR_LABOR_ACCOUNT = "3rd party fulfillment";

// Decimal hours for one punch: (out − in) − break. Open shifts (no out) skip.
function entryHours(e: { time_in: string | null; time_out: string | null; break_minutes: number | null }): number {
  if (!e.time_in || !e.time_out) return 0;
  const [ih, im] = e.time_in.split(":").map(Number);
  const [oh, om] = e.time_out.split(":").map(Number);
  let mins = (oh * 60 + om) - (ih * 60 + im);
  if (mins < 0) mins += 24 * 60; // crossed midnight
  mins -= Number(e.break_minutes || 0);
  return Math.max(0, mins) / 60;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Authorize: must be able to manage AP (owner/manager/god/billing) — mirrors can_manage_ap().
    const { data: prof } = await admin.from("profiles").select("is_god, page_access").eq("id", user.id).single();
    let role: any = null;
    try { role = (await supabase.rpc("get_user_role")).data; } catch { /* rpc unavailable → fall back to is_god/page_access */ }
    const ok = prof?.is_god || ["owner", "manager"].includes(role) || ((prof?.page_access as any[]) || []).includes("/billing");
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { contractorId, periodStart, periodEnd, rate } = await req.json();
    if (!contractorId || !periodStart || !periodEnd) return NextResponse.json({ error: "Missing contractorId/period" }, { status: 400 });
    const rateNum = Number(rate);
    if (!(rateNum > 0)) return NextResponse.json({ error: "A rate > 0 is required" }, { status: 400 });

    const { data: contractor } = await admin.from("contractors").select("id, name").eq("id", contractorId).single();
    if (!contractor) return NextResponse.json({ error: "Contractor not found" }, { status: 404 });

    // Un-pushed punches in the period
    const { data: entries } = await admin.from("contractor_time_entries")
      .select("id, time_in, time_out, break_minutes, pay_run_id")
      .eq("contractor_id", contractorId).gte("work_date", periodStart).lte("work_date", periodEnd).is("pay_run_id", null);
    const billable = (entries || []).filter(e => e.time_in && e.time_out);
    const hours = Math.round(billable.reduce((s, e) => s + entryHours(e), 0) * 100) / 100;
    if (hours <= 0) return NextResponse.json({ error: "No un-pushed, completed hours in this period" }, { status: 400 });
    const amount = Math.round(hours * rateNum * 100) / 100;

    // QB vendor must be explicitly mapped (no auto-create — that's what made the
    // "Patrick Sandate" vs "Patrick Samuel Sandate" duplicate).
    const { data: pay } = await admin.from("contractor_pay").select("qb_vendor_id").eq("contractor_id", contractorId).single();
    const qbVendorId = pay?.qb_vendor_id as string | null;
    if (!qbVendorId) return NextResponse.json({ error: `Map ${contractor.name} to a QuickBooks vendor first (prevents duplicate vendors).` }, { status: 400 });

    const acct = await getAccountRefByName(CONTRACTOR_LABOR_ACCOUNT);

    const bill = await createBill({
      vendorId: qbVendorId!,
      accountId: acct.id,
      txnDate: periodEnd,
      privateNote: `OpsHub contractor hours — ${contractor.name} · ${periodStart} to ${periodEnd}`,
      lines: [{ amount, description: `Labor ${periodStart} to ${periodEnd} — ${hours} hrs @ $${rateNum}/hr` }],
    });

    // Record the pay-run (rate used is captured here for history) + stamp punches
    const { data: run, error: runErr } = await admin.from("contractor_pay_runs").insert({
      contractor_id: contractorId, period_start: periodStart, period_end: periodEnd,
      hours, rate: rateNum, amount, qb_bill_id: bill.billId, qb_doc_number: bill.docNumber, pushed_by: user.id,
    }).select("id").single();
    if (runErr) return NextResponse.json({ error: "QB bill created but pay-run record failed: " + runErr.message, billId: bill.billId }, { status: 500 });
    await admin.from("contractor_time_entries").update({ pay_run_id: run.id }).in("id", billable.map(e => e.id));

    return NextResponse.json({ ok: true, billId: bill.billId, docNumber: bill.docNumber, account: acct.name, hours, amount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Push failed" }, { status: 500 });
  }
}

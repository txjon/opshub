export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { canAccessKey } from "@/lib/access";
import { voidInvoice } from "@/lib/quickbooks";

// Void & delete a fulfillment invoice (Nov 2 2026). Delete alone removed the
// OpsHub record but left the QB invoice live and collectable (#4581/#4582 had
// to be voided by hand). Voids (never deletes) in QB so the doc number stays
// in the audit trail at $0, THEN removes the OpsHub record. Refuses if any
// payment exists: OpsHub's paid stamp, a payment record on the QB invoice,
// or live in QB (voidInvoice's balance check).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role, is_god, page_access").eq("id", user.id).maybeSingle();
    if (!profile || !canAccessKey("/invoices", { role: (profile as any).role, isGod: (profile as any).is_god === true, pageAccess: (profile as any).page_access })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { reportId } = await req.json();
    if (!reportId) return NextResponse.json({ error: "Missing reportId" }, { status: 400 });

    // Read through the user's client: tenant scoping is the same as the page's.
    const { data: report, error: rErr } = await supabase.from("shipstation_reports")
      .select("id, qb_invoice_id, qb_invoice_number, paid_at, paid_amount").eq("id", reportId).maybeSingle();
    if (rErr) return NextResponse.json({ error: `Read failed: ${rErr.message}` }, { status: 500 });
    if (!report) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    const r = report as any;
    if (!r.qb_invoice_id) {
      return NextResponse.json({ error: r.qb_invoice_number
        ? `Invoice #${r.qb_invoice_number} was linked by number only (no API link). Void it in QuickBooks, then delete it here.`
        : "This invoice isn't in QuickBooks. Use Delete instead." }, { status: 409 });
    }
    if (r.paid_at || (Number(r.paid_amount) || 0) > 0) {
      return NextResponse.json({ error: "A payment is recorded on this invoice, so it can't be voided. Handle the payment first." }, { status: 409 });
    }

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: pays, error: pErr } = await admin.from("payment_records").select("amount, status").eq("qb_invoice_id", r.qb_invoice_id);
    if (pErr) return NextResponse.json({ error: `Read failed: ${pErr.message}` }, { status: 500 });
    if ((pays || []).some((p: any) => (p.status === "paid" || p.status === "partial") && (Number(p.amount) || 0) > 0)) {
      return NextResponse.json({ error: "A payment is recorded on this invoice, so it can't be voided. Handle the payment first." }, { status: 409 });
    }

    let v: { alreadyVoid: boolean };
    try {
      v = await voidInvoice(r.qb_invoice_id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Failed to void the QuickBooks invoice" }, { status: 409 });
    }

    // QB is voided; a failed delete leaves a $0-in-QB record here, which the
    // user can retry (a second void reads alreadyVoid and passes).
    const { error: dErr } = await admin.from("shipstation_reports").delete().eq("id", r.id);
    if (dErr) return NextResponse.json({ error: `Voided #${r.qb_invoice_number} in QuickBooks, but removing it here failed: ${dErr.message}. Try again.` }, { status: 500 });

    return NextResponse.json({ success: true, alreadyVoid: v.alreadyVoid, invoiceNumber: r.qb_invoice_number });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

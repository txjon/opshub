export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { refreshPaymentLink } from "@/lib/quickbooks";

// Re-mint the QB payment link for an existing invoice without touching
// invoice content. Used by the Payment tab "pay link" chip to create,
// refresh, or retry the link independently of the invoice push flow.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: job } = await admin.from("jobs").select("id, type_meta").eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const invoiceId = (job.type_meta as any)?.qb_invoice_id;
    if (!invoiceId) {
      return NextResponse.json({ error: "No QB invoice on this job — create the invoice first" }, { status: 400 });
    }

    // Prefer billing contact, fall back to primary, then any contact.
    const { data: contacts } = await admin.from("job_contacts")
      .select("role_on_job, contacts(email)")
      .eq("job_id", jobId);
    const byRole = (r: string) => (contacts as any[] | null)?.find(c => c.role_on_job === r)?.contacts?.email;
    const anyEmail = (contacts as any[] | null)?.map(c => c.contacts?.email).find(Boolean);
    const customerEmail = byRole("billing") || byRole("primary") || anyEmail;

    const link = await refreshPaymentLink(String(invoiceId), customerEmail);

    if (!link) {
      return NextResponse.json({
        error: "QuickBooks did not return a payment link. Check Vercel logs for QB's response — invoice may need a BillEmail or customer email on file.",
      }, { status: 502 });
    }

    await admin.from("jobs").update({
      type_meta: { ...((job.type_meta as any) || {}), qb_payment_link: link },
    }).eq("id", jobId);

    return NextResponse.json({ success: true, paymentLink: link });
  } catch (e: any) {
    console.error("[qb/refresh-link]", e);
    return NextResponse.json({ error: e.message || "Failed to refresh payment link" }, { status: 500 });
  }
}

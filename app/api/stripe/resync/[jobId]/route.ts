import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin POST /api/stripe/resync/[jobId]
// Pulls truth from Stripe (latest non-void invoice for the job's
// customer) and writes it into OpsHub's type_meta. Used after a
// stale-read race or other state drift puts the OpsHub UI out of
// sync with Stripe Dashboard.
//
// Auth: any logged-in user with role manager/owner. We don't try to
// be clever — this endpoint is for fixing a UI state, the underlying
// data already exists in Stripe.

export async function POST(_req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const auth = await createAuthClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
    if (!["manager", "owner"].includes((profile as any)?.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: job } = await sb
      .from("jobs")
      .select("id, job_number, type_meta, companies:company_id(slug)")
      .eq("id", params.jobId)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const tm = ((job as any).type_meta || {}) as any;
    const slug = ((job as any).companies?.slug || "hpd") as string;
    const customerId = tm.stripe_customer_id;
    if (!customerId) {
      return NextResponse.json({ error: "Job has no stripe_customer_id — push an invoice first" }, { status: 400 });
    }

    const stripe = getStripeClient(slug);
    const list = await stripe.invoices.list({ customer: customerId, limit: 20 });
    const invoices = (list.data || []).slice().sort((a, b) => (b.created || 0) - (a.created || 0));

    const summary = invoices.slice(0, 8).map(i => ({
      number: i.number || null,
      status: i.status,
      amount_due_cents: i.amount_due,
      id: i.id,
      is_current: i.id === tm.stripe_invoice_id,
    }));

    const pick = invoices.find(i => i.status === "open")
      || invoices.find(i => i.status === "paid")
      || invoices.find(i => i.status === "draft");
    if (!pick) {
      return NextResponse.json({
        error: "No non-void invoice found for this customer.",
        recent: summary,
      }, { status: 400 });
    }

    const newMeta = {
      ...tm,
      stripe_invoice_id: pick.id,
      stripe_invoice_number: pick.number || tm.stripe_invoice_number,
      stripe_invoice_status: pick.status,
      stripe_total_cents: pick.total,
      stripe_payment_link: pick.hosted_invoice_url || tm.stripe_payment_link,
    };
    const { error: updErr } = await sb.from("jobs").update({ type_meta: newMeta }).eq("id", (job as any).id);
    if (updErr) throw updErr;

    return NextResponse.json({
      ok: true,
      resynced_to: {
        number: pick.number,
        status: pick.status,
        id: pick.id,
        amount_due_cents: pick.amount_due,
      },
      recent: summary,
    });
  } catch (e: any) {
    console.error("[stripe/resync]", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

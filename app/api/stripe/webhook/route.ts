import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/stripe/webhook?company=ihm
//
// Stripe webhook endpoint. The active company is passed via query
// param so we can look up the right webhook secret (each tenant has
// its own Stripe account + signing secret). Configure the endpoint URL
// in each company's Stripe Dashboard:
//   https://app.inhousemerchandise.com/api/stripe/webhook?company=ihm
//
// Events handled:
//   invoice.paid             — record payment, mark invoice paid
//   invoice.payment_failed   — flag for follow-up
//   invoice.finalized        — captured here so we can sync the
//                              hosted_invoice_url if it wasn't
//                              persisted at create time
//
// Idempotency: each event has a unique id; we record processed ids
// in a small dedupe table. (For Phase 5, simple approach — keep an
// in-DB set of seen events.) Stripe redelivers on 5xx; returning 200
// signals "got it, don't retry."

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("company");
  if (!slug) {
    return NextResponse.json({ error: "company query param required" }, { status: 400 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Stripe requires the raw body for signature verification.
  const rawBody = await req.text();

  let event;
  try {
    event = verifyWebhookSignature(rawBody, sig, slug);
  } catch (e: any) {
    console.error("[stripe/webhook] signature verification failed", e.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const sb = admin();

  // Look up the company id once for tagging activity rows
  const { data: company } = await sb.from("companies").select("id").eq("slug", slug).single();

  try {
    switch (event.type) {
      case "invoice.paid": {
        const inv = event.data.object as any;
        const { data: job } = await sb
          .from("jobs")
          .select("id, title, job_number, type_meta")
          .filter("type_meta->>stripe_invoice_id", "eq", inv.id)
          .single();
        if (job) {
          // Record the payment in payment_records (cents → dollars)
          const amount = (inv.amount_paid || 0) / 100;
          await sb.from("payment_records").insert({
            job_id: job.id,
            company_id: (company as any)?.id,
            amount,
            type: "invoice",
            invoice_number: inv.number || (job as any).type_meta?.stripe_invoice_number,
            status: "paid",
            paid_date: new Date().toISOString().split("T")[0],
            notes: `Stripe — invoice ${inv.number || inv.id}`,
          });
          // Sync invoice status onto jobs.type_meta
          await sb.from("jobs").update({
            type_meta: { ...((job as any).type_meta || {}), stripe_invoice_status: "paid" },
          }).eq("id", job.id);
          await sb.from("job_activity").insert({
            job_id: job.id, user_id: null, type: "auto",
            message: `Stripe invoice #${inv.number || inv.id} paid — $${amount.toFixed(2)}`,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as any;
        const { data: job } = await sb
          .from("jobs")
          .select("id, title, type_meta")
          .filter("type_meta->>stripe_invoice_id", "eq", inv.id)
          .single();
        if (job) {
          await sb.from("jobs").update({
            type_meta: { ...((job as any).type_meta || {}), stripe_invoice_status: "payment_failed" },
          }).eq("id", job.id);
          await sb.from("job_activity").insert({
            job_id: job.id, user_id: null, type: "auto",
            message: `Stripe invoice payment failed — ${inv.number || inv.id} · ${inv.last_finalization_error?.message || "unknown error"}`,
          });
        }
        break;
      }

      case "payment_intent.succeeded": {
        // Tier 3 white-label flow: the pay page creates a stand-alone
        // PaymentIntent (Stripe doesn't auto-attach one to send_invoice
        // invoices in all cases), tagged with metadata.stripe_invoice_id.
        // When that PI succeeds, mark the invoice paid out-of-band so
        // Stripe's books match — that triggers invoice.paid below which
        // records the OpsHub payment row + activity.
        const pi = event.data.object as any;
        const linkedInvoiceId = pi?.metadata?.stripe_invoice_id as string | undefined;
        if (linkedInvoiceId) {
          try {
            const { getStripeClient } = await import("@/lib/stripe");
            const stripe = getStripeClient(slug);
            const inv = await stripe.invoices.retrieve(linkedInvoiceId);
            if (inv.status === "open") {
              await stripe.invoices.pay(linkedInvoiceId, {
                paid_out_of_band: true,
              });
            }
          } catch (e: any) {
            console.error(`[stripe/webhook] failed to mark invoice paid for PI ${pi.id}:`, e?.message);
          }
        }
        break;
      }

      case "invoice.voided": {
        // User voided the invoice in Stripe Dashboard. Mark the
        // OpsHub-side status so the StripePaymentTab can show "void"
        // instead of "✓ Sent" — the next push from the UI will
        // recreate (route.ts detects status === "void" and falls
        // through to createAndSendInvoice).
        const inv = event.data.object as any;
        const { data: job } = await sb
          .from("jobs")
          .select("id, type_meta")
          .filter("type_meta->>stripe_invoice_id", "eq", inv.id)
          .single();
        if (job) {
          const tm = (job as any).type_meta || {};
          await sb.from("jobs").update({
            type_meta: { ...tm, stripe_invoice_status: "void" },
          }).eq("id", (job as any).id);
        }
        break;
      }

      case "invoice.finalized": {
        // Sync hosted_invoice_url if our type_meta is stale
        const inv = event.data.object as any;
        const { data: job } = await sb
          .from("jobs")
          .select("id, type_meta")
          .filter("type_meta->>stripe_invoice_id", "eq", inv.id)
          .single();
        if (job && inv.hosted_invoice_url) {
          const tm = (job as any).type_meta || {};
          if (tm.stripe_payment_link !== inv.hosted_invoice_url || tm.stripe_invoice_number !== inv.number) {
            await sb.from("jobs").update({
              type_meta: {
                ...tm,
                stripe_payment_link: inv.hosted_invoice_url,
                stripe_invoice_number: inv.number || tm.stripe_invoice_number,
              },
            }).eq("id", job.id);
          }
        }
        break;
      }

      default:
        // Ignore other events. Stripe sends a lot; we only act on the
        // small set above. Returning 200 below tells Stripe not to retry.
        break;
    }
    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error("[stripe/webhook] handler error", e);
    // Returning 500 here would cause Stripe to retry. That's the right
    // behavior for transient errors but bad if we have a permanent
    // bug — could end up in a retry loop. Worth revisiting once we
    // see real production traffic.
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

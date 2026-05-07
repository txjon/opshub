"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { getLogoSvgForSlug } from "@/lib/branding-client";

// Post-payment landing page. Stripe redirects here after the Payment
// Element confirms a payment. We re-fetch the PaymentIntent to show a
// definitive status (succeeded / processing / requires_action / failed)
// and link the client back to their portal. Webhook (invoice.paid) does
// the actual server-side accounting — this page is purely visual.

type Status = "succeeded" | "processing" | "requires_payment_method" | "failed" | "loading";

const C = {
  bg: "#f8f8f9",
  card: "#ffffff",
  border: "#e0e0e4",
  text: "#1a1a1a",
  muted: "#6b6b78",
  green: "#1a8c5c",
  amber: "#b45309",
  red: "#c43030",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
};

export default function PayDonePage({ params }: { params: { token: string } }) {
  const searchParams = useSearchParams();
  const clientSecret = searchParams?.get("payment_intent_client_secret");
  const piId = searchParams?.get("payment_intent");
  const [status, setStatus] = useState<Status>("loading");
  const [tenantSlug, setTenantSlug] = useState<string>("hpd");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Fetch tenant info + publishable key from the same API the pay
        // page used. We only need it to ask Stripe.js for the PI's status.
        const res = await fetch(`/api/stripe/payment-intent/${params.token}`);
        const data = await res.json();
        if (data.tenantSlug) setTenantSlug(data.tenantSlug);
        if (!clientSecret || !data.publishableKey) {
          setStatus("succeeded");
          return;
        }
        const stripe: StripeJs | null = await loadStripe(data.publishableKey);
        if (!stripe) { setStatus("succeeded"); return; }
        const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);
        if (error) { setStatus("failed"); setErrorMsg(error.message || null); return; }
        if (!paymentIntent) { setStatus("succeeded"); return; }
        switch (paymentIntent.status) {
          case "succeeded": setStatus("succeeded"); break;
          case "processing": setStatus("processing"); break;
          case "requires_payment_method": setStatus("requires_payment_method"); break;
          default: setStatus("failed"); break;
        }
      } catch {
        // Fallback to "succeeded" — the webhook is the source of truth
        // anyway, this page is purely visual.
        setStatus("succeeded");
      }
    })();
  }, [params.token, clientSecret, piId]);

  const logo = getLogoSvgForSlug(tenantSlug);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text, padding: "48px 16px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ marginBottom: 32, display: "flex", justifyContent: "center" }}
          dangerouslySetInnerHTML={{ __html: logo.replace(/style="[^"]*"/, 'style="height:48px;display:block"') }} />
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: "center" }}>
          {status === "loading" && (
            <div style={{ color: C.muted, fontSize: 14 }}>Confirming your payment…</div>
          )}
          {status === "succeeded" && (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Payment received</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
                Thank you. We&apos;ll be in touch shortly. A receipt is on the way to your inbox.
              </div>
            </>
          )}
          {status === "processing" && (
            <>
              <div style={{ fontSize: 40, color: C.amber, marginBottom: 12 }}>…</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Payment processing</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
                Your payment is processing. We&apos;ll email you when it clears — usually within a few minutes.
              </div>
            </>
          )}
          {status === "requires_payment_method" && (
            <>
              <div style={{ fontSize: 40, color: C.red, marginBottom: 12 }}>!</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Payment didn&apos;t go through</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 18 }}>
                Your card was declined or canceled. You can try again with the same or a different payment method.
              </div>
              <a href={`/portal/${params.token}/pay`} style={{ display: "inline-block", padding: "10px 22px", background: C.text, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                Try again →
              </a>
            </>
          )}
          {status === "failed" && (
            <>
              <div style={{ fontSize: 40, color: C.red, marginBottom: 12 }}>✕</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 18 }}>
                {errorMsg || "We couldn't confirm your payment. Please try again or contact us if this keeps happening."}
              </div>
              <a href={`/portal/${params.token}/pay`} style={{ display: "inline-block", padding: "10px 22px", background: C.text, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                Try again →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

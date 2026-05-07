"use client";

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { getLogoSvgForSlug } from "@/lib/branding-client";

// White-label Stripe pay page. Mirrors the visual language of the
// portal/quote/invoice pages (Helvetica Neue, document-style chrome,
// dark CTA). Client never sees a stripe.com URL — Stripe's Payment
// Element renders inside our page via @stripe/react-stripe-js.
//
// Flow:
//   1. On mount, GET /api/stripe/payment-intent/{token}
//      → returns clientSecret + publishableKey + invoice metadata.
//   2. Render <Elements> with the matching publishableKey + clientSecret.
//   3. <PaymentForm> mounts <PaymentElement> + handles confirm.
//   4. On success Stripe redirects to /portal/{token}/pay/done.
//   5. Webhook (invoice.paid) updates OpsHub-side payment records.
//
// Tenant publishable key is fetched per-request (the tenant Stripe
// account differs between HPD and IHM). We don't pre-seed loadStripe
// at module level since the key isn't known until the API responds.

type Meta = {
  clientSecret: string | null;
  publishableKey: string;
  amountDueCents: number;
  currency: string;
  invoiceNumber: string | null;
  jobNumber: string | null;
  jobTitle: string | null;
  clientName: string | null;
  tenantSlug: string;
  alreadyPaid?: boolean;
  error?: string;
};

const C = {
  bg: "#f8f8f9",
  card: "#ffffff",
  border: "#e0e0e4",
  text: "#1a1a1a",
  muted: "#6b6b78",
  green: "#1a8c5c",
  greenBg: "#edf7f2",
  red: "#c43030",
  redBg: "#fdf2f2",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
};

const fmtMoney = (cents: number, currency: string) => {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format((cents || 0) / 100);
};

// Resolve the tenant slug from the URL the client is on so the logo
// renders correctly even before the API responds (or if it errors).
// Mirrors lib/supabase/client.ts resolveSlugFromHost.
function slugFromCurrentHost(): string {
  if (typeof window === "undefined") return "hpd";
  const h = window.location.hostname.toLowerCase();
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export default function PayPage({ params }: { params: { token: string } }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);
  // Default to the host's tenant so the logo doesn't flash HPD on IHM.
  const [hostSlug, setHostSlug] = useState<string>("hpd");

  const [debugInfo, setDebugInfo] = useState<any>(null);

  useEffect(() => {
    setHostSlug(slugFromCurrentHost());
    (async () => {
      try {
        const res = await fetch(`/api/stripe/payment-intent/${params.token}`);
        const data = await res.json();
        if (!res.ok) {
          setLoadErr(data?.error || "Unable to load payment details.");
          if (data?.debug) setDebugInfo(data.debug);
          return;
        }
        setMeta(data);
        if (data.publishableKey && data.clientSecret) {
          setStripePromise(loadStripe(data.publishableKey));
        }
      } catch (e: any) {
        setLoadErr(e?.message || "Unable to load payment details.");
      }
    })();
  }, [params.token]);

  if (loadErr) return <CenterCard tenantSlug={hostSlug}><Error msg={loadErr} debug={debugInfo} /></CenterCard>;
  if (!meta) return <CenterCard tenantSlug={hostSlug}><Loading /></CenterCard>;
  if (meta.alreadyPaid) return <CenterCard tenantSlug={meta.tenantSlug}><AlreadyPaid invoiceNumber={meta.invoiceNumber} /></CenterCard>;
  if (!meta.clientSecret || !stripePromise) return <CenterCard tenantSlug={meta.tenantSlug}><Loading /></CenterCard>;

  return (
    <CenterCard tenantSlug={meta.tenantSlug}>
      <InvoiceSummary meta={meta} />
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: meta.clientSecret,
          appearance: { theme: "stripe", variables: { colorPrimary: "#1a1a1a", borderRadius: "8px" } },
        }}
      >
        <PaymentForm token={params.token} amountLabel={fmtMoney(meta.amountDueCents, meta.currency)} />
      </Elements>
    </CenterCard>
  );
}

function CenterCard({ children, tenantSlug }: { children: React.ReactNode; tenantSlug: string }) {
  const logo = getLogoSvgForSlug(tenantSlug);
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text, padding: "48px 16px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ marginBottom: 32, display: "flex", justifyContent: "center" }}
          dangerouslySetInnerHTML={{ __html: logo.replace(/style="[^"]*"/, 'style="height:48px;display:block"') }} />
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>
          {children}
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: C.muted, marginTop: 16 }}>Secure payment processing.</div>
      </div>
    </div>
  );
}

function InvoiceSummary({ meta }: { meta: Meta }) {
  return (
    <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
        {meta.invoiceNumber ? `Invoice ${meta.invoiceNumber}` : "Invoice"}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        {fmtMoney(meta.amountDueCents, meta.currency)}
      </div>
      {(meta.jobTitle || meta.clientName) && (
        <div style={{ fontSize: 13, color: C.muted }}>
          {[meta.jobTitle, meta.clientName].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

function PaymentForm({ token, amountLabel }: { token: string; amountLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrMsg(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/portal/${token}/pay/done`,
      },
    });
    if (error) {
      setErrMsg(error.message || "Payment failed. Please try again.");
      setSubmitting(false);
    }
    // No else — Stripe redirects on success.
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: "tabs" }} />
      {errMsg && (
        <div style={{ marginTop: 14, padding: "10px 12px", background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 13, color: C.red }}>
          {errMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        style={{
          marginTop: 20, width: "100%", padding: "14px 20px", background: C.text, color: "#fff",
          border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: C.font,
          cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Processing…" : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}

function Loading() {
  return <div style={{ textAlign: "center", color: C.muted, fontSize: 14, padding: "24px 0" }}>Loading payment details…</div>;
}
function Error({ msg, debug }: { msg: string; debug?: any }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.red, marginBottom: 4 }}>{msg}</div>
      {debug && (
        <pre style={{ marginTop: 16, padding: 12, background: "#f3f3f5", borderRadius: 6, fontSize: 11, color: "#444", textAlign: "left", overflow: "auto" }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      )}
    </div>
  );
}
function AlreadyPaid({ invoiceNumber }: { invoiceNumber: string | null }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Already paid</div>
      <div style={{ fontSize: 13, color: C.muted }}>
        {invoiceNumber ? `Invoice ${invoiceNumber} has been paid in full.` : "This invoice has been paid in full."}
      </div>
    </div>
  );
}

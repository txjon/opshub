"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { SendEmailDialog } from "@/components/SendEmailDialog";

// Stripe-backed invoice tab. Used by IHM (and any other tenant with
// companies.default_payment_provider = 'stripe'). Two-step flow:
//   1. "Create Stripe Invoice" — pushes line items to Stripe, finalizes
//      the invoice (assigns the IHM-2605-### number + PaymentIntent),
//      but does NOT email the client (Tier 3 white-label).
//   2. "Email Invoice" — opens SendEmailDialog so the team can confirm
//      recipients before OpsHub sends the branded email via Resend
//      (with PDF attachment + Pay Online button pointing at the white-
//      label /portal/{token}/pay page on the tenant's domain).
//
// Voiding the invoice in Stripe Dashboard frees the slot — clicking
// Create again falls through to recreate (route detects status=void).
//
// Payment records + add-payment UI mirror the QB tab so the team's
// muscle memory carries over.

export function StripePaymentTab({ job, items = [], contacts, payments, onReload, onRecalcPhase, onUpdateJob }) {
  const supabase = createClient();
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);
  const [pmType, setPmType] = useState("deposit");
  const [pmAmount, setPmAmount] = useState("");
  const [pmInvoice, setPmInvoice] = useState("");
  const [pmDue, setPmDue] = useState(new Date().toISOString().split("T")[0]);
  const [showInvoiceEmail, setShowInvoiceEmail] = useState(false);

  const stripeInvoiceId = job.type_meta?.stripe_invoice_id;
  const stripeInvoiceNumber = job.type_meta?.stripe_invoice_number;
  const stripePaymentLink = job.type_meta?.stripe_payment_link;
  const stripeInvoiceStatus = job.type_meta?.stripe_invoice_status;
  const stripeTotalCents = job.type_meta?.stripe_total_cents;

  // Aggregate payments — same math the QB tab uses, kept simple.
  const aggInvoiceTotal = stripeTotalCents ? stripeTotalCents / 100 : 0;
  const aggPaidSum = payments
    .filter(p => p.status === "paid")
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const aggBalance = Math.max(0, aggInvoiceTotal - aggPaidSum);
  const aggIsPartial = aggInvoiceTotal > 0.01 && aggPaidSum > 0.01 && aggBalance > 0.01;

  async function pushToStripe() {
    setPushing(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/stripe/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to push to Stripe");
      if (onUpdateJob) onUpdateJob({
        type_meta: {
          ...(job.type_meta || {}),
          stripe_invoice_id: data.invoiceId,
          stripe_invoice_number: data.invoiceNumber,
          stripe_payment_link: data.hostedUrl,
          stripe_total_cents: data.totalCents,
          stripe_invoice_status: data.status,
        },
      });
      if (data.alreadyExists) {
        setInfo(`Stripe invoice already exists — #${data.invoiceNumber}. Void it in the Stripe Dashboard before re-pushing if line items changed.`);
      } else {
        setInfo(`Invoice #${data.invoiceNumber} created — $${(data.totalCents / 100).toFixed(2)}. Click "Email Invoice" to send the branded email to the client.`);
      }
      if (onReload) onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setPushing(false);
    }
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoicing — Stripe</div>
          {stripeInvoiceNumber && <div style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>#{stripeInvoiceNumber}</div>}
        </div>

        {/* Step 1: Create / refresh the Stripe invoice (no email).
            Step 2: Email the client via Resend with the white-label
                    pay link. Sequence is decoupled so the team can
                    inspect / preview before sending. */}
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={pushToStripe} disabled={pushing}
            style={{ flex: 1, height: 38, borderRadius: 7,
              border: stripeInvoiceNumber ? `1.5px solid ${T.green}` : "none",
              cursor: pushing ? "default" : "pointer",
              background: stripeInvoiceNumber ? T.greenDim : T.blue,
              color: stripeInvoiceNumber ? T.green : "#fff",
              fontSize: 12, fontWeight: 700, fontFamily: font,
              opacity: pushing ? 0.6 : 1, transition: "opacity 0.15s", padding: "0 12px",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            title={pushing ? "Working…" : stripeInvoiceNumber ? "Invoice created in Stripe — void in Stripe Dashboard before re-pushing" : "Create the invoice in Stripe"}>
            {pushing ? "Working…"
              : stripeInvoiceNumber ? `✓ Created #${stripeInvoiceNumber}`
              : "Create Stripe Invoice"}
          </button>
          {stripeInvoiceNumber && (
            <button onClick={() => setShowInvoiceEmail(true)}
              style={{ height: 38, padding: "0 16px", borderRadius: 7, background: T.accent, color: "#fff",
                border: "none", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6 }}>
              Email Invoice
            </button>
          )}
        </div>

        {error && (
          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.red, background: T.redDim }}>{error}</div>
        )}
        {info && !error && (
          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.green, background: T.greenDim }}>{info}</div>
        )}

        {/* Invoice metadata strip */}
        {stripeInvoiceNumber && (
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap", fontSize: 11 }}>
            <div>
              <span style={{ color: T.faint, marginRight: 5 }}>Total</span>
              <strong style={{ fontFamily: mono }}>${(stripeTotalCents / 100).toFixed(2)}</strong>
            </div>
            <div>
              <span style={{ color: T.faint, marginRight: 5 }}>Status</span>
              <span style={{
                fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10,
                color: stripeInvoiceStatus === "paid" ? T.green
                  : stripeInvoiceStatus === "open" ? T.amber
                  : stripeInvoiceStatus === "payment_failed" ? T.red
                  : T.muted,
              }}>
                {stripeInvoiceStatus || "—"}
              </span>
            </div>
            <a href={`https://dashboard.stripe.com/invoices/${stripeInvoiceId}`} target="_blank" rel="noopener noreferrer"
              style={{ marginLeft: "auto", color: T.muted, fontSize: 10, textDecoration: "underline dotted" }}>
              Open in Stripe Dashboard ↗
            </a>
          </div>
        )}

        {/* Payment Records */}
        <div style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Payment Records</div>
            <button onClick={() => setAddingPayment(!addingPayment)}
              style={{ background: T.accent, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 14px", cursor: "pointer" }}>
              + Add Payment
            </button>
          </div>

          {(() => {
            if (aggInvoiceTotal <= 0.01 && aggPaidSum <= 0.01) return null;
            const isPaid = aggPaidSum > 0.01 && aggBalance <= 0.01;
            const stateColor = isPaid ? T.green : aggIsPartial ? T.amber : T.muted;
            const stateLabel = isPaid ? "Paid" : aggIsPartial ? "Partial Paid" : "Unpaid";
            const fmt = n => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "8px 10px", marginBottom: 8, background: T.surface, borderRadius: 6, border: `1px solid ${T.border}`, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: stateColor }}>{stateLabel}</span>
                <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>
                  <strong style={{ color: T.text }}>{fmt(aggPaidSum)}</strong> paid of <strong style={{ color: T.text }}>{fmt(aggInvoiceTotal)}</strong>
                  {aggIsPartial && <> · <span style={{ color: T.amber }}>{fmt(aggBalance)} outstanding</span></>}
                </span>
              </div>
            );
          })()}

          {addingPayment && (
            <div style={{ background: T.surface, border: `1px solid ${T.accent}44`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                <select value={pmType} onChange={e => setPmType(e.target.value)} style={ic}>
                  <option value="deposit">Deposit</option>
                  <option value="balance">Balance</option>
                  <option value="full_payment">Full Payment</option>
                  <option value="refund">Refund</option>
                </select>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: T.faint, fontFamily: mono, pointerEvents: "none" }}>$</span>
                  <input type="text" inputMode="decimal" placeholder="0.00" value={pmAmount} onChange={e => setPmAmount(e.target.value)}
                    style={{ ...ic, paddingLeft: 22, fontFamily: mono }} />
                </div>
                <input placeholder="Invoice #" value={pmInvoice} onChange={e => setPmInvoice(e.target.value)} style={ic} />
                <input type="date" value={pmDue} onChange={e => setPmDue(e.target.value)} style={ic} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={async () => {
                  const amount = parseFloat(String(pmAmount).replace(/[^0-9.\-]/g, "")) || 0;
                  if (!amount) return;
                  const invoice_number = pmInvoice.trim() || stripeInvoiceNumber || null;
                  const due_date = pmDue || null;
                  await supabase.from("payment_records").insert({
                    job_id: job.id,
                    type: pmType, amount, invoice_number, due_date,
                    status: "paid", paid_date: new Date().toISOString().split("T")[0],
                  });
                  logJobActivity(job.id, `Payment received: ${pmType.replace(/_/g, " ")} — $${amount.toLocaleString()}${invoice_number ? ` (${invoice_number})` : ""}`);
                  notifyTeam(`Payment received — $${amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
                  setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmDue(new Date().toISOString().split("T")[0]);
                  setAddingPayment(false);
                  if (onReload) onReload();
                  if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
                }} style={{ background: T.green, border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>Save</button>
                <button onClick={() => { setAddingPayment(false); setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmDue(new Date().toISOString().split("T")[0]); }}
                  style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {payments.length === 0 && !addingPayment && <p style={{ fontSize: 12, color: T.muted }}>No payments recorded yet.</p>}
          {payments.length > 0 && (
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {["Invoice", "Type", "Amount", "Due", "Status", ""].map(h => <th key={h} style={{ textAlign: "left", padding: "3px 6px", color: T.muted, fontWeight: 500 }}>{h}</th>)}
              </tr></thead>
              <tbody>{payments.map(p => {
                const statuses = ["pending", "paid", "void"];
                const statusStyle = { pending: { bg: T.amberDim, color: T.amber }, paid: { bg: T.greenDim, color: T.green }, void: { bg: T.redDim, color: T.red } };
                const isRowPartialDisplay = p.status === "paid" && aggIsPartial;
                const display = isRowPartialDisplay ? { bg: T.amberDim, color: T.amber } : (statusStyle[p.status] || statusStyle.pending);
                const rowLabel = isRowPartialDisplay ? "partial paid" : p.status;
                const nextStatus = () => { const idx = statuses.indexOf(p.status); return statuses[(idx + 1) % statuses.length]; };
                return (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "6px", fontFamily: mono, color: T.muted }}>{p.invoice_number || "—"}</td>
                    <td style={{ padding: "6px", textTransform: "capitalize" }}>{p.type.replace(/_/g, " ")}</td>
                    <td style={{ padding: "6px", fontWeight: 600 }}>${p.amount.toLocaleString()}</td>
                    <td style={{ padding: "6px", color: T.muted }}>{p.due_date ? new Date(p.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                    <td style={{ padding: "6px" }}>
                      <button onClick={async () => {
                        const ns = nextStatus();
                        await supabase.from("payment_records").update({ status: ns, paid_date: ns === "paid" ? new Date().toISOString().split("T")[0] : null }).eq("id", p.id);
                        logJobActivity(job.id, `Payment ${p.invoice_number || "#"} status → ${ns}${ns === "paid" ? " — $" + p.amount.toLocaleString() : ""}`);
                        if (ns === "paid") notifyTeam(`Payment received — $${p.amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
                        if (onReload) onReload();
                        if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
                      }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: display.color, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: font }}>{rowLabel}</button>
                    </td>
                    <td style={{ padding: "6px" }}>
                      <button onClick={async () => {
                        await supabase.from("payment_records").delete().eq("id", p.id);
                        if (onReload) onReload();
                        if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
                      }} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.red}
                        onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      </div>

      {showInvoiceEmail && (() => {
        const isRevised = !!job.type_meta?.invoice_sent_at;
        const invoiceLabel = isRevised ? "Revised invoice" : "Invoice";
        return (
          <SendEmailDialog
            type="invoice"
            jobId={job.id}
            contacts={(contacts || []).map(c => ({ name: c.name, email: c.email || "" }))}
            defaultEmail={(contacts || []).find(c => c.role_on_job === "billing")?.email || (contacts || []).find(c => c.role_on_job === "primary")?.email || ""}
            defaultSubject={`${invoiceLabel} — ${job.clients?.name || ""}${stripeInvoiceNumber ? ` · Invoice ${stripeInvoiceNumber}` : ""} · ${job.title}`}
            onClose={() => setShowInvoiceEmail(false)}
            onSent={() => {
              logJobActivity(job.id, `${invoiceLabel} sent to client`);
              setShowInvoiceEmail(false);
              if (onUpdateJob) onUpdateJob({
                type_meta: { ...(job.type_meta || {}), invoice_sent_at: new Date().toISOString() },
              });
              if (onReload) onReload();
            }}
          />
        );
      })()}
    </div>
  );
}

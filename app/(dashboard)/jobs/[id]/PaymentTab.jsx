"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { InvoiceVarianceReviewModal } from "@/components/InvoiceVarianceReviewModal";
import { useIsMobile } from "@/lib/useIsMobile";
import { PdfCanvasPreview } from "@/components/PdfCanvasPreview";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QBCustomerChooser } from "@/components/QBCustomerChooser";
import { StripePaymentTab } from "./StripePaymentTab";

export function PaymentTab(props) {
  const { job } = props;
  const supabase = createClient();
  // Provider-aware fork — fetch the job's company once and route to
  // StripePaymentTab when the company is Stripe-backed (IHM at launch).
  // HPD stays on the existing QB-backed path below, completely untouched.
  const [provider, setProvider] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!job?.company_id) { setProvider("quickbooks"); return; }
      const { data } = await supabase
        .from("companies")
        .select("default_payment_provider")
        .eq("id", job.company_id)
        .single();
      if (!cancelled) setProvider(data?.default_payment_provider || "quickbooks");
    })();
    return () => { cancelled = true; };
  }, [job?.company_id]);
  if (provider === null) return null; // brief render while we resolve provider
  if (provider === "stripe") return <StripePaymentTab {...props} />;
  return <PaymentTabQB {...props} />;
}

function PaymentTabQB({ job, items = [], contacts, payments, onReload, onRecalcPhase, onUpdateJob }) {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [showInvoiceEmail, setShowInvoiceEmail] = useState(false);
  const [showReminderEmail, setShowReminderEmail] = useState(false);
  const [showInvoiceProofsEmail, setShowInvoiceProofsEmail] = useState(false);
  const [pushingToQB, setPushingToQB] = useState(false);
  const [qbError, setQbError] = useState("");
  const [qbInfo, setQbInfo] = useState("");
  // QB customer chooser (409-on-push + manual relink)
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserCandidates, setChooserCandidates] = useState(undefined);
  const [chooserCurrent, setChooserCurrent] = useState(undefined);
  const [showVarianceModal, setShowVarianceModal] = useState(false);
  const [refreshingLink, setRefreshingLink] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [showSendAnywayConfirm, setShowSendAnywayConfirm] = useState(false);

  // Variance review becomes available once invoice exists AND job is fully shipped
  const isDropShip = job.shipping_route === "drop_ship";
  const isShipThrough = job.shipping_route === "ship_through";
  const allItemsShipped = items.length > 0 && items.every(it => it.pipeline_stage === "shipped");
  const isFullyShipped = (isDropShip && allItemsShipped) || (isShipThrough && job.fulfillment_status === "shipped");
  const [addingPayment, setAddingPayment] = useState(false);
  const [pmType, setPmType] = useState("deposit");
  const [pmAmount, setPmAmount] = useState("");
  const [pmInvoice, setPmInvoice] = useState("");
  const [pmPaid, setPmPaid] = useState(new Date().toISOString().split("T")[0]);

  const qbInvoiceNumber = job.type_meta?.qb_invoice_number;
  const qbPaymentLink = job.type_meta?.qb_payment_link;

  // Detect stale QB invoice — current pricing doesn't match QB total.
  // Suppressed once variance was pushed, because the QB total then reflects
  // shipped qtys (not the costing grossRev quote total), so the comparison
  // is no longer meaningful. Also suppressed when the invoice # was
  // entered manually (qb_invoice_number set but qb_invoice_id missing) —
  // there's no QB invoice on our side to compare against, and "click to
  // update" would create a DUPLICATE in QB.
  const variancePushedAt = job.type_meta?.qb_variance_pushed_at || null;
  // Extra invoice lines are pushed to QB too (qb/invoice route), so the
  // staleness comparison must add them to the product-only grossRev —
  // otherwise any invoice with additional charges would read as permanently
  // "stale" against the QB total that already includes them.
  const _extraLines = (Array.isArray(job?.type_meta?.invoice_extra_lines) ? job.type_meta.invoice_extra_lines : []);
  const extrasSubtotal = _extraLines.reduce((a, l) => a + (Number(l?.amount) || 0), 0);
  // What OpsHub would push as the invoice subtotal = real-product revenue
  // (grossRev) + passthruTotal (passthrough PRODUCTS + passthru-type extra lines)
  // + the remaining non-passthru extra lines. passthruTotal is essential: a
  // passthrough job has grossRev $0 but QB still bills the full passthrough
  // amount, so without it the invoice reads as permanently "stale". Excluding
  // passthru-type extras from the tail avoids double-counting (they're already
  // inside passthruTotal). For non-passthrough jobs this equals grossRev + extras.
  const _passthruTotal = Number(job.costing_summary?.passthruTotal) || 0;
  const _nonPassthruExtras = _extraLines.filter(l => l?.type !== "passthru").reduce((a, l) => a + (Number(l?.amount) || 0), 0);
  const currentSubtotal = (job.costing_summary?.grossRev || 0) + _passthruTotal + _nonPassthruExtras;
  const qbSubtotal = (job.type_meta?.qb_total_with_tax || 0) - (job.type_meta?.qb_tax_amount || 0);
  const qbInvoiceId = job.type_meta?.qb_invoice_id;
  const isManualInvoice = !!qbInvoiceNumber && !qbInvoiceId;
  const invoiceStale = !!qbInvoiceId && !variancePushedAt && Math.abs(currentSubtotal - qbSubtotal) > 0.01;

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };
  const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

  // Project-level payment aggregate. Used both for the summary strip
  // above the table and to override individual row pills so a "paid"
  // row doesn't visually contradict a "Partial Paid" project.
  const aggInvoiceTotal = Number(job?.type_meta?.qb_total_with_tax)
    || currentSubtotal
    || 0;
  const aggPaidSum = (payments || [])
    .filter(p => p.status === "paid" || p.status === "partial")
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const aggBalance = Math.max(0, aggInvoiceTotal - aggPaidSum);
  const aggIsPartial = aggPaidSum > 0.01 && aggBalance > 0.01;

  async function refreshLink() {
    if (refreshingLink) return;
    setRefreshingLink(true);
    setLinkError("");
    try {
      const res = await fetch("/api/qb/refresh-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.paymentLink) {
        throw new Error(data.error || "QuickBooks did not return a payment link.");
      }
      if (onUpdateJob) onUpdateJob({
        type_meta: { ...(job.type_meta || {}), qb_payment_link: data.paymentLink },
      });
      logJobActivity(job.id, "QB payment link refreshed");
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setRefreshingLink(false);
    }
  }

  function handleSendInvoiceClick() {
    if (!qbPaymentLink) {
      setShowSendAnywayConfirm(true);
      return;
    }
    setShowInvoiceEmail(true);
  }

  async function pushToQB(opts = {}) {
    setPushingToQB(true);
    setQbError("");
    setQbInfo("");
    try {
      const body = { jobId: job.id };
      if (opts.qbCustomerId) body.qbCustomerId = opts.qbCustomerId;
      if (opts.forceCreate) body.forceCreate = true;
      const res = await fetch("/api/qb/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409 && data?.error === "ambiguous_customer") {
        // Open chooser instead of duplicating. Caller picks the right
        // QB customer, we retry with qbCustomerId (or forceCreate).
        setChooserCandidates(data.candidates || []);
        setChooserCurrent(null);
        setChooserOpen(true);
        return null;
      }
      if (!res.ok) throw new Error(data.error || "Failed to push to QuickBooks");
      if (onUpdateJob) onUpdateJob({
        type_meta: {
          ...(job.type_meta || {}),
          qb_invoice_id: data.invoiceId || job.type_meta?.qb_invoice_id,
          qb_invoice_number: data.invoiceNumber || job.type_meta?.qb_invoice_number,
          qb_payment_link: data.paymentLink || job.type_meta?.qb_payment_link,
        },
      });
      if (data.healedFrom) {
        setQbInfo(`Re-linked to the active QB customer (the previously cached one was deleted) and created a fresh invoice #${data.invoiceNumber}.`);
      }
      if (data.updated) {
        logJobActivity(job.id, `QB Invoice #${data.invoiceNumber} updated with new pricing`);
      } else {
        logJobActivity(job.id, `Invoice #${data.invoiceNumber} created in QuickBooks`);
      }
      // Re-read job from DB so every tab has fresh type_meta — prevents
      // later writes to type_meta (lock pricing, PO sent, etc.) from
      // clobbering qb_invoice_id with stale local state.
      if (onReload) onReload();
      return data;
    } catch (err) {
      setQbError(err.message);
      return null;
    } finally {
      setPushingToQB(false);
    }
  }

  function openChooserManual() {
    setChooserCandidates(undefined);
    setChooserCurrent(undefined);
    setChooserOpen(true);
  }

  async function handleChooserAction(a) {
    if (a.type === "select") {
      setChooserOpen(false);
      setQbInfo(`Linked to "${a.displayName}". Pushing…`);
      await pushToQB({ qbCustomerId: a.qbCustomerId });
      return;
    }
    if (a.type === "create_new") {
      setChooserOpen(false);
      await pushToQB({ forceCreate: true });
      return;
    }
    if (a.type === "unlink") {
      try {
        const res = await fetch("/api/qb/link-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: job.client_id, qbCustomerId: null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Unlink failed");
        setChooserCurrent(null);
        setQbInfo("Cleared the linked QB customer. Next push will re-run the smart match.");
      } catch (e) {
        setQbError(e.message || "Unlink failed");
      }
    }
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── INVOICING card — wraps action buttons, invoice metadata,
          variance review, and payment records into one panel. ── */}
      <div style={card}>

        {/* Card header */}
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoicing</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* Invoice date override — only affects the OpsHub-generated
                PDF. QB's own record keeps its TxnDate. Blank clears the
                override so the PDF falls back to invoice_sent_at. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Invoice date</span>
              <input type="date"
                value={job.type_meta?.invoice_date_override || ""}
                onChange={async (e) => {
                  const val = e.target.value || null;
                  const next = { ...(job.type_meta || {}) };
                  if (val) next.invoice_date_override = val;
                  else delete next.invoice_date_override;
                  await supabase.from("jobs").update({ type_meta: next }).eq("id", job.id);
                  if (onUpdateJob) onUpdateJob({ type_meta: next });
                }}
                title="Manual override for the date shown on the OpsHub invoice PDF. Leave blank to use the send date."
                style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, padding: "4px 8px", fontFamily: font, outline: "none", cursor: "pointer" }} />
              {job.type_meta?.invoice_date_override && (
                <button onClick={async () => {
                  const next = { ...(job.type_meta || {}) };
                  delete next.invoice_date_override;
                  await supabase.from("jobs").update({ type_meta: next }).eq("id", job.id);
                  if (onUpdateJob) onUpdateJob({ type_meta: next });
                }}
                  title="Clear override"
                  style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}>×</button>
              )}
            </div>
            {qbInvoiceNumber && <div style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>QB #{qbInvoiceNumber}</div>}
          </div>
        </div>

        {/* Read-only echo of custom invoice line items so the full invoice
            composition is visible right at push time. Edited on the
            Costing → Client Quote tab; pushed to QB by the invoice route. */}
        {(() => {
          const extras = Array.isArray(job?.type_meta?.invoice_extra_lines) ? job.type_meta.invoice_extra_lines : [];
          if (!extras.length) return null;
          const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, fontFamily: font, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Additional charges</div>
              {extras.map((l, i) => (
                <div key={l.id || i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: T.text, padding: "3px 0" }}>
                  <span>{l.description || "Additional charge"}{l.qb_item ? <span style={{ color: T.faint, marginLeft: 6 }}>· {l.qb_item}</span> : null}</span>
                  <span style={{ fontFamily: mono }}>{fmtMoney(l.amount)}</span>
                </div>
              ))}
              <div style={{ fontSize: 10, color: T.faint, marginTop: 6 }}>Edit on Costing → Client Quote.</div>
            </div>
          );
        })()}

        {/* Action buttons — slimmer 3-step row, no big arrow icons */}
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={pushToQB} disabled={pushingToQB || isManualInvoice}
            style={{ flex: 1, height: 38, borderRadius: 7,
              border: invoiceStale ? `1.5px solid ${T.red}` : qbInvoiceNumber ? `1.5px solid ${T.green}` : "none",
              cursor: pushingToQB ? "default" : isManualInvoice ? "default" : "pointer",
              background: invoiceStale ? T.redDim : qbInvoiceNumber ? T.greenDim : T.blue,
              color: invoiceStale ? T.red : qbInvoiceNumber ? T.green : "#fff",
              fontSize: 12, fontWeight: 700, fontFamily: font,
              opacity: pushingToQB ? 0.6 : 1, transition: "opacity 0.15s", padding: "0 12px",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            title={pushingToQB ? "Working…" : invoiceStale ? "Pricing changed — click to update" : qbInvoiceNumber ? "Click to update" : "Push invoice to QuickBooks"}
            onMouseEnter={e => { if (!pushingToQB && !isManualInvoice) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
            {pushingToQB ? (qbInvoiceNumber ? "Updating…" : "Creating…")
              : isManualInvoice ? `✓ QB #${qbInvoiceNumber}`
              : invoiceStale ? `⚠ QB #${qbInvoiceNumber}`
              : qbInvoiceNumber ? `✓ QB #${qbInvoiceNumber}`
              : "Create QB Invoice"}
          </button>
          <button onClick={handleSendInvoiceClick} disabled={!qbInvoiceNumber}
            title={!qbInvoiceNumber ? "Create the QB invoice first" : "Preview + send to client in one screen"}
            style={{ flex: 1, height: 38, borderRadius: 7, border: "none",
              cursor: !qbInvoiceNumber ? "default" : "pointer",
              background: !qbInvoiceNumber ? T.surface : T.accent, color: !qbInvoiceNumber ? T.faint : "#fff",
              fontSize: 12, fontWeight: 700, fontFamily: font,
              opacity: !qbInvoiceNumber ? 0.4 : 1, transition: "opacity 0.15s", padding: "0 12px" }}
            onMouseEnter={e => { if (qbInvoiceNumber) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = !qbInvoiceNumber ? "0.4" : "1"; }}>
            Send Invoice
          </button>
        </div>

        {/* Send Reminder — appears once the invoice has been sent so
            HPD can nudge the client without re-sending the original
            invoice email. Reuses the email pipeline with reminder
            copy + the same pay link. Reminder doesn't bump
            invoice_sent_at (the original send date pins the PDF
            issue date); tracked via last_reminder_sent_at. */}
        {job.type_meta?.invoice_sent_at && (
          <div style={{ padding: "8px 14px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 10, color: T.faint, fontFamily: font }}>
              {job.type_meta?.last_reminder_sent_at
                ? `Last reminded ${new Date(job.type_meta.last_reminder_sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : "Invoice sent — send a reminder if no payment yet"}
            </span>
            <button onClick={() => setShowReminderEmail(true)}
              style={{ height: 32, borderRadius: 6, border: `1px solid ${T.border}`,
                background: T.card, color: T.text, cursor: "pointer",
                fontSize: 11, fontWeight: 700, fontFamily: font, padding: "0 14px" }}
              onMouseEnter={e => e.currentTarget.style.background = T.surface}
              onMouseLeave={e => e.currentTarget.style.background = T.card}>
              Send Reminder
            </button>
          </div>
        )}

        {/* Invoice # + Pay link — one tight row, no wrap */}
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoice #</label>
            <input
              type="text"
              value={job.type_meta?.qb_invoice_number || ""}
              onChange={e => {
                const num = e.target.value;
                if (onUpdateJob) onUpdateJob({ type_meta: { ...(job.type_meta || {}), qb_invoice_number: num || null } });
              }}
              onBlur={async e => {
                const num = e.target.value.trim();
                const meta = { ...(job.type_meta || {}), qb_invoice_number: num || null };
                await supabase.from("jobs").update({ type_meta: meta }).eq("id", job.id);
                if (num) logJobActivity(job.id, `Invoice number manually set to #${num}`);
              }}
              placeholder="—"
              style={{ width: 90, padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.card, color: T.text, fontSize: 12, fontFamily: mono, fontWeight: 600, textAlign: "center", outline: "none" }}
            />
            <button
              type="button"
              onClick={openChooserManual}
              disabled={pushingToQB}
              title="Verify or change which QuickBooks customer this client is linked to"
              style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontSize: 10, fontWeight: 600, padding: "4px 8px", cursor: pushingToQB ? "default" : "pointer", fontFamily: font, opacity: pushingToQB ? 0.6 : 1 }}
            >
              QB customer
            </button>
          </div>
          {/* Pay link inline (when invoice exists) */}
          {qbInvoiceId && (() => {
            const working = refreshingLink;
            const hasLink = !!qbPaymentLink;
            const failed = !hasLink && !!linkError;
            const bg = working ? T.surface : hasLink ? T.greenDim : failed ? T.redDim : T.amberDim;
            const fg = working ? T.muted : hasLink ? T.green : failed ? T.red : T.amber;
            const borderColor = working ? T.border : hasLink ? `${T.green}66` : failed ? `${T.red}66` : `${T.amber}66`;
            const label = working ? "Working…" : hasLink ? "Pay link" : failed ? "Pay link failed" : "No pay link";
            return (
              <div style={{ display: "flex", alignItems: "stretch", gap: 0, borderRadius: 6, overflow: "hidden", border: `1px solid ${borderColor}` }}>
                <button onClick={refreshLink} disabled={working}
                  title={failed ? linkError : (hasLink ? "Click to refresh" : working ? "" : failed ? "Click to retry" : "Click to create")}
                  style={{ background: bg, color: fg, border: "none", padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: font, cursor: working ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5 }}
                  onMouseEnter={e => { if (!working) e.currentTarget.style.opacity = "0.85"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
                  <span>{hasLink ? "✓" : failed ? "✕" : working ? "…" : "○"}</span>
                  <span>{label}</span>
                </button>
                {hasLink && !working && (
                  <a href={qbPaymentLink} target="_blank" rel="noopener noreferrer" title="Open pay link"
                    style={{ background: bg, color: fg, borderLeft: `1px solid ${borderColor}`, padding: "0 9px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", textDecoration: "none" }}>→</a>
                )}
              </div>
            );
          })()}
        </div>
        {linkError && qbInvoiceId && !qbPaymentLink && (
          <div style={{ padding: "6px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.red, lineHeight: 1.4 }}>
            {linkError}
          </div>
        )}
        {qbError && (
          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.red, background: T.redDim }}>{qbError}</div>
        )}
        {qbInfo && !qbError && (
          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.green, background: T.greenDim }}>{qbInfo}</div>
        )}

        {/* Variance review — appears once invoice exists AND job is fully shipped.
            Once variance has been pushed, we flip to a subtle "✓ finalized" row
            with an option to re-review if needed. */}
        {qbInvoiceNumber && isFullyShipped && !variancePushedAt && (
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
            <button onClick={() => setShowVarianceModal(true)}
              style={{ width: "100%", padding: "10px", borderRadius: 7, border: `1px solid ${T.amber}66`, cursor: "pointer",
                background: T.amberDim, color: T.amber, fontSize: 12, fontWeight: 700, fontFamily: font,
                transition: "opacity 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              Update QB Invoice with {isShipThrough ? "Received" : "Shipped"} Qtys — Review Variance
            </button>
          </div>
        )}
        {qbInvoiceNumber && variancePushedAt && (
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: `1px solid ${T.green}44`, background: T.greenDim, color: T.green, fontSize: 11, fontWeight: 600, fontFamily: font, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span>✓ Invoice finalized with {isShipThrough ? "received" : "shipped"} qtys · {new Date(variancePushedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              <button onClick={() => setShowVarianceModal(true)}
                style={{ padding: "3px 9px", borderRadius: 4, border: `1px solid ${T.green}`, background: "transparent", color: T.green, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                Re-review
              </button>
            </div>
          </div>
        )}

        {/* Payment Records — inside the Invoicing card */}
        <div style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Payment Records</div>
            <button onClick={() => setAddingPayment(!addingPayment)} style={{ background: T.accent, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 14px", cursor: "pointer" }}>+ Add Payment</button>
          </div>

        {/* Aggregate paid summary — shows project-level partial state so
            individual "Deposit" rows make sense in context. */}
        {(() => {
          if (aggInvoiceTotal <= 0.01 && aggPaidSum <= 0.01) return null;
          const isPaid = aggPaidSum > 0.01 && aggBalance <= 0.01;
          const stateColor = isPaid ? T.green : aggIsPartial ? T.amber : T.muted;
          const stateLabel = isPaid ? "Paid" : aggIsPartial ? "Partial Paid" : "Unpaid";
          const fmt = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                <input type="text" inputMode="decimal" placeholder="0.00" value={pmAmount} onChange={e => setPmAmount(e.target.value)} style={{ ...ic, paddingLeft: 22, fontFamily: mono }} />
              </div>
              <input placeholder="Invoice #" value={pmInvoice} onChange={e => setPmInvoice(e.target.value)} style={ic} />
              <input type="date" value={pmPaid} onChange={e => setPmPaid(e.target.value)} title="Paid date" style={ic} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={async () => {
                // Accept $0.00 payments — needed for invoices that
                // settled at zero (e.g. fully credited, or QB shows
                // balance due $0 after adjustments) so the job's
                // payment status flips to paid in OpsHub without a
                // separate workaround. Negative / NaN values still
                // bail. Empty amount field reads as 0 too, which is
                // the same as "mark this invoice paid at $0".
                const parsed = parseFloat(String(pmAmount).replace(/[^0-9.\-]/g, ""));
                const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
                if (!Number.isFinite(amount)) return;
                const invoice_number = pmInvoice.trim() || null;
                const paid_date = pmPaid || new Date().toISOString().split("T")[0];
                await supabase.from("payment_records").insert({ job_id: job.id, type: pmType, amount, invoice_number, status: "paid", paid_date });
                logJobActivity(job.id, `Payment received: ${pmType.replace(/_/g, " ")} — $${amount.toLocaleString()}${invoice_number ? ` (${invoice_number})` : ""}`);
                notifyTeam(`Payment received — $${amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
                // Recording a payment is implicit quote approval. Flip the
                // gate now so downstream alerts (Send PO, Order Blanks) can
                // fire without a separate "Approve Quote" click.
                if (!job.quote_approved) {
                  await supabase.from("jobs").update({
                    quote_approved: true,
                    quote_approved_at: new Date().toISOString(),
                    quote_rejection_notes: null,
                  }).eq("id", job.id);
                  logJobActivity(job.id, "Quote auto-approved via payment");
                }
                setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmPaid(new Date().toISOString().split("T")[0]);
                setAddingPayment(false);
                if (onReload) onReload();
                if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
              }} style={{ background: T.green, border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>Save</button>
              <button onClick={() => { setAddingPayment(false); setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmPaid(new Date().toISOString().split("T")[0]); }} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
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
              // When the project as a whole is partial, "paid" rows mirror
              // the amber "Partial Paid" label so the row pill doesn't
              // visually contradict the aggregate strip above.
              const isRowPartialDisplay = p.status === "paid" && aggIsPartial;
              const display = isRowPartialDisplay
                ? { bg: T.amberDim, color: T.amber }
                : (statusStyle[p.status] || statusStyle.pending);
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
                      if (ns === "paid") {
                        notifyTeam(`Payment received — $${p.amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
                        if (!job.quote_approved) {
                          await supabase.from("jobs").update({
                            quote_approved: true,
                            quote_approved_at: new Date().toISOString(),
                            quote_rejection_notes: null,
                          }).eq("id", job.id);
                          logJobActivity(job.id, "Quote auto-approved via payment");
                        }
                      }
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
      {/* ── End Invoicing card ── */}

      {/* Modals — outside the card */}
      {showVarianceModal && (
        <InvoiceVarianceReviewModal
          jobId={job.id}
          shippingRoute={job.shipping_route}
          jobTitle={job.title}
          clientName={job.clients?.name || ""}
          onClose={() => setShowVarianceModal(false)}
          onApproved={() => {
            logJobActivity(job.id, "QB invoice updated with actual qtys — revised invoice emailed to client");
            if (onReload) onReload();
          }}
        />
      )}

      {showInvoiceEmail && (() => {
        const isRevised = !!job.type_meta?.invoice_sent_at;
        const invoiceLabel = isRevised ? "Revised Invoice" : "Invoice";
        const refNum = job.type_meta?.qb_invoice_number || job.job_number || "";
        return (
          <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 100, display: "flex", flexDirection: "column", fontFamily: font }}>
            {/* Header */}
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                  Send {invoiceLabel}{refNum ? ` · #${refNum}` : ""}
                </span>
                <span style={{ fontSize: 11, color: T.muted }}>{job.clients?.name || job.title || ""}</span>
              </div>
              <button onClick={() => setShowInvoiceEmail(false)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}>×</button>
            </div>
            {/* Body: send form left (380px rail), PDF preview right.
                Mobile stacks: form on top, preview below. */}
            <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden", minHeight: 0 }}>
              <div style={{ width: isMobile ? "auto" : 380, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: isMobile ? "none" : `1px solid ${T.border}`, borderBottom: isMobile ? `1px solid ${T.border}` : "none" }}>
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
                  <SendEmailDialog
                    type="invoice"
                    jobId={job.id}
                    contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
                    defaultEmail={contacts.find(c => c.role_on_job === "billing")?.email || contacts.find(c => c.role_on_job === "primary")?.email || ""}
                    defaultSubject={[
                      `${invoiceLabel}${refNum ? ` ${refNum}` : ""}`,
                      job.clients?.name,
                      job.title,
                    ].filter(Boolean).join(" · ").trim()}
                    onClose={() => setShowInvoiceEmail(false)}
                    onSent={() => { logJobActivity(job.id, `${invoiceLabel} sent to client`); setShowInvoiceEmail(false); }}
                  />
                </div>
              </div>
              <div style={{ flex: 1, background: T.surface, overflow: "hidden", minHeight: isMobile ? 280 : 0, display: "flex" }}>
                <PdfCanvasPreview src={`/api/pdf/invoice/${job.id}`} />
              </div>
            </div>
          </div>
        );
      })()}

      {showReminderEmail && (
        <SendEmailDialog
          type="reminder"
          jobId={job.id}
          contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
          defaultEmail={contacts.find(c => c.role_on_job === "billing")?.email || contacts.find(c => c.role_on_job === "primary")?.email || ""}
          defaultSubject={[
            `Invoice reminder${job.type_meta?.qb_invoice_number ? ` · ${job.type_meta.qb_invoice_number}` : ""} — ${job.clients?.name || ""}`,
            job.title,
          ].filter(Boolean).join(" · ")}
          onClose={() => setShowReminderEmail(false)}
          onSent={() => { logJobActivity(job.id, `Invoice reminder sent to client`); setShowReminderEmail(false); }}
        />
      )}

      <ConfirmDialog
        open={showSendAnywayConfirm}
        title="No pay link available"
        message="QuickBooks hasn't returned a pay link for this invoice yet. Sending now means the client won't see a 'Pay Online' button in the email or the portal. Click the amber chip to create the link first, or send anyway and the client will still get the PDF and portal link."
        confirmLabel="Send anyway"
        confirmColor={T.amber}
        onConfirm={() => { setShowSendAnywayConfirm(false); setShowInvoiceEmail(true); }}
        onCancel={() => setShowSendAnywayConfirm(false)}
      />

      <QBCustomerChooser
        open={chooserOpen}
        mode="push"
        clientId={job.client_id}
        searchedName={job.clients?.name || ""}
        candidates={chooserCandidates}
        current={chooserCurrent}
        busy={pushingToQB}
        onAction={handleChooserAction}
        onClose={() => setChooserOpen(false)}
      />
    </div>
  );
}

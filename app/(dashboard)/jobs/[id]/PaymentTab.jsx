"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { InvoiceVarianceReviewModal } from "@/components/InvoiceVarianceReviewModal";
import { PdfPreviewModal } from "@/components/PdfPreviewModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function PaymentTab({ job, items = [], contacts, payments, onReload, onRecalcPhase, onUpdateJob }) {
  const supabase = createClient();
  const [showInvoiceEmail, setShowInvoiceEmail] = useState(false);
  const [showInvoiceProofsEmail, setShowInvoiceProofsEmail] = useState(false);
  const [pushingToQB, setPushingToQB] = useState(false);
  const [qbError, setQbError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
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
  const [pmDue, setPmDue] = useState(new Date().toISOString().split("T")[0]);

  const qbInvoiceNumber = job.type_meta?.qb_invoice_number;
  const qbPaymentLink = job.type_meta?.qb_payment_link;
  const [previewed, setPreviewed] = useState(false);

  // Detect stale QB invoice — current pricing doesn't match QB total.
  // Suppressed once variance was pushed, because the QB total then reflects
  // shipped qtys (not the costing grossRev quote total), so the comparison
  // is no longer meaningful. Also suppressed when the invoice # was
  // entered manually (qb_invoice_number set but qb_invoice_id missing) —
  // there's no QB invoice on our side to compare against, and "click to
  // update" would create a DUPLICATE in QB.
  const variancePushedAt = job.type_meta?.qb_variance_pushed_at || null;
  const currentSubtotal = (job.costing_summary?.grossRev || 0);
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
    || Number(job?.costing_summary?.grossRev)
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

  async function pushToQB() {
    setPushingToQB(true);
    setQbError("");
    try {
      const res = await fetch("/api/qb/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to push to QuickBooks");
      if (onUpdateJob) onUpdateJob({
        type_meta: {
          ...(job.type_meta || {}),
          qb_invoice_id: data.invoiceId || job.type_meta?.qb_invoice_id,
          qb_invoice_number: data.invoiceNumber || job.type_meta?.qb_invoice_number,
          qb_payment_link: data.paymentLink || job.type_meta?.qb_payment_link,
        },
      });
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

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── INVOICING card — wraps action buttons, invoice metadata,
          variance review, and payment records into one panel. ── */}
      <div style={card}>

        {/* Card header */}
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoicing</div>
          {qbInvoiceNumber && <div style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>QB #{qbInvoiceNumber}</div>}
        </div>

        {/* Action buttons — slimmer 3-step row, no big arrow icons */}
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
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
          <button onClick={() => { setShowPreview(true); setPreviewed(true); }} disabled={!qbInvoiceNumber}
            style={{ flex: 1, height: 38, borderRadius: 7,
              border: previewed ? `1.5px solid ${T.accent}` : "none",
              cursor: !qbInvoiceNumber ? "default" : "pointer",
              background: !qbInvoiceNumber ? T.surface : previewed ? T.accentDim : T.accent,
              color: !qbInvoiceNumber ? T.faint : previewed ? T.accent : "#fff",
              fontSize: 12, fontWeight: 700, fontFamily: font,
              opacity: !qbInvoiceNumber ? 0.4 : 1, transition: "opacity 0.15s", padding: "0 12px" }}
            onMouseEnter={e => { if (qbInvoiceNumber) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = !qbInvoiceNumber ? "0.4" : "1"; }}>
            {previewed ? "✓ Preview" : "Preview"}
          </button>
          <button onClick={handleSendInvoiceClick} disabled={!previewed}
            style={{ flex: 1, height: 38, borderRadius: 7, border: "none",
              cursor: !previewed ? "default" : "pointer",
              background: !previewed ? T.surface : T.accent, color: !previewed ? T.faint : "#fff",
              fontSize: 12, fontWeight: 700, fontFamily: font,
              opacity: !previewed ? 0.4 : 1, transition: "opacity 0.15s", padding: "0 12px" }}
            onMouseEnter={e => { if (previewed) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = !previewed ? "0.4" : "1"; }}>
            Send Invoice
          </button>
        </div>

        {/* Invoice # + Pay link — compact inline row */}
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
              style={{ ...ic, width: 110, textAlign: "center", fontFamily: mono, fontWeight: 600 }}
            />
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
            const subLabel = working ? "" : hasLink ? "click to refresh" : failed ? "click to retry" : "click to create";
            return (
              <div style={{ display: "flex", alignItems: "stretch", gap: 0, borderRadius: 7, overflow: "hidden", border: `1px solid ${borderColor}`, marginLeft: "auto" }}>
                <button onClick={refreshLink} disabled={working}
                  title={failed ? linkError : subLabel}
                  style={{ background: bg, color: fg, border: "none", padding: "6px 12px", fontSize: 11, fontWeight: 700, fontFamily: font, cursor: working ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                  onMouseEnter={e => { if (!working) e.currentTarget.style.opacity = "0.85"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
                  <span>{hasLink ? "✓" : failed ? "✕" : working ? "…" : "○"}</span>
                  <span>{label}</span>
                  <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.7 }}>· {subLabel}</span>
                </button>
                {hasLink && !working && (
                  <a href={qbPaymentLink} target="_blank" rel="noopener noreferrer" title="Open pay link"
                    style={{ background: bg, color: fg, borderLeft: `1px solid ${borderColor}`, padding: "0 10px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", textDecoration: "none" }}>→</a>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
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
              <input type="date" value={pmDue} onChange={e => setPmDue(e.target.value)} style={ic} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={async () => {
                const amount = parseFloat(String(pmAmount).replace(/[^0-9.\-]/g, "")) || 0;
                if (!amount) return;
                const invoice_number = pmInvoice.trim() || null;
                const due_date = pmDue || null;
                await supabase.from("payment_records").insert({ job_id: job.id, type: pmType, amount, invoice_number, due_date, status: "paid", paid_date: new Date().toISOString().split("T")[0] });
                logJobActivity(job.id, `Payment received: ${pmType.replace(/_/g, " ")} — $${amount.toLocaleString()}${invoice_number ? ` (${invoice_number})` : ""}`);
                notifyTeam(`Payment received — $${amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
                setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmDue(new Date().toISOString().split("T")[0]);
                setAddingPayment(false);
                if (onReload) onReload();
                if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
              }} style={{ background: T.green, border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>Save</button>
              <button onClick={() => { setAddingPayment(false); setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmDue(new Date().toISOString().split("T")[0]); }} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
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
                      if (ns === "paid") notifyTeam(`Payment received — $${p.amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
                      if (onReload) onReload();
                      if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
                    }} style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 600, border: "none", cursor: "pointer", background: display.bg, color: display.color }}>{rowLabel}</button>
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
      {showPreview && (
        <PdfPreviewModal
          src={`/api/pdf/invoice/${job.id}`}
          title="Invoice Preview"
          downloadHref={`/api/pdf/invoice/${job.id}?download=1`}
          onClose={() => setShowPreview(false)}
        />
      )}

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
        const invoiceLabel = isRevised ? "Revised invoice" : "Invoice";
        return (
          <SendEmailDialog
            type="invoice"
            jobId={job.id}
            contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
            defaultEmail={contacts.find(c => c.role_on_job === "billing")?.email || contacts.find(c => c.role_on_job === "primary")?.email || ""}
            defaultSubject={`${invoiceLabel} — ${job.clients?.name || ""}${job.type_meta?.qb_invoice_number ? ` · Invoice ${job.type_meta.qb_invoice_number}` : ""} · ${job.title}`}
            onClose={() => setShowInvoiceEmail(false)}
            onSent={() => { logJobActivity(job.id, `${invoiceLabel} sent to client`); setShowInvoiceEmail(false); }}
          />
        );
      })()}

      <ConfirmDialog
        open={showSendAnywayConfirm}
        title="No pay link available"
        message="QuickBooks hasn't returned a pay link for this invoice yet. Sending now means the client won't see a 'Pay Online' button in the email or the portal. Click the amber chip to create the link first, or send anyway and the client will still get the PDF and portal link."
        confirmLabel="Send anyway"
        confirmColor={T.amber}
        onConfirm={() => { setShowSendAnywayConfirm(false); setShowInvoiceEmail(true); }}
        onCancel={() => setShowSendAnywayConfirm(false)}
      />
    </div>
  );
}

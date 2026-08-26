"use client";
// Invoice surface — the money gate destination on the job status bar. Thin view
// over lib/job/invoice-actions + invoice-derive; the QB push, PDF, email, and
// payment CRUD all live in the action layer / API routes. Preserves the provider
// fork (Stripe-backed companies → StripePaymentTab). Supersedes PaymentTab.
// Layout follows ~/Desktop/opshub-job-invoice-surface.html. Totals read from QB's
// real numbers (qb_total_with_tax / qb_tax_amount) — no re-derived line math, so
// nothing can drift from what QB bills. Full line detail lives on the PDF.
// See [[jon-clean-architecture-standard]].
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { fmtDay } from "@/lib/dates";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { InvoiceVarianceReviewModal } from "@/components/InvoiceVarianceReviewModal";
import { useIsMobile } from "@/lib/useIsMobile";
import { PdfCanvasPreview } from "@/components/PdfCanvasPreview";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QBCustomerChooser } from "@/components/QBCustomerChooser";
import { StripePaymentTab } from "../StripePaymentTab";
import { deriveInvoice, InvoiceStep } from "@/lib/job/invoice-derive";
import { maybeAutoFinalizeInvoice } from "@/lib/job/auto-finalize";
import { pushInvoiceToQB, refreshPayLink, unlinkQBCustomer, recordPayment, cyclePaymentStatus, deletePayment, patchTypeMeta } from "@/lib/job/invoice-actions";

// Provider fork — Stripe-backed companies (IHM) keep StripePaymentTab; HPD (QB)
// gets the surface below.
export function InvoiceSurface(props: any) {
  const { job } = props;
  const supabase = createClient();
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!job?.company_id) { setProvider("quickbooks"); return; }
      const { data } = await supabase.from("companies").select("default_payment_provider").eq("id", job.company_id).single();
      if (!cancelled) setProvider(data?.default_payment_provider || "quickbooks");
    })();
    return () => { cancelled = true; };
  }, [job?.company_id]);
  if (provider === null) return null;
  if (provider === "stripe") return <StripePaymentTab {...props} />;
  return <InvoiceSurfaceQB {...props} />;
}

const RAIL: { k: InvoiceStep; label: string }[] = [
  { k: "draft", label: "Drafted" },
  { k: "sent", label: "Send" },
  { k: "paid", label: "Paid" },
  { k: "reconcile", label: "Reconcile" },
  { k: "final", label: "Final" },
];

function InvoiceSurfaceQB({ job, items = [], contacts, payments, onReload, onRecalcPhase, onUpdateJob }: any) {
  const isMobile = useIsMobile();
  const s = deriveInvoice(job, items, payments);
  const sb = createClient();

  // Zero-variance reconciles finalize themselves (lib/job/auto-finalize) —
  // amber RECONCILE only survives when a human actually has something to judge.
  useEffect(() => {
    if (s.step !== "reconcile") return;
    let cancelled = false;
    maybeAutoFinalizeInvoice(sb, job.id).then(did => { if (did && !cancelled && onReload) onReload(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.step, job.id]);

  const [showInvoiceEmail, setShowInvoiceEmail] = useState(false);
  const [showReminderEmail, setShowReminderEmail] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [qbError, setQbError] = useState("");
  const [qbInfo, setQbInfo] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserCandidates, setChooserCandidates] = useState<any>(undefined);
  const [chooserCurrent, setChooserCurrent] = useState<any>(undefined);
  const [showVarianceModal, setShowVarianceModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [showSendAnywayConfirm, setShowSendAnywayConfirm] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [pmType, setPmType] = useState("deposit");
  const [pmAmount, setPmAmount] = useState("");
  const [pmInvoice, setPmInvoice] = useState("");
  const [pmPaid, setPmPaid] = useState(new Date().toISOString().split("T")[0]);

  const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" } as React.CSSProperties;
  const fmt = (n: number) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Totals from QB's real numbers when the invoice exists (never re-derived → no drift).
  const netTerms = /^net/.test((job.payment_terms || "").toLowerCase());
  const termsLabel = job.payment_terms ? String(job.payment_terms).replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "—";
  const hasQBTotals = !!job.type_meta?.qb_total_with_tax;
  const tax = Number(job.type_meta?.qb_tax_amount) || 0;
  const total = hasQBTotals ? Number(job.type_meta.qb_total_with_tax) : s.currentSubtotal;
  const subtotal = hasQBTotals ? total - tax : s.currentSubtotal;
  const stateLabel = !s.qbInvoiceNumber ? { t: "Not created", c: T.muted }
    : !s.sentAt ? { t: "Drafted — not sent", c: T.amber }
    : s.isPaid ? { t: "Paid", c: T.green }
    : { t: "Sent — awaiting payment", c: netTerms ? T.blue : T.amber };

  async function doPush(opts: any = {}) {
    setPushing(true); setQbError(""); setQbInfo("");
    try {
      const r = await pushInvoiceToQB(job, opts);
      if (!r.ok) { setChooserCandidates(r.ambiguous); setChooserCurrent(null); setChooserOpen(true); return; }
      const d = r.data;
      if (onUpdateJob) onUpdateJob({ type_meta: { ...(job.type_meta || {}), qb_invoice_id: d.invoiceId || job.type_meta?.qb_invoice_id, qb_invoice_number: d.invoiceNumber || job.type_meta?.qb_invoice_number, qb_payment_link: d.paymentLink || job.type_meta?.qb_payment_link } });
      if (d.healedFrom) setQbInfo(`Re-linked to the active QB customer (the cached one was deleted) and created a fresh invoice #${d.invoiceNumber}.`);
      if (onReload) onReload();
    } catch (e: any) { setQbError(e.message); }
    finally { setPushing(false); }
  }

  async function doRefreshLink() {
    if (refreshing) return;
    setRefreshing(true); setLinkError("");
    try {
      const link = await refreshPayLink(job);
      if (onUpdateJob) onUpdateJob({ type_meta: { ...(job.type_meta || {}), qb_payment_link: link } });
    } catch (e: any) { setLinkError(e.message); }
    finally { setRefreshing(false); }
  }

  async function handleChooserAction(a: any) {
    if (a.type === "select") { setChooserOpen(false); setQbInfo(`Linked to "${a.displayName}". Pushing…`); await doPush({ qbCustomerId: a.qbCustomerId }); return; }
    if (a.type === "create_new") { setChooserOpen(false); await doPush({ forceCreate: true }); return; }
    if (a.type === "unlink") {
      try { await unlinkQBCustomer(job); setChooserCurrent(null); setQbInfo("Cleared the linked QB customer. Next push re-runs the smart match."); }
      catch (e: any) { setQbError(e.message || "Unlink failed"); }
    }
  }

  function handleSendInvoiceClick() { if (!s.qbPaymentLink) { setShowSendAnywayConfirm(true); return; } setShowInvoiceEmail(true); }

  async function savePayment() {
    const parsed = parseFloat(String(pmAmount).replace(/[^0-9.\-]/g, ""));
    const amount = Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
    if (!Number.isFinite(amount)) return;
    await recordPayment(job, { type: pmType, amount, invoice_number: pmInvoice.trim() || null, paid_date: pmPaid || new Date().toISOString().split("T")[0] });
    setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmPaid(new Date().toISOString().split("T")[0]);
    setAddingPayment(false);
    if (onReload) onReload();
    if (onRecalcPhase) setTimeout(onRecalcPhase, 500);
  }

  const cardStyle = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "15px 17px" } as React.CSSProperties;
  const ctLabel = { fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.faint } as React.CSSProperties;
  const kv = (k: string, v: React.ReactNode, vc?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, padding: "3px 0" }}>
      <span style={{ color: T.muted }}>{k}</span><span style={{ fontWeight: 700, color: vc || T.text }}>{v}</span>
    </div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1000, margin: "0 auto" }}>

      {/* State rail */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
        {RAIL.map((r, i) => {
          const curIdx = RAIL.findIndex(x => x.k === s.step);
          const done = i < curIdx, active = r.k === s.step;
          const bg = active ? (r.k === "reconcile" ? T.amberDim : r.k === "final" ? T.greenDim : T.accent) : done ? T.greenDim : T.surface;
          const fg = active ? (r.k === "reconcile" ? T.amber : r.k === "final" ? T.green : "#0a0a0a") : done ? T.green : T.faint;
          return (
            <span key={r.k} style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", padding: "6px 12px", borderRadius: 8, background: bg, color: fg }}>{r.label}</span>
              {i < RAIL.length - 1 && <span style={{ color: T.faint, padding: "0 6px" }}>→</span>}
            </span>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 14, alignItems: "start" }}>

        {/* ── LEFT: the invoice ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={cardStyle}>
            <div style={{ ...ctLabel, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span>This invoice</span>
              {s.qbInvoiceNumber && <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: T.blueDim, color: T.blue }}>QB #{s.qbInvoiceNumber}</span>}
            </div>
            {kv("State", stateLabel.t, stateLabel.c)}
            {kv("Terms", termsLabel, netTerms ? T.blue : undefined)}
            {kv("Due", s.sentAt ? "on invoice terms" : "— starts on send date")}

            {/* Totals — QB's real numbers */}
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
              {kv("Subtotal", <span style={{ fontFamily: mono }}>{fmt(subtotal)}</span>)}
              {kv("Tax (QB)", <span style={{ fontFamily: mono }}>{hasQBTotals ? fmt(tax) : "—"}</span>)}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, paddingTop: 8, marginTop: 4, borderTop: `2px solid ${T.border}` }}>
                <span>Total</span><span style={{ fontFamily: mono }}>{fmt(total)}</span>
              </div>
              <div style={{ fontSize: 10, color: T.faint, marginTop: 6 }}>Full line detail on the invoice PDF.</div>
            </div>

            {/* Additional charges echo */}
            {s.extraLines.length > 0 && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
                <div style={{ ...ctLabel, marginBottom: 6 }}>Additional charges</div>
                {s.extraLines.map((l: any, i: number) => (
                  <div key={l.id || i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: T.text, padding: "2px 0" }}>
                    <span>{l.description || "Additional charge"}{l.qb_item ? <span style={{ color: T.faint, marginLeft: 6 }}>· {l.qb_item}</span> : null}</span>
                    <span style={{ fontFamily: mono }}>{fmt(l.amount)}</span>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>Edit on Quote + Proofs.</div>
              </div>
            )}

            {/* Invoice # + QB customer + date override */}
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ ...ctLabel }}>Invoice #</label>
                <input type="text" value={job.type_meta?.qb_invoice_number || ""}
                  onChange={e => { if (onUpdateJob) onUpdateJob({ type_meta: { ...(job.type_meta || {}), qb_invoice_number: e.target.value || null } }); }}
                  onBlur={async e => { const num = e.target.value.trim(); await patchTypeMeta(job, { qb_invoice_number: num || null }, { logMsg: num ? `Invoice number manually set to #${num}` : undefined }); }}
                  placeholder="—" style={{ width: 78, padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.card, color: T.text, fontSize: 12, fontFamily: mono, fontWeight: 600, textAlign: "center", outline: "none" }} />
                <button type="button" onClick={() => { setChooserCandidates(undefined); setChooserCurrent(undefined); setChooserOpen(true); }} disabled={pushing}
                  title="Verify or change the linked QuickBooks customer"
                  style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontSize: 10, fontWeight: 600, padding: "4px 8px", cursor: pushing ? "default" : "pointer", fontFamily: font }}>QB customer</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                <span style={{ ...ctLabel }}>PDF date</span>
                <input type="date" value={job.type_meta?.invoice_date_override || ""}
                  onChange={async (e) => { const next = await patchTypeMeta(job, { invoice_date_override: e.target.value || null }); if (onUpdateJob) onUpdateJob({ type_meta: next }); }}
                  title="Override the date on the OpsHub invoice PDF. Blank uses the send date."
                  style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, padding: "4px 8px", fontFamily: font, outline: "none", cursor: "pointer" }} />
              </div>
            </div>

            {/* Pay link chip */}
            {s.qbInvoiceId && (() => {
              const working = refreshing, hasLink = !!s.qbPaymentLink, failed = !hasLink && !!linkError;
              const bg = working ? T.surface : hasLink ? T.greenDim : failed ? T.redDim : T.amberDim;
              const fg = working ? T.muted : hasLink ? T.green : failed ? T.red : T.amber;
              const bc = working ? T.border : hasLink ? `${T.green}66` : failed ? `${T.red}66` : `${T.amber}66`;
              const label = working ? "Working…" : hasLink ? "Pay link" : failed ? "Pay link failed" : "No pay link";
              return (
                <div style={{ marginTop: 10, display: "flex", alignItems: "stretch", borderRadius: 6, overflow: "hidden", border: `1px solid ${bc}`, width: "fit-content" }}>
                  <button onClick={doRefreshLink} disabled={working} title={failed ? linkError : (hasLink ? "Click to refresh" : "Click to create")}
                    style={{ background: bg, color: fg, border: "none", padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: font, cursor: working ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                    <span>{hasLink ? "✓" : failed ? "✕" : working ? "…" : "○"}</span><span>{label}</span>
                  </button>
                  {hasLink && !working && <a href={s.qbPaymentLink!} target="_blank" rel="noopener noreferrer" title="Open pay link" style={{ background: bg, color: fg, borderLeft: `1px solid ${bc}`, padding: "0 9px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", textDecoration: "none" }}>→</a>}
                </div>
              );
            })()}
            {linkError && s.qbInvoiceId && !s.qbPaymentLink && <div style={{ marginTop: 6, fontSize: 10, color: T.red, lineHeight: 1.4 }}>{linkError}</div>}
            {qbError && <div style={{ marginTop: 8, fontSize: 12, color: T.red, background: T.redDim, padding: "8px 10px", borderRadius: 6 }}>{qbError}</div>}
            {qbInfo && !qbError && <div style={{ marginTop: 8, fontSize: 12, color: T.green, background: T.greenDim, padding: "8px 10px", borderRadius: 6 }}>{qbInfo}</div>}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
              <button onClick={() => doPush()} disabled={pushing || s.isManualInvoice}
                style={{ flex: "1 1 auto", height: 38, borderRadius: 9,
                  border: s.invoiceStale ? `1.5px solid ${T.red}` : s.qbInvoiceNumber ? `1.5px solid ${T.green}` : "none",
                  cursor: pushing || s.isManualInvoice ? "default" : "pointer",
                  background: s.invoiceStale ? T.redDim : s.qbInvoiceNumber ? T.greenDim : T.blue,
                  color: s.invoiceStale ? T.red : s.qbInvoiceNumber ? T.green : "#fff",
                  fontSize: 12.5, fontWeight: 800, fontFamily: font, opacity: pushing ? 0.6 : 1, padding: "0 14px" }}
                title={s.invoiceStale ? "Pricing changed — click to update QB" : s.qbInvoiceNumber ? "Re-sync / update QB" : "Push invoice to QuickBooks"}>
                {pushing ? (s.qbInvoiceNumber ? "Updating…" : "Creating…")
                  : s.isManualInvoice ? `✓ QB #${s.qbInvoiceNumber}`
                  : s.invoiceStale ? `⚠ Update QB #${s.qbInvoiceNumber}`
                  : s.qbInvoiceNumber ? `✓ QB #${s.qbInvoiceNumber} · re-sync` : "Create QB Invoice"}
              </button>
              <button onClick={handleSendInvoiceClick} disabled={!s.qbInvoiceNumber}
                style={{ flex: "0 0 auto", height: 38, borderRadius: 9, border: "none", cursor: !s.qbInvoiceNumber ? "default" : "pointer",
                  background: !s.qbInvoiceNumber ? T.surface : T.accent, color: !s.qbInvoiceNumber ? T.faint : "#0a0a0a",
                  fontSize: 12.5, fontWeight: 800, fontFamily: font, opacity: !s.qbInvoiceNumber ? 0.4 : 1, padding: "0 16px" }}>Send invoice</button>
              <button onClick={() => window.open(`/api/pdf/invoice/${job.id}?download=1`, "_blank")}
                style={{ flex: "0 0 auto", height: 38, borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.text, cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: font, padding: "0 14px" }}>Download PDF</button>
              <button onClick={() => window.open(`/portal/${job.portal_token || ""}`, "_blank")}
                style={{ flex: "0 0 auto", height: 38, borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.text, cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: font, padding: "0 14px" }}>Preview in portal</button>
            </div>
          </div>

          {/* Net-vs-prepaid path note */}
          <div style={{ background: netTerms ? T.blueDim : T.amberDim, borderRadius: 10, padding: "11px 14px", fontSize: 11.5, lineHeight: 1.5, color: T.text }}>
            {netTerms
              ? <>This client is <b style={{ color: T.blue }}>{termsLabel}</b>: produce → <b>reconcile the shortage</b> against shipped qtys → total trues up → <b>send</b> → the clock starts on the send date. The invoice never goes out wrong.</>
              : <>This client is <b style={{ color: T.amber }}>{termsLabel}</b>: <b>send</b> the invoice → collect → produce → <b>reconcile after ship</b> → QB <b>credit memo</b> for any shortage on their next order (or refund).</>}
          </div>
        </div>

        {/* ── RIGHT: reconcile + payments ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Reconcile card */}
          <div style={{ ...cardStyle, ...(s.isFullyShipped && !s.variancePushedAt ? { borderLeft: `4px solid ${T.amber}`, paddingLeft: 13 } : {}) }}>
            <div style={{ ...ctLabel, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span>Reconcile</span>
              {s.variancePushedAt ? <span style={{ color: T.green }}>✓ finalized</span>
                : s.isFullyShipped ? <span style={{ color: T.amber }}>⚠ needs you</span>
                : <span style={{ color: T.faint }}>after ship</span>}
            </div>
            {s.variancePushedAt ? (
              <>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>{(job.type_meta as any)?.invoice_variance_auto ? "Finalized automatically — delivered matched the invoice exactly" : `Invoice finalized with ${s.isShipThrough ? "received" : "shipped"} qtys`} · {new Date(s.variancePushedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</div>
                <button onClick={() => setShowVarianceModal(true)} style={{ borderRadius: 8, border: `1px solid ${T.green}`, background: "transparent", color: T.green, fontSize: 11, fontWeight: 700, padding: "7px 13px", cursor: "pointer", fontFamily: font }}>Re-review</button>
              </>
            ) : s.isFullyShipped ? (
              <>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>Job shipped — bill the <b>actual {s.isShipThrough ? "received" : "shipped"}</b> qtys, not the ordered qtys. Confirm the numbers; it won't self-adjust.</div>
                <button onClick={() => setShowVarianceModal(true)} style={{ borderRadius: 8, border: "none", background: T.amber, color: "#fff", fontSize: 12, fontWeight: 800, padding: "9px 15px", cursor: "pointer", fontFamily: font }}>Review variance &amp; finalize</button>
              </>
            ) : (
              <div style={{ fontSize: 12, color: T.muted }}>Once the job ships, reconcile here to bill the actual shipped qtys. Auto-flags any shortage.</div>
            )}
          </div>

          {/* Payments card */}
          <div style={cardStyle}>
            <div style={{ ...ctLabel, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span>Payments</span>
              <span style={{ color: s.isPaid ? T.green : s.aggIsPartial ? T.amber : T.muted, fontFamily: mono, fontSize: 10 }}>{fmt(s.aggPaidSum)} / {fmt(s.aggInvoiceTotal)}</span>
            </div>

            {(s.aggInvoiceTotal > 0.01 || s.aggPaidSum > 0.01) && (
              <div style={{ fontSize: 13, fontWeight: 800, color: s.isPaid ? T.green : s.aggIsPartial ? T.amber : T.muted, marginBottom: 8 }}>
                {s.isPaid ? "Paid" : s.aggIsPartial ? "Partial Paid" : "Unpaid"}
                {s.aggIsPartial && <span style={{ fontSize: 11, fontWeight: 600, color: T.muted }}> · {fmt(s.aggBalance)} outstanding</span>}
              </div>
            )}

            {payments.length === 0 && !addingPayment && <p style={{ fontSize: 12, color: T.muted, margin: "0 0 8px" }}>No payments recorded yet.</p>}
            {payments.length > 0 && payments.map((p: any) => {
              const statusStyle: any = { pending: { bg: T.amberDim, color: T.amber }, paid: { bg: T.greenDim, color: T.green }, void: { bg: T.redDim, color: T.red } };
              const isRowPartial = p.status === "paid" && s.aggIsPartial;
              const display = isRowPartial ? { color: T.amber } : (statusStyle[p.status] || statusStyle.pending);
              const rowLabel = isRowPartial ? "partial paid" : p.status;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ textTransform: "capitalize", fontWeight: 600 }}>{p.type.replace(/_/g, " ")} <span style={{ fontFamily: mono, fontWeight: 700 }}>${p.amount.toLocaleString()}</span></div>
                    <div style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{p.invoice_number || "—"}{p.due_date ? ` · due ${fmtDay(p.due_date)}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={async () => { await cyclePaymentStatus(job, p); if (onReload) onReload(); if (onRecalcPhase) setTimeout(onRecalcPhase, 500); }}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 10, fontWeight: 800, color: display.color, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: font }}>{rowLabel}</button>
                    <button onClick={async () => { await deletePayment(p.id); if (onReload) onReload(); if (onRecalcPhase) setTimeout(onRecalcPhase, 500); }}
                      style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 12 }}
                      onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
                  </div>
                </div>
              );
            })}

            {addingPayment && (
              <div style={{ background: T.surface, border: `1px solid ${T.accent}44`, borderRadius: 8, padding: 10, margin: "10px 0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                  <select value={pmType} onChange={e => setPmType(e.target.value)} style={ic}>
                    <option value="deposit">Deposit</option><option value="balance">Balance</option><option value="full_payment">Full Payment</option><option value="refund">Refund</option>
                  </select>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: T.faint, fontFamily: mono, pointerEvents: "none" }}>$</span>
                    <input type="text" inputMode="decimal" placeholder="0.00" value={pmAmount} onChange={e => setPmAmount(e.target.value)} style={{ ...ic, paddingLeft: 22, fontFamily: mono }} />
                  </div>
                  <input placeholder="Invoice #" value={pmInvoice} onChange={e => setPmInvoice(e.target.value)} style={ic} />
                  <input type="date" value={pmPaid} onChange={e => setPmPaid(e.target.value)} title="Paid date" style={ic} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={savePayment} style={{ background: T.green, border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>Save</button>
                  <button onClick={() => { setAddingPayment(false); setPmType("deposit"); setPmAmount(""); setPmInvoice(""); setPmPaid(new Date().toISOString().split("T")[0]); }} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setAddingPayment(!addingPayment)} style={{ background: T.accent, border: "none", borderRadius: 8, color: "#0a0a0a", fontSize: 12, fontWeight: 700, padding: "8px 14px", cursor: "pointer" }}>Record payment</button>
              {s.sentAt && <button onClick={() => setShowReminderEmail(true)} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12, fontWeight: 700, padding: "8px 14px", cursor: "pointer", fontFamily: font }}>Send reminder</button>}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showVarianceModal && (
        <InvoiceVarianceReviewModal jobId={job.id} shippingRoute={job.shipping_route} jobTitle={job.title} clientName={job.clients?.name || ""}
          onClose={() => setShowVarianceModal(false)}
          onApproved={() => { logJobActivity(job.id, "QB invoice updated with actual qtys — revised invoice emailed to client"); if (onReload) onReload(); }} />
      )}

      {showInvoiceEmail && (() => {
        const isRevised = !!s.sentAt;
        const invoiceLabel = isRevised ? "Revised Invoice" : "Invoice";
        const refNum = s.qbInvoiceNumber || job.job_number || "";
        return (
          <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 100, display: "flex", flexDirection: "column", fontFamily: font }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Send {invoiceLabel}{refNum ? ` · #${refNum}` : ""}</span>
                <span style={{ fontSize: 11, color: T.muted }}>{job.clients?.name || job.title || ""}</span>
              </div>
              <button onClick={() => setShowInvoiceEmail(false)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden", minHeight: 0 }}>
              <div style={{ width: isMobile ? "auto" : 380, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: isMobile ? "none" : `1px solid ${T.border}`, borderBottom: isMobile ? `1px solid ${T.border}` : "none" }}>
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
                  <SendEmailDialog type="invoice" jobId={job.id} vendor={undefined} customBody={undefined} extraPayload={undefined} contacts={contacts.map((c: any) => ({ name: c.name, email: c.email || "" }))}
                    defaultEmail={contacts.find((c: any) => c.role_on_job === "billing")?.email || contacts.find((c: any) => c.role_on_job === "primary")?.email || ""}
                    defaultSubject={[`${invoiceLabel}${refNum ? ` ${refNum}` : ""}`, job.clients?.name, job.title].filter(Boolean).join(" · ").trim()}
                    onClose={() => setShowInvoiceEmail(false)}
                    onSent={() => { logJobActivity(job.id, `${invoiceLabel} sent to client`); setShowInvoiceEmail(false); }} />
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
        <SendEmailDialog type="reminder" jobId={job.id} vendor={undefined} customBody={undefined} extraPayload={undefined} contacts={contacts.map((c: any) => ({ name: c.name, email: c.email || "" }))}
          defaultEmail={contacts.find((c: any) => c.role_on_job === "billing")?.email || contacts.find((c: any) => c.role_on_job === "primary")?.email || ""}
          defaultSubject={[`Invoice reminder${s.qbInvoiceNumber ? ` · ${s.qbInvoiceNumber}` : ""} — ${job.clients?.name || ""}`, job.title].filter(Boolean).join(" · ")}
          onClose={() => setShowReminderEmail(false)}
          onSent={() => { logJobActivity(job.id, "Invoice reminder sent to client"); setShowReminderEmail(false); }} />
      )}

      <ConfirmDialog open={showSendAnywayConfirm} title="No pay link available"
        message="QuickBooks hasn't returned a pay link for this invoice yet. Sending now means the client won't see a 'Pay Online' button. Click the amber chip to create the link first, or send anyway and the client still gets the PDF and portal link."
        confirmLabel="Send anyway" confirmColor={T.amber}
        onConfirm={() => { setShowSendAnywayConfirm(false); setShowInvoiceEmail(true); }} onCancel={() => setShowSendAnywayConfirm(false)} />

      <QBCustomerChooser open={chooserOpen} mode="push" clientId={job.client_id} searchedName={job.clients?.name || ""}
        candidates={chooserCandidates} current={chooserCurrent} busy={pushing} onAction={handleChooserAction} onClose={() => setChooserOpen(false)} />
    </div>
  );
}

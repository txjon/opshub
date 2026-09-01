"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { groupLineItems } from "@/lib/shipstation-group";
import { QBCustomerChooser, type QBCandidate, type QBCurrent } from "@/components/QBCustomerChooser";
import { useConfirm } from "@/components/useConfirm";

const fmtD = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");
// Strip any time component off ship_date. ShipStation exports usually
// include "H:MM AM/PM" or an ISO T-separated time we don't want shown.
function dateOnly(raw: string): string {
  if (!raw) return "";
  return raw.trim().split(/[\sT]/)[0];
}

type SalesLineItem = { sku: string; description: string; qty_sold: number; product_sales: number; unit_cost: number };
type PostageLineItem = {
  ship_date: string;
  recipient: string;
  order_number: string;
  provider: string;
  service: string;
  package_type: string;
  items_count: number;
  zone: string;
  shipping_paid: number;
  shipping_cost_raw: number;
  shipping_cost: number;
  insurance_cost: number;
  weight: number;
  weight_unit: string;
  billed: number;
};
type SalesTotals = { qty: number; sales: number; cost: number; net: number; fee: number; profit: number };
// fulfillment + invoice_total are added in v2 (per-package fulfillment fee).
// Older reports won't have them; readers default to 0 / sum on demand.
type PostageTotals = { shipments: number; items: number; paid: number; cost_raw: number; cost: number; insurance: number; billed: number; margin: number; fulfillment?: number; invoice_total?: number };

type ReportType = "sales" | "postage" | "combined" | "fulfillment";
type BulkLine = { transaction_date: string; amount: number; billed: number };
type Report = {
  id: string;
  client_id: string;
  report_type: ReportType;
  // "per_shipment" (default) or "bulk" pass-through reimbursement. Only
  // meaningful when the report has a postage half.
  postage_mode: "per_shipment" | "bulk" | null;
  period_label: string;
  // Per-half period overrides (combined). Null → inherit period_label.
  sales_period_label: string | null;
  postage_period_label: string | null;
  hpd_fee_pct: number;
  per_package_fee: number | null;
  line_items: any[];
  totals: any;
  // Combined ("Full Service") reports keep the sales side in
  // line_items/totals/hpd_fee_pct and the postage side here.
  postage_line_items: any[] | null;
  postage_totals: any;
  postage_markup_pct: number | null;
  created_at: string;
  clients: { name: string } | null;
  qb_invoice_id: string | null;
  qb_invoice_number: string | null;
  qb_payment_link: string | null;
  qb_tax_amount: number | null;
  qb_total_with_tax: number | null;
  qb_invoice_updated_at: string | null;
  sent_at: string | null;
  sent_to: string[] | null;
  paid_at: string | null;
  paid_amount: number | null;
};

type Contact = { email: string | null; name: string | null; role_label: string | null; is_primary: boolean };

export default function ShipstationReportDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showManualQb, setShowManualQb] = useState(false);

  const [qbBusy, setQbBusy] = useState(false);
  const [qbMsg, setQbMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // QB customer chooser — opens when push returns 409 with candidates,
  // and from the explicit "QB customer · change" link in the header.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserCandidates, setChooserCandidates] = useState<QBCandidate[] | undefined>(undefined);
  const [chooserCurrent, setChooserCurrent] = useState<QBCurrent | undefined>(undefined);

  const [sendOpen, setSendOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [toEmail, setToEmail] = useState("");
  const [ccEmails, setCcEmails] = useState("");
  const [subject, setSubject] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("shipstation_reports")
      .select("*, clients(name)")
      .eq("id", params.id)
      .single();
    if (!error && data) setReport(data as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, [params.id]);

  // Precompute reportType + what "billed" means so all surfaces agree.
  // Combined = sales fee + postage billed + fulfillment.
  // Postage = billed + fulfillment.
  // Sales = fee.
  // Older reports don't have totals.fulfillment — fall back to 0.
  const isPostage = report?.report_type === "postage";
  const isCombined = report?.report_type === "combined";
  // Fulfillment-only: client pays their own postage, we bill just the
  // per-package fee. Renders through the postage strip/table in a stripped
  // mode (no cost/insurance/billed columns); invoice total = fulfillment.
  const isFulfillment = report?.report_type === "fulfillment";
  // Bulk postage pass-through — applies to either postage-only or combined.
  // The dollar math is unchanged (billed already = the reimbursement total,
  // fulfillment = 0), so only the rendering differs.
  const isBulkPostage = (isPostage || isCombined) && report?.postage_mode === "bulk";
  const billedAmount = useMemo(() => {
    if (!report) return 0;
    if (isCombined) {
      const fee = Number(report.totals?.fee) || 0;
      const postage = Number(report.postage_totals?.billed) || 0;
      const fulfillment = Number(report.postage_totals?.fulfillment) || 0;
      return fee + postage + fulfillment;
    }
    if (isPostage) {
      const postage = Number(report.totals?.billed) || 0;
      const fulfillment = Number(report.totals?.fulfillment) || 0;
      return postage + fulfillment;
    }
    if (isFulfillment) {
      return Number(report.totals?.fulfillment) || 0;
    }
    return Number(report.totals?.fee) || 0;
  }, [report, isPostage, isCombined, isFulfillment]);
  const reportKindLabel = isCombined ? "Full Service Invoice" : isPostage ? "Postage Invoice" : isFulfillment ? "Fulfillment Invoice" : "Services Invoice";

  // Out-of-sync detection (Sep 1: Jon edited the fee and nothing warned).
  // Compare this page's computed total against QB's PRE-TAX subtotal
  // (total_with_tax − tax_amount) so a taxed invoice never false-alarms.
  const qbSubtotal = report?.qb_total_with_tax != null
    ? Number(report.qb_total_with_tax) - (Number(report.qb_tax_amount) || 0)
    : null;
  const qbStale = !!report?.qb_invoice_id && qbSubtotal != null && Math.abs(billedAmount - qbSubtotal) > 0.01;

  useEffect(() => {
    if (!sendOpen || !report) return;
    (async () => {
      const { data } = await supabase
        .from("contacts")
        .select("email, name, role_label, is_primary")
        .eq("client_id", report.client_id);
      const list = (data || []) as Contact[];
      setContacts(list);
      if (!toEmail) {
        const primary = list.find(c => c.is_primary)?.email;
        const any = list.find(c => c.email)?.email;
        setToEmail(primary || any || "");
      }
      if (!subject) {
        const n = report.qb_invoice_number;
        const kind = isCombined ? "Full Service Invoice" : isPostage ? "Postage Invoice" : isFulfillment ? "Fulfillment Invoice" : "Services Invoice";
        setSubject(`${kind} — ${report.clients?.name || ""} · ${report.period_label}${n ? ` · Invoice ${n}` : ""}`);
      }
    })();
  }, [sendOpen, report, isPostage]);

  async function togglePaid() {
    if (!report) return;
    const markingPaid = !report.paid_at;
    const patch = markingPaid
      ? { paid_at: new Date().toISOString(), paid_amount: billedAmount }
      : { paid_at: null, paid_amount: null };
    await supabase.from("shipstation_reports").update(patch).eq("id", params.id);
    await load();
  }

  async function onDelete() {
    const pushed = !!report?.qb_invoice_id;
    const ok = await confirm({
      title: "Delete this invoice?",
      message: pushed
        ? "Removes it from OpsHub permanently. The invoice already created in QuickBooks stays there — void it in QB separately if it shouldn't be billed."
        : "Removes it from OpsHub permanently. This can't be undone.",
      confirmLabel: "Delete invoice",
    });
    if (!ok) return;
    setDeleting(true);
    await supabase.from("shipstation_reports").delete().eq("id", params.id);
    router.push("/invoices?stream=fulfillment");
  }

  async function pushToQB(opts: { qbCustomerId?: string; forceCreate?: boolean } = {}) {
    setQbBusy(true); setQbMsg(null);
    try {
      const body: any = { reportId: params.id };
      if (opts.qbCustomerId) body.qbCustomerId = opts.qbCustomerId;
      if (opts.forceCreate) body.forceCreate = true;
      const res = await fetch("/api/qb/shipstation-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409 && data?.error === "ambiguous_customer") {
        // Open the chooser instead of creating a duplicate. Caller picks
        // the right QB customer (or explicitly "Create new"); we retry
        // pushToQB with the chosen path.
        setChooserCandidates(data.candidates || []);
        setChooserCurrent(null);
        setChooserOpen(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Push failed");
      const healedNote = data.healedFrom ? " (re-linked — previous QB customer was deleted)" : "";
      const baseMsg = data.updated ? `Invoice #${data.invoiceNumber} updated in QuickBooks.` : `Invoice #${data.invoiceNumber} created in QuickBooks.`;
      setQbMsg({ ok: true, text: baseMsg + healedNote });
      await load();
    } catch (e: any) {
      setQbMsg({ ok: false, text: e.message || "Push failed" });
    } finally {
      setQbBusy(false);
    }
  }

  async function openChooserManual() {
    // "Change QB customer" entry point — chooser fetches current + candidates.
    setChooserCandidates(undefined);
    setChooserCurrent(undefined);
    setChooserOpen(true);
  }

  async function handleChooserAction(a: { type: "select"; qbCustomerId: string; displayName: string } | { type: "create_new" } | { type: "unlink" }) {
    if (!report) return;
    if (a.type === "select") {
      setChooserOpen(false);
      setQbMsg({ ok: true, text: `Linked to QuickBooks customer "${a.displayName}". Pushing…` });
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
          body: JSON.stringify({ clientId: report.client_id, qbCustomerId: null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Unlink failed");
        setChooserCurrent(null);
        setQbMsg({ ok: true, text: "Cleared the linked QB customer. Next push will re-run the smart match." });
      } catch (e: any) {
        setQbMsg({ ok: false, text: e.message || "Unlink failed" });
      }
    }
  }

  async function sendEmail() {
    setSendBusy(true); setSendMsg(null);
    try {
      const cc = ccEmails.split(",").map(s => s.trim()).filter(Boolean);
      const res = await fetch("/api/email/shipstation-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: params.id,
          recipientEmail: toEmail.trim(),
          ccEmails: cc,
          subject: subject.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSendMsg({ ok: true, text: `Sent to ${toEmail}${cc.length ? ` (+ ${cc.length} cc)` : ""}` });
      await load();
      setTimeout(() => setSendOpen(false), 1200);
    } catch (e: any) {
      setSendMsg({ ok: false, text: e.message || "Send failed" });
    } finally {
      setSendBusy(false);
    }
  }

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;
  if (!report) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Report not found.</div>;

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const btnPrimary: React.CSSProperties = { background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const btnGhost: React.CSSProperties = { background: T.surface, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const btnGreen: React.CSSProperties = { background: T.green, color: "#0a0e1a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const input: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box", width: "100%" };
  const menuItem: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: T.text, fontSize: 12.5, fontWeight: 600, padding: "8px 12px", cursor: "pointer", borderRadius: 6, fontFamily: font, textDecoration: "none" };

  const created = new Date(report.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  // Per-half periods. Only worth showing on the section when combined and
  // the half differs from the invoice period (single-type already shows the
  // period in the page header).
  const salesPeriod = report.sales_period_label || report.period_label;
  const postagePeriod = report.postage_period_label || report.period_label;
  const salesSectionPeriod = isCombined && salesPeriod !== report.period_label ? salesPeriod : undefined;
  const postageSectionPeriod = isCombined && postagePeriod !== report.period_label ? postagePeriod : undefined;
  const hasQB = !!report.qb_invoice_id;
  const isManualInvoice = !!report.qb_invoice_number && !report.qb_invoice_id;
  const sentDate = report.sent_at ? new Date(report.sent_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            <a href="/invoices?stream=fulfillment" style={{ color: T.muted, textDecoration: "none" }}>← Invoices</a> · Fulfillment
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            {reportKindLabel} — {report.clients?.name || "—"}
          </h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {report.period_label} · Generated {created}
          </div>
        </div>
        {/* ONE primary action, driven by the rail state (push → send); Edit
            stays a first-class ghost; everything else demotes to ⋯. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
          <a href={`/invoices/fulfillment/new?edit=${report.id}`} style={btnGhost}>Edit</a>
          {!hasQB && !isManualInvoice && (
            <button onClick={() => pushToQB()} disabled={qbBusy} style={{ ...btnPrimary, opacity: qbBusy ? 0.6 : 1 }}>{qbBusy ? "Pushing…" : "Push to QuickBooks"}</button>
          )}
          {(hasQB || isManualInvoice) && !report.sent_at && (
            <button onClick={() => setSendOpen(true)} style={btnGreen}>Send to client</button>
          )}
          <button onClick={() => setMenuOpen(v => !v)} aria-label="More actions"
            style={{ ...btnGhost, fontSize: 16, lineHeight: 1, padding: "8px 13px" }}>⋯</button>
          {menuOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 6, minWidth: 225, boxShadow: "0 8px 30px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column" }}>
              <a href={`/api/pdf/shipstation/${report.id}`} target="_blank" rel="noopener noreferrer" style={menuItem} onClick={() => setMenuOpen(false)}>Preview PDF</a>
              <a href={`/api/pdf/shipstation/${report.id}?download=1`} style={menuItem} onClick={() => setMenuOpen(false)}>Download PDF</a>
              {(isPostage || isCombined || isFulfillment) && (
                <a href={`/api/excel/shipstation/${report.id}`} style={menuItem} onClick={() => setMenuOpen(false)}>Download Excel</a>
              )}
              {(hasQB || isManualInvoice) && report.sent_at && (
                <button onClick={() => { setSendOpen(true); setMenuOpen(false); }} style={menuItem}>Re-send to client</button>
              )}
              {hasQB && (
                <button disabled={qbBusy} onClick={() => { setMenuOpen(false); pushToQB(); }} style={menuItem}>
                  {qbBusy ? "Updating…" : "Update QB invoice"}
                </button>
              )}
              <button disabled={qbBusy} onClick={() => { setMenuOpen(false); openChooserManual(); }} style={menuItem}
                title="Verify or change which QuickBooks customer this client is linked to">QB customer…</button>
              {!hasQB && !isManualInvoice && (
                <button onClick={() => { setShowManualQb(true); setMenuOpen(false); }} style={menuItem}>Link existing QB invoice #</button>
              )}
              <button disabled={deleting} onClick={() => { setMenuOpen(false); onDelete(); }} style={{ ...menuItem, color: T.red }}>Delete invoice</button>
            </div>
          )}
        </div>
      </div>

      {/* State rail — same pattern as the job Invoice surface. Teaches the
          sequence: generate → get it into QB → send → collect. */}
      <StateRail
        inQB={hasQB || isManualInvoice}
        sent={!!report.sent_at}
        paid={!!report.paid_at}
        onManualQb={!hasQB && !isManualInvoice && !showManualQb ? () => setShowManualQb(true) : undefined}
      />

      {/* Manual QB # — an edge case, so it hides until asked for (via the
          rail hint or ⋯), or when a manual number is already linked. */}
      {!hasQB && (showManualQb || isManualInvoice) && (
        <ManualInvoiceInput
          reportId={report.id}
          initial={report.qb_invoice_number}
          onSaved={load}
        />
      )}

      {/* Push/QB feedback — a quiet text line, never a full-width wash; the
          rail + fact row changing state is the real confirmation. */}
      {qbMsg && (
        <div style={{ fontSize: 12, fontWeight: 700, color: qbMsg.ok ? T.green : T.red }}>{qbMsg.text}</div>
      )}

      {/* The QB fact row — one slim line: identity, amount, payment state,
          links. (Was a sparse 5-column card that repeated the rail.) */}
      {(hasQB || isManualInvoice) && (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", padding: "12px 16px" }}>
          <span style={{ fontFamily: mono, fontWeight: 800, fontSize: 15, color: T.accent }}>#{report.qb_invoice_number}</span>
          {isManualInvoice && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.faint }}>Manual</span>}
          <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 15 }}>{fmtD(Number(report.qb_total_with_tax ?? billedAmount))}</span>
          {report.paid_at ? (
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>Paid</span>
              <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{new Date(report.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {fmtD(Number(report.paid_amount) || 0)}</span>
              <button onClick={togglePaid} style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, cursor: "pointer", fontFamily: font, textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}>mark unpaid</button>
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.amber }}>Unpaid</span>
              <button onClick={togglePaid} style={{ background: "none", border: `1px solid ${T.green}55`, color: T.green, fontSize: 11, cursor: "pointer", padding: "4px 10px", borderRadius: 5, fontFamily: font, fontWeight: 700 }}>Mark paid</button>
            </span>
          )}
          {report.qb_payment_link && (
            <a href={report.qb_payment_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.blue, fontWeight: 700, textDecoration: "none" }}>Payment page ↗</a>
          )}
          {sentDate && (
            <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted }}>
              <span style={{ color: T.green, fontWeight: 700 }}>✓ sent</span> {sentDate}{report.sent_to && report.sent_to.length > 0 ? ` · ${report.sent_to.join(", ")}` : ""}
            </span>
          )}
        </div>
      )}

      {/* QB drift — this page's total no longer matches what's in QB. */}
      {qbStale && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, color: T.amber, fontWeight: 600 }}>
          <span>Out of sync with QuickBooks — this invoice now totals {fmtD(billedAmount)}, but QB #{report.qb_invoice_number} still has {fmtD(qbSubtotal!)}.</span>
          <button onClick={() => pushToQB()} disabled={qbBusy}
            style={{ background: "none", border: `1px solid ${T.amber}66`, color: T.amber, fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 5, cursor: "pointer", fontFamily: font, opacity: qbBusy ? 0.6 : 1 }}>
            {qbBusy ? "Updating…" : "Update QB invoice"}
          </button>
          {report.sent_at && <span style={{ color: T.muted, fontWeight: 400 }}>The client already got the old total — re-send after updating.</span>}
        </div>
      )}

      {/* Send modal — DESIGN.md modal anatomy (eyebrow → title → summary
          strip → body → footer). Was an inline card wedged mid-page. */}
      {sendOpen && (hasQB || isManualInvoice) && (
        <div onClick={() => !sendBusy && setSendOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "9vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 22, width: "100%", maxWidth: 560, fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{reportKindLabel} · {report.clients?.name || ""}</div>
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <div style={{ fontSize: 16.5, fontWeight: 800 }}>Send to client</div>
                <button onClick={() => setSendOpen(false)} disabled={sendBusy} style={{ marginLeft: "auto", background: "none", border: "none", color: T.faint, fontSize: 18, cursor: "pointer" }}>✕</button>
              </div>
            </div>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 13px", display: "flex", alignItems: "baseline", gap: 14, fontSize: 12.5 }}>
              <span style={{ fontFamily: mono, fontWeight: 800, color: T.accent }}>#{report.qb_invoice_number}</span>
              <span style={{ fontFamily: mono, fontWeight: 700 }}>{fmtD(Number(report.qb_total_with_tax ?? billedAmount))}</span>
              <span style={{ color: T.faint, fontSize: 11 }}>invoice PDF + Pay Online link attached</span>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>To</label>
              <input value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="client@example.com" style={input} />
              {contacts.length > 1 && (
                <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>
                  Quick pick: {contacts.filter(c => c.email).map((c, i, arr) => (
                    <span key={c.email!}>
                      <a onClick={(e) => { e.preventDefault(); setToEmail(c.email!); }} href="#" style={{ color: T.accent, textDecoration: "none" }}>
                        {c.name || c.email}
                      </a>
                      {i < arr.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>CC (comma-separated)</label>
              <input value={ccEmails} onChange={e => setCcEmails(e.target.value)} placeholder="optional" style={input} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} style={input} />
            </div>
            {sendMsg && (
              <div style={{ fontSize: 12, fontWeight: 700, color: sendMsg.ok ? T.green : T.red }}>{sendMsg.text}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
              <button onClick={() => setSendOpen(false)} style={btnGhost} disabled={sendBusy}>Cancel</button>
              <button onClick={sendEmail} disabled={sendBusy || !toEmail.trim()} style={{ ...btnGreen, opacity: sendBusy || !toEmail.trim() ? 0.5 : 1 }}>
                {sendBusy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Totals strip(s) — combined shows both halves stacked. Bulk postage
          swaps the shipment strip for a pass-through reimbursement strip. */}
      {isCombined ? (
        <>
          <SalesTotalsStrip totals={report.totals as SalesTotals} feePct={report.hpd_fee_pct} />
          {isBulkPostage
            ? <BulkPostageStrip totals={(report.postage_totals || {}) as any} />
            : <PostageTotalsStrip
                totals={(report.postage_totals || {}) as PostageTotals}
                lines={(report.postage_line_items || []) as PostageLineItem[]}
                showTotal={false}
              />}
          <CombinedInvoiceBreakdown report={report} isBulkPostage={isBulkPostage} />
        </>
      ) : (isPostage || isFulfillment) ? (
        isBulkPostage
          ? <BulkPostageStrip totals={(report.totals || {}) as any} />
          : <PostageTotalsStrip totals={report.totals as PostageTotals} lines={(report.line_items || []) as PostageLineItem[]} fulfillmentOnly={isFulfillment} />
      ) : (
        <SalesTotalsStrip totals={report.totals as SalesTotals} feePct={report.hpd_fee_pct} />
      )}

      {/* Line items — combined shows both tables stacked. Bulk postage
          shows the purchase ledger instead of the shipment table. */}
      {isCombined ? (
        <>
          <LineItemsTable report={report} period={salesSectionPeriod} />
          {isBulkPostage
            ? <BulkPostageLedger lines={(report.postage_line_items || []) as BulkLine[]} total={Number((report.postage_totals || {}).billed) || 0} period={postageSectionPeriod} />
            : <PostageLineItemsTable
                report={report}
                period={postageSectionPeriod}
                postageOverride={{
                  lines: (report.postage_line_items || []) as PostageLineItem[],
                  totals: (report.postage_totals || {}) as PostageTotals,
                  perPackageFee: Number(report.per_package_fee) || 0,
                }}
              />}
        </>
      ) : (isPostage || isFulfillment) ? (
        isBulkPostage
          ? <BulkPostageLedger lines={(report.line_items || []) as BulkLine[]} total={Number((report.totals || {}).billed) || 0} />
          : <PostageLineItemsTable report={report} fulfillmentOnly={isFulfillment} />
      ) : (
        <LineItemsTable report={report} />
      )}

      {confirmEl}
      <QBCustomerChooser
        open={chooserOpen}
        mode="push"
        clientId={report.client_id}
        searchedName={report.clients?.name || ""}
        candidates={chooserCandidates}
        current={chooserCurrent}
        busy={qbBusy}
        onAction={handleChooserAction}
        onClose={() => setChooserOpen(false)}
      />
    </div>
  );
}

// The invoice's life in four steps, current step lit, with a plain-language
// "what happens next" line — so the page itself teaches the workflow.
function StateRail({ inQB, sent, paid, onManualQb }: { inQB: boolean; sent: boolean; paid: boolean; onManualQb?: () => void }) {
  const steps = [
    { label: "Generated", done: true },
    { label: "In QuickBooks", done: inQB },
    { label: "Sent to client", done: sent },
    { label: "Paid", done: paid },
  ];
  const curIdx = steps.findIndex(s => !s.done); // -1 → all done
  const hint = !inQB
    ? <>Next: Push to QuickBooks — creates the invoice in QB and brings back the invoice # and Pay Online link.{onManualQb && <> Already invoiced by hand in QB? <button onClick={onManualQb} style={{ background: "none", border: "none", color: T.blue, fontWeight: 700, fontSize: 11.5, cursor: "pointer", fontFamily: font, padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>enter its #</button>.</>}</>
    : !sent
    ? "Next: Send to client — emails the invoice with the Pay Online link."
    : !paid
    ? "Waiting on payment. Marks itself paid when the client pays through QuickBooks — use Mark paid only for a check or wire."
    : "Settled — nothing left to do here.";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
        {steps.map((s, i) => {
          const active = i === curIdx;
          const bg = active ? T.accent : s.done ? T.greenDim : T.surface;
          const fg = active ? "#0a0a0a" : s.done ? T.green : T.faint;
          return (
            <span key={s.label} style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", padding: "6px 12px", borderRadius: 8, background: bg, color: fg }}>
                {s.done && !active ? "✓ " : ""}{s.label}
              </span>
              {i < steps.length - 1 && <span style={{ color: T.faint, padding: "0 6px" }}>→</span>}
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8 }}>{hint}</div>
    </div>
  );
}

function SalesTotalsStrip({ totals, feePct }: { totals: SalesTotals; feePct: number }) {
  const items = [
    { label: "Qty", value: fmtN(totals.qty), color: T.text },
    { label: "Product Sales", value: fmtD(totals.sales), color: T.text },
    { label: "Total Cost", value: fmtD(totals.cost), color: T.muted },
    { label: "Product Net", value: fmtD(totals.net), color: T.text },
    { label: `HPD Fee (${(feePct * 100).toFixed(1)}%)`, value: fmtD(totals.fee), color: T.amber },
    { label: "Net Profit", value: fmtD(totals.profit), color: T.green },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
      {items.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: i.color }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function PostageTotalsStrip({ totals, lines, fulfillmentOnly = false, showTotal = true }: { totals: PostageTotals; lines: PostageLineItem[]; fulfillmentOnly?: boolean; showTotal?: boolean }) {
  // Older postage reports were saved before totals.items existed — fall
  // back to summing items_count off the line items so historical reports
  // still show the KPI. Same defensive default for fulfillment (added
  // when the per-package fee shipped — older reports default to 0).
  const itemsFallback = lines.reduce((a, r) => a + (Number(r.items_count) || 0), 0);
  const safe = {
    shipments: Number(totals?.shipments) || 0,
    items: Number(totals?.items) || itemsFallback,
    paid: Number(totals?.paid) || 0,
    cost_raw: Number(totals?.cost_raw) || 0,
    cost: Number(totals?.cost) || 0,
    insurance: Number(totals?.insurance) || 0,
    billed: Number(totals?.billed) || 0,
    margin: Number(totals?.margin) || 0,
    fulfillment: Number(totals?.fulfillment) || 0,
  };
  // Fulfillment-only: no postage is billed, so show just the invoiced
  // figures (shipments, items, the fee, the total).
  // Slimmed Aug 31 (Jon: "a disaster of buttons and info") — lead with the
  // number that matters (Total Invoice), keep what's billed + the client's
  // profit story; income/cost/insurance live in the table + Excel. Combined
  // reports pass showTotal=false (the true total = sales fee + postage, shown
  // in the Invoice Breakdown card instead).
  const tiles = fulfillmentOnly ? [
    { label: "Shipments", value: fmtN(safe.shipments), color: T.text },
    { label: "Items Shipped", value: fmtN(safe.items), color: T.text },
    { label: "Fulfillment Fee", value: fmtD(safe.fulfillment), color: T.amber },
    { label: "Total Invoice", value: fmtD(safe.fulfillment), color: T.green },
  ] : [
    ...(showTotal ? [{ label: "Total Invoice", value: fmtD(safe.billed + safe.fulfillment), color: T.green }] : []),
    { label: "Shipments", value: fmtN(safe.shipments), color: T.text },
    { label: "Items Shipped", value: fmtN(safe.items), color: T.text },
    { label: "Postage Billed", value: fmtD(safe.billed), color: T.amber },
    { label: "Fulfillment Fee", value: fmtD(safe.fulfillment), color: T.amber },
    { label: "Client Profit", value: fmtD(safe.margin), color: safe.margin >= 0 ? T.green : T.red },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, gap: 8 }}>
      {tiles.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: i.color }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function LineItemsTable({ report, period }: { report: Report; period?: string }) {
  const lines = (report.line_items || []) as SalesLineItem[];
  const groups = useMemo(() => groupLineItems(lines), [lines]);
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "8px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono, verticalAlign: "top" };
  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Products ({groups.length}) · {lines.length} variant{lines.length === 1 ? "" : "s"}
        {period && <span style={{ marginLeft: 8, color: T.faint }}>· {period}</span>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Description</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Qty Sold</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Product Sales</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Unit Cost</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Total Cost</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Product Net</th>
              <th style={{ ...thStyle, textAlign: "right" }}>HPD Fee</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const totalCost = g.unit_cost * g.qty_sold;
              const net = g.product_sales - totalCost;
              const fee = net * report.hpd_fee_pct;
              const profit = net - fee;
              const sizesLabel = g.variants.length > 1
                ? g.variants.filter(v => v.qty_sold > 0).map(v => `${v.size || v.sku}: ${fmtN(v.qty_sold)}`).join("  ·  ")
                : "";
              return (
                <tr key={g.key}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{g.root_sku || "(no SKU)"}</td>
                  <td style={{ ...tdStyle, fontFamily: font }}>
                    <div style={{ color: T.text, fontWeight: 600 }}>{g.root_description}</div>
                    {sizesLabel && <div style={{ fontSize: 10, color: T.faint, marginTop: 3, fontFamily: mono }}>{sizesLabel}</div>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtN(g.qty_sold)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(g.product_sales)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{fmtD(g.unit_cost)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{fmtD(totalCost)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(net)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: T.amber }}>{fmtD(fee)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: T.green, fontWeight: 700 }}>{fmtD(profit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PostageLineItemsTable({
  report,
  postageOverride,
  period,
  fulfillmentOnly = false,
}: {
  report: Report;
  // Combined reports keep postage data on dedicated columns; pass them
  // through here so this component can render either a postage-only
  // report or the postage half of a combined report from the same code.
  postageOverride?: { lines: PostageLineItem[]; totals: PostageTotals; perPackageFee: number };
  period?: string;
  // Fulfillment-only: hide every postage cost column (the client never
  // sees postage) and show just date / order / recipient / items, with a
  // fulfillment-fee-only invoice summary.
  fulfillmentOnly?: boolean;
}) {
  const lines = postageOverride?.lines ?? ((report.line_items || []) as PostageLineItem[]);
  const totals = postageOverride?.totals ?? ((report.totals || {}) as PostageTotals);
  const postageBilled = Number(totals.billed) || 0;
  const fulfillment = Number(totals.fulfillment) || 0;
  const perPackage = postageOverride?.perPackageFee ?? (Number(report.per_package_fee) || 0);
  const shipments = Number(totals.shipments) || lines.length;
  const totalInvoice = postageBilled + fulfillment;
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const tdStyle: React.CSSProperties = { padding: "7px 10px", fontSize: 11, borderBottom: `1px solid ${T.border}`, fontFamily: mono, verticalAlign: "top" };
  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Shipments ({lines.length})
        {period && <span style={{ marginLeft: 8, color: T.faint }}>· {period}</span>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: fulfillmentOnly ? 0 : 960 }}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Order #</th>
              <th style={thStyle}>Recipient</th>
              {!fulfillmentOnly && <th style={thStyle}>Service</th>}
              <th style={{ ...thStyle, textAlign: "right" }}>Items</th>
              {!fulfillmentOnly && <>
                <th style={{ ...thStyle, textAlign: "right" }}>Weight</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Zone</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Paid</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Insurance</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Billed</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {lines.map((r, i) => {
              const svc = [r.provider, r.service, r.package_type].filter(Boolean).join(" · ");
              const weight = r.weight ? `${r.weight} ${r.weight_unit || ""}`.trim() : "—";
              return (
                <tr key={i}>
                  <td style={{ ...tdStyle, color: T.muted }}>{dateOnly(r.ship_date) || "—"}</td>
                  <td style={{ ...tdStyle, color: T.text, fontWeight: 600 }}>{r.order_number || "—"}</td>
                  <td style={{ ...tdStyle, fontFamily: font }}>{r.recipient || "—"}</td>
                  {!fulfillmentOnly && <td style={{ ...tdStyle, fontFamily: font, color: T.muted }}>{svc || "—"}</td>}
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.items_count ? fmtN(r.items_count) : "—"}</td>
                  {!fulfillmentOnly && <>
                    <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{weight}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.zone || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.shipping_paid)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{fmtD(r.shipping_cost)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: r.insurance_cost > 0 ? T.muted : T.faint }}>{r.insurance_cost > 0 ? fmtD(r.insurance_cost) : "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtD(r.billed)}</td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Invoice summary — postage billed + fulfillment fee + total.
          Fulfillment is a flat HPD service charge that's billed in
          addition to postage; doesn't affect the postage Client Profit. */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        {!fulfillmentOnly && (
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 12, color: T.muted, fontFamily: mono }}>
            <span>Postage Billed (cost + insurance)</span>
            <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(postageBilled)}</span>
          </div>
        )}
        {fulfillment > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 12, color: T.muted, fontFamily: mono }}>
            <span>Fulfillment Fee {perPackage > 0 ? `(${fmtD(perPackage)} × ${fmtN(shipments)} shipments)` : ""}</span>
            <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(fulfillment)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 14, color: T.text, fontFamily: mono, fontWeight: 800, paddingTop: 6, borderTop: `1px solid ${T.border}`, marginTop: 4 }}>
          <span>Total Invoice</span>
          <span>{fmtD(fulfillmentOnly ? fulfillment : totalInvoice)}</span>
        </div>
      </div>
    </div>
  );
}

function ManualInvoiceInput({ reportId, initial, onSaved }: { reportId: string; initial: string | null; onSaved: () => void }) {
  const supabase = createClient();
  const [value, setValue] = useState(initial || "");
  const [savedValue, setSavedValue] = useState(initial || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = value.trim();
    if (trimmed === savedValue) return;
    setSaving(true);
    await supabase.from("shipstation_reports")
      .update({ qb_invoice_number: trimmed || null })
      .eq("id", reportId);
    setSavedValue(trimmed);
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Existing QB invoice #</div>
        <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
          If this fulfillment fee is being billed on a QB invoice you already created by hand, enter the # here — no new invoice will be created in QB.
        </div>
      </div>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="e.g. 3682"
        style={{
          width: 140, padding: "8px 12px",
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 6, color: T.text, fontSize: 13, fontFamily: mono,
          outline: "none", textAlign: "center",
        }}
      />
      {saving && <span style={{ fontSize: 10, color: T.muted }}>Saving…</span>}
    </div>
  );
}

// Combined invoice breakdown — shown between the totals strips and the
// line items so the user can see at a glance what the QB invoice will
// total. Lines mirror exactly what the QB push produces:
//   Service Fee   ← totals.fee (sales side)
//   Postage       ← postage_totals.billed
//   Fulfillment   ← postage_totals.fulfillment (only when > 0)
// Bulk postage strip — pass-through has only two real numbers (purchase
// count + reimbursement total), so it gets its own 3-tile strip rather
// than the shipment strip's income/cost/margin columns.
function BulkPostageStrip({ totals }: { totals: { purchases?: number; total?: number; billed?: number } }) {
  const reimbursement = Number(totals?.billed ?? totals?.total) || 0;
  const tiles = [
    { label: "Purchases", value: fmtN(Number(totals?.purchases) || 0), color: T.text },
    { label: "Billing", value: "Pass-through", color: T.text },
    { label: "Reimbursement", value: fmtD(reimbursement), color: T.green },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {tiles.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: i.color }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

// Bulk postage ledger — itemized list of postage purchases (date + amount)
// with a reimbursement total. Mirrors the shipment table's card styling.
function BulkPostageLedger({ lines, total, period }: { lines: BulkLine[]; total: number; period?: string }) {
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "7px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono };
  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Postage Purchases ({lines.length})
        {period && <span style={{ marginLeft: 8, color: T.faint }}>· {period}</span>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Transaction Date</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((r, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, fontFamily: font }}>{r.transaction_date || "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(Number(r.amount) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 14, color: T.text, fontFamily: mono, fontWeight: 800 }}>
          <span>Total Reimbursement</span>
          <span>{fmtD(total)}</span>
        </div>
      </div>
    </div>
  );
}

function CombinedInvoiceBreakdown({ report, isBulkPostage }: { report: Report; isBulkPostage: boolean }) {
  const fee = Number((report.totals as any)?.fee) || 0;
  const billed = Number((report.postage_totals as any)?.billed) || 0;
  // Bulk has no fulfillment fee; force it to 0 regardless of any stale value.
  const fulfillment = isBulkPostage ? 0 : (Number((report.postage_totals as any)?.fulfillment) || 0);
  const shipments = Number((report.postage_totals as any)?.shipments) || 0;
  const perPackage = Number(report.per_package_fee) || 0;
  const feePct = (Number(report.hpd_fee_pct) || 0) * 100;
  const salesNet = Number((report.totals as any)?.net) || 0;
  const total = fee + billed + fulfillment;
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Invoice Breakdown</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: mono, maxWidth: 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: T.muted }}>Service Fee ({feePct.toFixed(1)}% of {fmtD(salesNet)} net sales)</span>
          <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(fee)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: T.muted }}>{isBulkPostage ? "Postage reimbursement" : "Postage & Insurance"}</span>
          <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(billed)}</span>
        </div>
        {fulfillment > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: T.muted }}>Fulfillment Fee {perPackage > 0 ? `(${fmtD(perPackage)} × ${fmtN(shipments)} shipments)` : ""}</span>
            <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(fulfillment)}</span>
          </div>
        )}
        <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800 }}>
          <span style={{ color: T.text }}>Total Invoice</span>
          <span style={{ color: T.text }}>{fmtD(total)}</span>
        </div>
      </div>
    </div>
  );
}

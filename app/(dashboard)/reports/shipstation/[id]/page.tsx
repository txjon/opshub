"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { groupLineItems } from "@/lib/shipstation-group";
import { QBCustomerChooser, type QBCandidate, type QBCurrent } from "@/components/QBCustomerChooser";

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

type ReportType = "sales" | "postage" | "combined";
type Report = {
  id: string;
  client_id: string;
  report_type: ReportType;
  period_label: string;
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
    return Number(report.totals?.fee) || 0;
  }, [report, isPostage, isCombined]);
  const reportKindLabel = isCombined ? "Full Service Report" : isPostage ? "Postage Report" : "Services Invoice";

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
        const kind = isCombined ? "Full Service Invoice" : isPostage ? "Postage Report" : "Services Invoice";
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
    if (!window.confirm("Delete this report? This can't be undone.")) return;
    setDeleting(true);
    await supabase.from("shipstation_reports").delete().eq("id", params.id);
    router.push("/reports");
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
  const btnPrimary: React.CSSProperties = { background: T.accent, color: "#ffffff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const btnGhost: React.CSSProperties = { background: T.surface, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const btnGreen: React.CSSProperties = { background: T.green, color: "#0a0e1a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const input: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box", width: "100%" };

  const created = new Date(report.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const hasQB = !!report.qb_invoice_id;
  const isManualInvoice = !!report.qb_invoice_number && !report.qb_invoice_id;
  const sentDate = report.sent_at ? new Date(report.sent_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            <a href="/reports" style={{ color: T.muted, textDecoration: "none" }}>Reports</a> · ShipStation
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            {reportKindLabel} — {report.clients?.name || "—"}
          </h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {report.period_label} · Generated {created}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {/* Edit — re-opens the wizard with this report's data hydrated.
              Lets you adjust unit costs / markup / per-package fee / etc.
              and save back without re-uploading the CSV. After saving,
              click "Update QB Invoice" to push the changes to QB. */}
          <a href={`/reports/shipstation/new?edit=${report.id}`} style={btnGhost}>Edit</a>
          <a href={`/api/pdf/shipstation/${report.id}`} target="_blank" rel="noopener noreferrer" style={btnGhost}>Preview PDF</a>
          <a href={`/api/pdf/shipstation/${report.id}?download=1`} style={btnGhost}>Download PDF</a>
          {(isPostage || isCombined) && (
            <a href={`/api/excel/shipstation/${report.id}`} style={btnGhost}>Download Excel</a>
          )}
          {hasQB ? (
            <button onClick={() => pushToQB()} disabled={qbBusy} style={{ ...btnGhost, borderColor: T.accent + "66", color: T.accent, opacity: qbBusy ? 0.6 : 1 }}>{qbBusy ? "Updating…" : "Update QB Invoice"}</button>
          ) : isManualInvoice ? (
            <button disabled style={{ ...btnGhost, borderColor: T.green + "66", color: T.green, cursor: "default", opacity: 1 }}>
              ✓ QB #{report.qb_invoice_number} (manual)
            </button>
          ) : (
            <button onClick={() => pushToQB()} disabled={qbBusy} style={{ ...btnPrimary, opacity: qbBusy ? 0.6 : 1 }}>{qbBusy ? "Pushing…" : "Push to QuickBooks"}</button>
          )}
          {/* QB customer linker — lets you verify or re-point the cached
              QB customer for this client, especially after a duplicate
              was accidentally created on a previous push. */}
          <button
            onClick={openChooserManual}
            disabled={qbBusy}
            style={{ ...btnGhost, opacity: qbBusy ? 0.6 : 1 }}
            title="Verify or change which QuickBooks customer this client is linked to"
          >
            QB customer
          </button>
          {(hasQB || isManualInvoice) && (
            <button onClick={() => setSendOpen(s => !s)} style={btnGreen}>{sendOpen ? "Close" : (sentDate ? "Re-send to client" : "Send to client")}</button>
          )}
          <button onClick={onDelete} disabled={deleting} style={{ ...btnGhost, color: T.red, borderColor: T.red + "44" }}>Delete</button>
        </div>
      </div>

      {!hasQB && (
        <ManualInvoiceInput
          reportId={report.id}
          initial={report.qb_invoice_number}
          onSaved={load}
        />
      )}

      {qbMsg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: qbMsg.ok ? T.green + "11" : T.red + "11", border: `1px solid ${qbMsg.ok ? T.green + "55" : T.red + "55"}`, color: qbMsg.ok ? T.green : T.red, fontSize: 12 }}>
          {qbMsg.text}
        </div>
      )}

      {(hasQB || isManualInvoice) && (
        <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>QB Invoice</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: T.accent }}>#{report.qb_invoice_number}</div>
            {isManualInvoice && <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>manual</div>}
          </div>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Billed</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono }}>{fmtD(Number(report.qb_total_with_tax ?? billedAmount))}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Status</div>
            {report.paid_at ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ Paid</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{new Date(report.paid_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {fmtD(Number(report.paid_amount) || 0)}</div>
                <button onClick={togglePaid} style={{ background: "none", border: "none", color: T.muted, fontSize: 10, cursor: "pointer", padding: 0, marginTop: 4, textDecoration: "underline", fontFamily: font }}>
                  Mark unpaid
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.amber }}>Unpaid</div>
                <button onClick={togglePaid} style={{ background: "none", border: `1px solid ${T.green}55`, color: T.green, fontSize: 10, cursor: "pointer", padding: "3px 8px", marginTop: 6, borderRadius: 4, fontFamily: font, fontWeight: 600 }}>
                  Mark paid
                </button>
              </>
            )}
          </div>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Pay Link</div>
            {report.qb_payment_link ? (
              <a href={report.qb_payment_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.green, wordBreak: "break-all" }}>Open payment page →</a>
            ) : (
              <span style={{ fontSize: 12, color: T.faint }}>—</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Email sent</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: sentDate ? T.green : T.faint }}>
              {sentDate ? `✓ ${sentDate}` : "Not sent"}
            </div>
            {sentDate && report.sent_to && report.sent_to.length > 0 && (
              <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{report.sent_to.join(", ")}</div>
            )}
          </div>
        </div>
      )}

      {sendOpen && (hasQB || isManualInvoice) && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Send report + Pay Online link</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} style={input} />
          </div>
          {sendMsg && (
            <div style={{ padding: "8px 12px", borderRadius: 6, background: sendMsg.ok ? T.green + "11" : T.red + "11", border: `1px solid ${sendMsg.ok ? T.green + "55" : T.red + "55"}`, color: sendMsg.ok ? T.green : T.red, fontSize: 12 }}>
              {sendMsg.text}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button onClick={() => setSendOpen(false)} style={btnGhost} disabled={sendBusy}>Cancel</button>
            <button onClick={sendEmail} disabled={sendBusy || !toEmail.trim()} style={{ ...btnGreen, opacity: sendBusy || !toEmail.trim() ? 0.5 : 1 }}>
              {sendBusy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* Totals strip(s) — combined shows both halves stacked. */}
      {isCombined ? (
        <>
          <SalesTotalsStrip totals={report.totals as SalesTotals} feePct={report.hpd_fee_pct} />
          <PostageTotalsStrip
            totals={(report.postage_totals || {}) as PostageTotals}
            lines={(report.postage_line_items || []) as PostageLineItem[]}
          />
          <CombinedInvoiceBreakdown report={report} />
        </>
      ) : isPostage ? (
        <PostageTotalsStrip totals={report.totals as PostageTotals} lines={(report.line_items || []) as PostageLineItem[]} />
      ) : (
        <SalesTotalsStrip totals={report.totals as SalesTotals} feePct={report.hpd_fee_pct} />
      )}

      {/* Line items — combined shows both tables stacked. */}
      {isCombined ? (
        <>
          <LineItemsTable report={report} />
          <PostageLineItemsTable
            report={report}
            postageOverride={{
              lines: (report.postage_line_items || []) as PostageLineItem[],
              totals: (report.postage_totals || {}) as PostageTotals,
              perPackageFee: Number(report.per_package_fee) || 0,
            }}
          />
        </>
      ) : isPostage ? (
        <PostageLineItemsTable report={report} />
      ) : (
        <LineItemsTable report={report} />
      )}

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

function PostageTotalsStrip({ totals, lines }: { totals: PostageTotals; lines: PostageLineItem[] }) {
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
  const tiles = [
    { label: "Shipments", value: fmtN(safe.shipments), color: T.text },
    { label: "Items Shipped", value: fmtN(safe.items), color: T.text },
    { label: "Shipping Income", value: fmtD(safe.paid), color: T.text },
    { label: "Shipping Cost", value: fmtD(safe.cost), color: T.muted },
    { label: "Insurance", value: fmtD(safe.insurance), color: T.muted },
    { label: "Billed Amount", value: fmtD(safe.billed), color: T.amber },
    { label: "Client Profit", value: fmtD(safe.margin), color: safe.margin >= 0 ? T.green : T.red },
    { label: "Fulfillment", value: fmtD(safe.fulfillment), color: T.amber },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8 }}>
      {tiles.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: i.color }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function LineItemsTable({ report }: { report: Report }) {
  const lines = (report.line_items || []) as SalesLineItem[];
  const groups = useMemo(() => groupLineItems(lines), [lines]);
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "8px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono, verticalAlign: "top" };
  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Products ({groups.length}) · {lines.length} variant{lines.length === 1 ? "" : "s"}
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
}: {
  report: Report;
  // Combined reports keep postage data on dedicated columns; pass them
  // through here so this component can render either a postage-only
  // report or the postage half of a combined report from the same code.
  postageOverride?: { lines: PostageLineItem[]; totals: PostageTotals; perPackageFee: number };
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
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Order #</th>
              <th style={thStyle}>Recipient</th>
              <th style={thStyle}>Service</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Items</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Weight</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Zone</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Paid</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Insurance</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Billed</th>
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
                  <td style={{ ...tdStyle, fontFamily: font, color: T.muted }}>{svc || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.items_count ? fmtN(r.items_count) : "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{weight}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.zone || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.shipping_paid)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{fmtD(r.shipping_cost)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: r.insurance_cost > 0 ? T.muted : T.faint }}>{r.insurance_cost > 0 ? fmtD(r.insurance_cost) : "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtD(r.billed)}</td>
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
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 12, color: T.muted, fontFamily: mono }}>
          <span>Postage Billed (cost + insurance)</span>
          <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(postageBilled)}</span>
        </div>
        {fulfillment > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 12, color: T.muted, fontFamily: mono }}>
            <span>Fulfillment Fee {perPackage > 0 ? `(${fmtD(perPackage)} × ${fmtN(shipments)} shipments)` : ""}</span>
            <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(fulfillment)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 480, fontSize: 14, color: T.text, fontFamily: mono, fontWeight: 800, paddingTop: 6, borderTop: `1px solid ${T.border}`, marginTop: 4 }}>
          <span>Total Invoice</span>
          <span>{fmtD(totalInvoice)}</span>
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
function CombinedInvoiceBreakdown({ report }: { report: Report }) {
  const fee = Number((report.totals as any)?.fee) || 0;
  const billed = Number((report.postage_totals as any)?.billed) || 0;
  const fulfillment = Number((report.postage_totals as any)?.fulfillment) || 0;
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
          <span style={{ color: T.muted }}>Postage &amp; Insurance</span>
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

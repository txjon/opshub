"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { groupLineItems } from "@/lib/shipstation-group";

const fmtD = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");

type LineItem = { sku: string; description: string; qty_sold: number; product_sales: number; unit_cost: number };
type Report = {
  id: string;
  client_id: string;
  period_label: string;
  hpd_fee_pct: number;
  line_items: LineItem[];
  totals: { qty: number; sales: number; cost: number; net: number; fee: number; profit: number };
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

  // QB push state
  const [qbBusy, setQbBusy] = useState(false);
  const [qbMsg, setQbMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Email send state
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

  // When email panel opens, load client contacts so we can default "To".
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
        setSubject(`Product Sales Report — ${report.clients?.name || ""} · ${report.period_label}${n ? ` · Invoice ${n}` : ""}`);
      }
    })();
  }, [sendOpen, report]);

  async function onDelete() {
    if (!window.confirm("Delete this report? This can't be undone.")) return;
    setDeleting(true);
    await supabase.from("shipstation_reports").delete().eq("id", params.id);
    router.push("/reports");
  }

  async function pushToQB() {
    setQbBusy(true); setQbMsg(null);
    try {
      const res = await fetch("/api/qb/shipstation-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: params.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push failed");
      setQbMsg({ ok: true, text: data.updated ? `Invoice #${data.invoiceNumber} updated in QuickBooks.` : `Invoice #${data.invoiceNumber} created in QuickBooks.` });
      await load();
    } catch (e: any) {
      setQbMsg({ ok: false, text: e.message || "Push failed" });
    } finally {
      setQbBusy(false);
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
  const btnPrimary: React.CSSProperties = { background: T.accent, color: "#0a0e1a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const btnGhost: React.CSSProperties = { background: T.surface, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const btnGreen: React.CSSProperties = { background: T.green, color: "#0a0e1a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono };
  const input: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box", width: "100%" };

  const created = new Date(report.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const hasQB = !!report.qb_invoice_id;
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
            Sales Report — {report.clients?.name || "—"}
          </h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {report.period_label} · Generated {created}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a href={`/api/pdf/shipstation/${report.id}`} target="_blank" rel="noopener noreferrer" style={btnGhost}>Preview PDF</a>
          <a href={`/api/pdf/shipstation/${report.id}?download=1`} style={btnGhost}>Download PDF</a>
          {!hasQB ? (
            <button onClick={pushToQB} disabled={qbBusy} style={{ ...btnPrimary, opacity: qbBusy ? 0.6 : 1 }}>{qbBusy ? "Pushing…" : "Push to QuickBooks"}</button>
          ) : (
            <button onClick={pushToQB} disabled={qbBusy} style={{ ...btnGhost, borderColor: T.accent + "66", color: T.accent, opacity: qbBusy ? 0.6 : 1 }}>{qbBusy ? "Updating…" : "Update QB Invoice"}</button>
          )}
          {hasQB && (
            <button onClick={() => setSendOpen(s => !s)} style={btnGreen}>{sendOpen ? "Close" : (sentDate ? "Re-send to client" : "Send to client")}</button>
          )}
          <button onClick={onDelete} disabled={deleting} style={{ ...btnGhost, color: T.red, borderColor: T.red + "44" }}>Delete</button>
        </div>
      </div>

      {qbMsg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: qbMsg.ok ? T.green + "11" : T.red + "11", border: `1px solid ${qbMsg.ok ? T.green + "55" : T.red + "55"}`, color: qbMsg.ok ? T.green : T.red, fontSize: 12 }}>
          {qbMsg.text}
        </div>
      )}

      {/* QB invoice summary */}
      {hasQB && (
        <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>QB Invoice</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: T.accent }}>#{report.qb_invoice_number}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Billed</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono }}>{fmtD(Number(report.qb_total_with_tax ?? report.totals.fee))}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Status</div>
            {report.paid_at ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ Paid</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{new Date(report.paid_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {fmtD(Number(report.paid_amount) || 0)}</div>
              </>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 700, color: T.amber }}>Unpaid</div>
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

      {/* Send-to-client inline form */}
      {sendOpen && hasQB && (
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

      {/* Totals strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        {[
          { label: "Qty", value: fmtN(report.totals.qty), color: T.text },
          { label: "Product Sales", value: fmtD(report.totals.sales), color: T.text },
          { label: "Total Cost", value: fmtD(report.totals.cost), color: T.muted },
          { label: "Product Net", value: fmtD(report.totals.net), color: T.text },
          { label: `HPD Fee (${(report.hpd_fee_pct * 100).toFixed(1)}%)`, value: fmtD(report.totals.fee), color: T.amber },
          { label: "Net Profit", value: fmtD(report.totals.profit), color: T.green },
        ].map(i => (
          <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: i.color }}>{i.value}</div>
          </div>
        ))}
      </div>

      {/* Line items — grouped by product, size variants collapsed as subtitles */}
      <LineItemsTable report={report} />
    </div>
  );
}

function LineItemsTable({ report }: { report: Report }) {
  const groups = useMemo(() => groupLineItems(report.line_items), [report.line_items]);
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "8px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono, verticalAlign: "top" };
  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Products ({groups.length}) · {report.line_items.length} variant{report.line_items.length === 1 ? "" : "s"}
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

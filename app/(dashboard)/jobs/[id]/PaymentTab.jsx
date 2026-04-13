"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";

export function PaymentTab({ job, contacts, payments, onReload, onRecalcPhase, onUpdateJob }) {
  const supabase = createClient();
  const [showInvoiceEmail, setShowInvoiceEmail] = useState(false);
  const [showInvoiceProofsEmail, setShowInvoiceProofsEmail] = useState(false);
  const [pushingToQB, setPushingToQB] = useState(false);
  const [qbError, setQbError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [pmType, setPmType] = useState("deposit");
  const [pmAmount, setPmAmount] = useState("");
  const [pmInvoice, setPmInvoice] = useState("");
  const [pmDue, setPmDue] = useState(new Date().toISOString().split("T")[0]);

  const qbInvoiceNumber = job.type_meta?.qb_invoice_number;
  const qbPaymentLink = job.type_meta?.qb_payment_link;
  const [previewed, setPreviewed] = useState(false);

  // Detect stale QB invoice — current pricing doesn't match QB total
  const currentSubtotal = (job.costing_summary?.grossRev || 0);
  const qbSubtotal = (job.type_meta?.qb_total_with_tax || 0) - (job.type_meta?.qb_tax_amount || 0);
  const invoiceStale = qbInvoiceNumber && Math.abs(currentSubtotal - qbSubtotal) > 0.01;

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };
  const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

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

      {/* ── Action Buttons ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button onClick={pushToQB} disabled={pushingToQB}
          style={{ flex: 1, minWidth: 100, height: 60, borderRadius: 8,
            border: invoiceStale ? `2px solid ${T.red}` : qbInvoiceNumber ? `2px solid ${T.green}` : "none",
            cursor: pushingToQB ? "default" : "pointer",
            background: invoiceStale ? T.redDim : qbInvoiceNumber ? T.greenDim : T.blue,
            color: invoiceStale ? T.red : qbInvoiceNumber ? T.green : "#fff",
            fontSize: 11, fontWeight: 700, fontFamily: font,
            opacity: pushingToQB ? 0.6 : 1, transition: "opacity 0.15s", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 8, gap: 2 }}
          onMouseEnter={e => { if (!pushingToQB) e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
          {pushingToQB ? (qbInvoiceNumber ? "Updating..." : "Creating...") : invoiceStale ? (
            <><span>⚠ QB #{qbInvoiceNumber}</span><span style={{ fontSize: 9, fontWeight: 500 }}>Pricing changed — click to update</span></>
          ) : qbInvoiceNumber ? (
            <><span>✓ QB #{qbInvoiceNumber}</span><span style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>Click to update</span></>
          ) : "Create QB Invoice"}
        </button>
        <span style={{ fontSize: 14, color: qbInvoiceNumber ? T.accent : T.faint, flexShrink: 0 }}>→</span>
        <button onClick={() => { setShowPreview(true); setPreviewed(true); }} disabled={!qbInvoiceNumber}
          style={{ flex: 1, minWidth: 100, height: 60, borderRadius: 8, border: previewed ? `2px solid ${T.accent}` : "none", cursor: !qbInvoiceNumber ? "default" : "pointer",
            background: !qbInvoiceNumber ? T.surface : previewed ? T.accentDim : T.accent, color: !qbInvoiceNumber ? T.faint : previewed ? T.accent : "#fff", fontSize: 11, fontWeight: 700, fontFamily: font,
            opacity: !qbInvoiceNumber ? 0.4 : 1, transition: "opacity 0.15s", textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}
          onMouseEnter={e => { if (qbInvoiceNumber) e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = !qbInvoiceNumber ? "0.4" : "1"; }}>
          {previewed ? "✓ Preview Invoice" : "Preview Invoice"}
        </button>
        <span style={{ fontSize: 14, color: previewed ? T.accent : T.faint, flexShrink: 0 }}>→</span>
        <button onClick={() => setShowInvoiceEmail(!showInvoiceEmail)} disabled={!previewed}
          style={{ flex: 1, minWidth: 100, height: 60, borderRadius: 8, border: "none", cursor: !previewed ? "default" : "pointer",
            background: !previewed ? T.surface : T.accent, color: !previewed ? T.faint : "#fff", fontSize: 11, fontWeight: 700, fontFamily: font,
            opacity: !previewed ? 0.4 : 1, transition: "opacity 0.15s", textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}
          onMouseEnter={e => { if (previewed) e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = !previewed ? "0.4" : "1"; }}>
          Send Invoice + Portal Link
        </button>
      </div>

      {/* Invoice Preview Modal — fullscreen */}
      {showPreview && (
        <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Invoice Preview</div>
            <div style={{ display: "flex", gap: 8 }}>
              <a href={`/api/pdf/invoice/${job.id}?download=1`} target="_blank" rel="noopener noreferrer"
                style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontWeight: 600, textDecoration: "none", cursor: "pointer" }}>
                Download PDF
              </a>
              <button onClick={() => setShowPreview(false)}
                style={{ padding: "8px 20px", borderRadius: 8, background: T.surface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <iframe src={`/api/pdf/invoice/${job.id}`} style={{ width: "100%", height: "100%", border: "none" }} />
          </div>
        </div>
      )}

      {/* Manual invoice number */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
        <label style={{ fontSize: 10, color: T.muted, flexShrink: 0 }}>Invoice #</label>
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
          placeholder="Enter QB invoice #"
          style={{ ...ic, width: 160, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}
        />
      </div>
      {qbPaymentLink && (
        <div style={{ textAlign: "center", fontSize: 11, color: T.accent }}>
          <a href={qbPaymentLink} target="_blank" rel="noopener noreferrer" style={{ color: T.accent }}>QB Payment link →</a>
        </div>
      )}
      {qbError && <div style={{ background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: T.red }}>{qbError}</div>}
      {showInvoiceEmail && (
        <SendEmailDialog
          type="invoice"
          jobId={job.id}
          contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
          defaultEmail={contacts.find(c => c.role_on_job === "billing")?.email || contacts.find(c => c.role_on_job === "primary")?.email || ""}
          defaultSubject={`Invoice — ${job.clients?.name || ""} · ${job.title}`}
          onClose={() => setShowInvoiceEmail(false)}
          onSent={() => { logJobActivity(job.id, "Invoice sent to client"); setShowInvoiceEmail(false); }}
        />
      )}

      {/* ── Payment Records ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Payment Records</div>
          <button onClick={() => setAddingPayment(!addingPayment)} style={{ background: T.accent, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 14px", cursor: "pointer" }}>+ Add Payment</button>
        </div>

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
              const display = statusStyle[p.status] || statusStyle.pending;
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
                    }} style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 600, border: "none", cursor: "pointer", background: display.bg, color: display.color }}>{p.status}</button>
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
  );
}

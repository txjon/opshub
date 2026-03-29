"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";

export function ApprovalsPaymentTab({ job, items, contacts, payments, proofStatus, onUpdateItem, onReload, onRecalcPhase }) {
  const supabase = createClient();
  const [showInvoiceEmail, setShowInvoiceEmail] = useState(false);
  const [showCombinedEmail, setShowCombinedEmail] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [pmType, setPmType] = useState("deposit");
  const [pmAmount, setPmAmount] = useState("");
  const [pmInvoice, setPmInvoice] = useState("");
  const [pmDue, setPmDue] = useState(new Date().toISOString().split("T")[0]);

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };
  const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

  const approvedCount = items.filter(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved").length;
  const allApproved = items.length > 0 && approvedCount === items.length;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Send Actions ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setShowCombinedEmail(!showCombinedEmail); setShowInvoiceEmail(false); }}
            style={{ flex: 1, padding: "14px", borderRadius: 10, border: "none", cursor: "pointer",
              background: T.purple, color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: font,
              letterSpacing: "-0.01em", transition: "opacity 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            Send Invoice & Proofs
          </button>
          <button onClick={() => window.open(`/api/pdf/invoice-proofs/${job.id}`, "_blank")}
            style={{ padding: "14px 24px", borderRadius: 10, border: "none", cursor: "pointer",
              background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: font,
              transition: "opacity 0.15s", flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            Preview
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setShowInvoiceEmail(!showInvoiceEmail); setShowCombinedEmail(false); }}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${T.border}`, cursor: "pointer",
              background: "transparent", color: T.muted, fontSize: 12, fontWeight: 600, fontFamily: font,
              transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
            Send Invoice Only
          </button>
          <button onClick={() => window.open(`/api/pdf/invoice/${job.id}`, "_blank")}
            style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${T.border}`, cursor: "pointer",
              background: "transparent", color: T.muted, fontSize: 12, fontWeight: 600, fontFamily: font,
              transition: "all 0.15s", flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
            Preview
          </button>
        </div>
      </div>
      {showCombinedEmail && (
        <SendEmailDialog
          type="invoice_proofs"
          jobId={job.id}
          contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
          defaultEmail={contacts.find(c => c.role_on_job === "billing")?.email || contacts.find(c => c.role_on_job === "primary")?.email || ""}
          defaultSubject={`Invoice & Proofs — ${job.clients?.name || ""} · ${job.title}`}
          onClose={() => setShowCombinedEmail(false)}
          onSent={() => { logJobActivity(job.id, "Invoice & proofs sent to client"); setShowCombinedEmail(false); }}
        />
      )}
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

      {/* ── Proof Approvals ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Proof Approvals</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: allApproved ? T.green : T.amber }}>
            {approvedCount}/{items.length} approved
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item, i) => {
            const fileApproved = proofStatus[item.id]?.allApproved;
            const manualApproved = item.artwork_status === "approved";
            const isApproved = fileApproved || manualApproved;
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.surface, borderRadius: 8, border: `1px solid ${isApproved ? T.green + "44" : T.border}` }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{[item.blank_vendor, item.color].filter(Boolean).join(" · ")}</div>
                </div>
                {fileApproved && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>
                    File Approved
                  </span>
                )}
                <button onClick={async () => {
                  const newStatus = manualApproved ? "not_started" : "approved";
                  await supabase.from("items").update({ artwork_status: newStatus }).eq("id", item.id);
                  if (onUpdateItem) onUpdateItem(item.id, { artwork_status: newStatus });
                  if (newStatus === "approved") logJobActivity(job.id, `${item.name} proof manually approved`);
                  if (onRecalcPhase) setTimeout(onRecalcPhase, 300);
                }}
                  style={{ padding: "3px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer",
                    background: manualApproved ? T.greenDim : T.surface,
                    color: manualApproved ? T.green : T.muted,
                    border: `1px solid ${manualApproved ? T.green + "44" : T.border}`,
                  }}>
                  {manualApproved ? "Approved" : "Approve"}
                </button>
              </div>
            );
          })}
        </div>
      </div>


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
                const amount = parseFloat(pmAmount) || 0;
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
              const statusStyle = { pending: { bg: T.amberDim, color: T.amber }, paid: { bg: "#0e3d24", color: "#34c97a" }, void: { bg: "#3d1212", color: "#f05353" } };
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
                    }} style={{
                      padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 600, border: "none", cursor: "pointer",
                      background: display.bg, color: display.color,
                    }}>{p.status === "pending" ? "pending" : p.status === "paid" ? "paid" : "void"}</button>
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

"use client";
import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";

type Alert = {
  priority: number;
  type: string;
  label: string;
  bg: string;
  color: string;
  action: string;
  jobId: string;
  jobTitle: string;
  clientName: string;
  invoiceNumber: string | null;
  jobNumber: string;
  shipDate: string | null;
  href: string;
  detail?: string;
  column: "sales" | "production";
  contacts?: { name: string; email: string; role?: string }[];
  vendors?: string[];
};

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export function CommandCenter({ alerts, stats }: {
  alerts: Alert[];
  stats: { active: number; sales: number; production: number; shippingThisWeek: number };
}) {
  const [emailModal, setEmailModal] = useState<{ type: string; jobId: string; contacts: any[]; subject: string; vendor?: string } | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<{ jobId: string; jobTitle: string; clientName: string; currentNumber: string | null } | null>(null);
  const [invoiceInput, setInvoiceInput] = useState("");
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [noContactWarn, setNoContactWarn] = useState<{ href: string; label: string } | null>(null);

  useEffect(() => { if (window.innerWidth < 768) setIsMobile(true); }, []);

  const salesAlerts = alerts.filter(a => a.column === "sales");
  const prodAlerts = alerts.filter(a => a.column === "production");

  function handleAction(alert: Alert) {
    // Invoice modal
    if (alert.type === "create_invoice") {
      setInvoiceModal({
        jobId: alert.jobId,
        jobTitle: alert.jobTitle,
        clientName: alert.clientName,
        currentNumber: alert.invoiceNumber,
      });
      setInvoiceInput(alert.invoiceNumber || "");
      return;
    }

    // Email actions — check contacts first
    if (alert.type === "send_quote") {
      if (!alert.contacts?.length) {
        setNoContactWarn({ href: `/jobs/${alert.jobId}?tab=quote`, label: "send this quote" });
        return;
      }
      setEmailModal({
        type: "quote",
        jobId: alert.jobId,
        contacts: alert.contacts,
        subject: `Quote — ${alert.clientName} · ${alert.jobTitle}`,
      });
      return;
    }
    if (alert.type === "send_invoice") {
      if (!alert.contacts?.length) {
        setNoContactWarn({ href: `/jobs/${alert.jobId}?tab=payment`, label: "send this invoice" });
        return;
      }
      setEmailModal({
        type: "invoice",
        jobId: alert.jobId,
        contacts: alert.contacts,
        subject: `Invoice — ${alert.clientName} · ${alert.jobTitle}`,
      });
      return;
    }

    // Navigate for everything else (upload_proofs, proofs_pending, revision, overdue, production alerts)
    window.location.href = alert.href;
  }

  async function saveInvoiceNumber() {
    if (!invoiceModal) return;
    setInvoiceSaving(true);
    try {
      const res = await fetch("/api/qb/invoice-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: invoiceModal.jobId, invoiceNumber: invoiceInput.trim() }),
      });
      if (res.ok) {
        setInvoiceModal(null);
        window.location.reload();
      }
    } catch {}
    setInvoiceSaving(false);
  }

  async function pushToQB() {
    if (!invoiceModal) return;
    setInvoiceSaving(true);
    try {
      const res = await fetch("/api/qb/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: invoiceModal.jobId }),
      });
      const data = await res.json();
      if (data.invoiceNumber) {
        setInvoiceModal(null);
        window.location.reload();
      }
    } catch {}
    setInvoiceSaving(false);
  }

  const renderColumn = (title: string, columnAlerts: Alert[], accent: string) => (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: accent + "22", color: accent }}>
          {columnAlerts.length}
        </span>
      </div>
      {columnAlerts.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: T.green, fontWeight: 600 }}>All clear</div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {columnAlerts.map((alert, i) => {
          const displayNum = alert.invoiceNumber || alert.jobNumber;
          const shipDays = alert.shipDate ? daysUntil(alert.shipDate) : null;
          const shipColor = shipDays !== null ? (shipDays < 0 ? T.red : shipDays <= 3 ? T.amber : T.muted) : T.faint;

          return (
            <div key={`${alert.jobId}-${alert.type}-${i}`}
              onClick={() => handleAction(alert)}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${alert.color}`,
                borderRadius: 8,
                padding: "10px 14px",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = T.card)}>
              {/* Top: Client — Project + ship date */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {alert.clientName} — {alert.jobTitle}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                  <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{displayNum}</span>
                  {shipDays !== null && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: shipColor, fontFamily: mono }}>
                      {shipDays < 0 ? `${Math.abs(shipDays)}d over` : `${shipDays}d`}
                    </span>
                  )}
                </div>
              </div>
              {/* Action label */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: alert.bg, color: alert.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {alert.label}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: alert.color }}>{alert.action}</span>
                {alert.detail && <span style={{ fontSize: 10, color: T.muted }}>{alert.detail}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, color: T.faint }}>→</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Command Center</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · {stats.active} active projects
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {alerts.filter(a => a.priority === 0).length > 0 && (
            <span style={{ padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: T.redDim, color: T.red }}>
              {alerts.filter(a => a.priority === 0).length} critical
            </span>
          )}
          {alerts.length > 0 && (
            <span style={{ padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: T.amberDim, color: T.amber }}>
              {alerts.length} action{alerts.length !== 1 ? "s" : ""}
            </span>
          )}
          {alerts.length === 0 && (
            <span style={{ padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: T.greenDim, color: T.green }}>
              All clear
            </span>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        {renderColumn("Sales", salesAlerts, T.purple)}
        {renderColumn("Production", prodAlerts, T.accent)}
      </div>

      {/* ── Invoice Number Modal ── */}
      {invoiceModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setInvoiceModal(null); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 420, maxWidth: "95vw" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Create Invoice</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>{invoiceModal.clientName} — {invoiceModal.jobTitle}</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: T.muted, display: "block", marginBottom: 4 }}>Invoice Number</label>
              <input
                value={invoiceInput}
                onChange={e => setInvoiceInput(e.target.value)}
                placeholder="Enter QB invoice #"
                autoFocus
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 16, fontFamily: mono, fontWeight: 700, outline: "none", textAlign: "center", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveInvoiceNumber} disabled={!invoiceInput.trim() || invoiceSaving}
                style={{ flex: 1, padding: "10px", borderRadius: 8, background: T.green, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!invoiceInput.trim() || invoiceSaving) ? 0.5 : 1 }}>
                {invoiceSaving ? "Saving..." : "Save Invoice #"}
              </button>
              <button onClick={pushToQB} disabled={invoiceSaving}
                style={{ flex: 1, padding: "10px", borderRadius: 8, background: T.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: invoiceSaving ? 0.5 : 1 }}>
                {invoiceSaving ? "Creating..." : "Push to QuickBooks"}
              </button>
            </div>

            <button onClick={() => setInvoiceModal(null)}
              style={{ marginTop: 8, width: "100%", padding: "8px", borderRadius: 8, background: "transparent", border: `1px solid ${T.border}`, color: T.muted, fontSize: 12, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Email Send Modal ── */}
      {emailModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setEmailModal(null); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 500, maxWidth: "95vw" }}
            onClick={e => e.stopPropagation()}>
            <SendEmailDialog
              type={emailModal.type}
              jobId={emailModal.jobId}
              contacts={emailModal.contacts}
              defaultEmail={emailModal.contacts.find((c: any) => c.role === "primary" || c.role === "billing")?.email || emailModal.contacts[0]?.email || ""}
              defaultSubject={emailModal.subject}
              vendor={emailModal.vendor}
              onClose={() => setEmailModal(null)}
              onSent={() => { setEmailModal(null); window.location.reload(); }}
            />
          </div>
        </div>
      )}

      {/* ── No Contacts Warning ── */}
      {noContactWarn && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setNoContactWarn(null); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 380, maxWidth: "95vw", textAlign: "center" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>!</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Add an email address</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 20, lineHeight: 1.5 }}>
              This project has no email contacts. Add one to {noContactWarn.label}.
            </div>
            <button
              onClick={() => { window.location.href = noContactWarn.href; }}
              style={{ width: "100%", padding: "10px", borderRadius: 8, background: T.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Go to project
            </button>
            <button onClick={() => setNoContactWarn(null)}
              style={{ marginTop: 8, width: "100%", padding: "8px", borderRadius: 8, background: "transparent", border: `1px solid ${T.border}`, color: T.muted, fontSize: 12, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

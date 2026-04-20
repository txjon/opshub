"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
import { SendEmailDialog } from "@/components/SendEmailDialog";

type Alert = {
  priority: number;
  type: string;
  color: string;
  action: string;
  notes?: string | null;
  jobId: string;
  jobTitle: string;
  clientName: string;
  invoiceNumber: string | null;
  jobNumber: string;
  shipDate: string | null;
  href: string;
  column: "sales" | "production" | "billing";
  contacts?: { name: string; email: string; role?: string }[];
  vendors?: string[];
};

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

type KpiListItem = {
  key: string;
  clientName: string;
  jobTitle: string;
  jobNumber: string;
  subtitle?: string;
  href: string;
};

export function CommandCenter({ alerts, stats }: {
  alerts: Alert[];
  stats: {
    active: number; items: number; units: number; prints: number; sales: number; production: number; billing: number; shippingThisWeek: number;
    needsBlanks: number; needsPO: number; needsProofs: number;
    atDecorator: number; shipped: number; stalled: number; awaitingClient: number;
    decoratorCounts: Record<string, number>;
    pipelineLists?: {
      needsBlanks: KpiListItem[]; needsPO: KpiListItem[]; needsProofs: KpiListItem[];
      atDecorator: KpiListItem[]; shipped: KpiListItem[]; stalled: KpiListItem[]; awaitingClient: KpiListItem[];
    };
  };
}) {
  const router = useRouter();
  const [openKpi, setOpenKpi] = useState<string | null>(null);
  const [emailModal, setEmailModal] = useState<{ type: string; jobId: string; contacts: any[]; subject: string; vendor?: string } | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<{ jobId: string; jobTitle: string; clientName: string; currentNumber: string | null } | null>(null);
  const [invoiceInput, setInvoiceInput] = useState("");
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [noContactWarn, setNoContactWarn] = useState<{ href: string; label: string } | null>(null);
  const isMobile = useIsMobile();

  // Auto-refresh: poll every 45s while visible + on visibility change (catches portal/webhook state changes)
  useEffect(() => {
    let lastRefresh = Date.now();
    const doRefresh = () => { lastRefresh = Date.now(); router.refresh(); };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh > 30000) doRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") doRefresh();
    }, 45000);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [router]);

  const salesAlerts = alerts.filter(a => a.column === "sales");
  const prodAlerts = alerts.filter(a => a.column === "production");
  const billingAlerts = alerts.filter(a => a.column === "billing");

  function handleAction(alert: Alert) {
    // Invoice modal
    if (alert.type === "create_invoice") {
      setInvoiceModal({
        jobId: alert.jobId, jobTitle: alert.jobTitle,
        clientName: alert.clientName, currentNumber: alert.invoiceNumber,
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
        type: "quote", jobId: alert.jobId, contacts: alert.contacts,
        subject: `Quote — ${alert.clientName} · ${alert.jobTitle}`,
      });
      return;
    }
    // send_invoice navigates to merged Proofs & Invoice tab (has Send Invoice, Invoice + Proofs, Send Proofs buttons)
    // follow_up_payment also navigates there

    // Everything else navigates
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
      if (res.ok) { setInvoiceModal(null); router.refresh(); }
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
      if (data.invoiceNumber) { setInvoiceModal(null); router.refresh(); }
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
                background: T.card, border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${alert.color}`,
                borderRadius: 8, padding: "12px 14px",
                cursor: "pointer", transition: "background 0.1s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = T.card)}>

              {/* Line 1: Client — Project */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 3, gap: 8 }}>
                <span style={{
                  fontSize: 13, fontWeight: 700, color: T.text, flex: 1, minWidth: 0,
                  ...(isMobile
                    ? { wordBreak: "break-word" as const, lineHeight: 1.3 }
                    : { overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const }),
                }}>
                  {alert.clientName} — {alert.jobTitle}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{displayNum}</span>
                  {shipDays !== null && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: shipColor, fontFamily: mono }}>
                      {shipDays < 0 ? `${Math.abs(shipDays)}d over` : `${shipDays}d`}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: T.faint }}>→</span>
                </span>
              </div>

              {/* Line 2: Action */}
              <div style={{ fontSize: 12, fontWeight: 600, color: alert.color, lineHeight: 1.3 }}>
                {alert.action}
              </div>

              {/* Line 3: Client notes (for rejections/revisions) */}
              {alert.notes && (
                <div style={{
                  marginTop: 6, padding: "6px 10px",
                  background: T.surface, borderRadius: 6,
                  borderLeft: `2px solid ${alert.color}`,
                  fontSize: 11, color: T.muted, fontStyle: "italic", lineHeight: 1.4,
                  overflow: "hidden", textOverflow: "ellipsis",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
                }}>
                  &ldquo;{alert.notes}&rdquo;
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", marginBottom: 16, flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 0 }}>
        <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 12 : 20, flexDirection: isMobile ? "column" : "row", width: isMobile ? "100%" : "auto" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Command Center</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : "repeat(4, auto)", gap: isMobile ? 6 : 12, width: isMobile ? "100%" : "auto" }}>
            {[
              { label: "Projects", value: stats.active, color: T.accent },
              { label: "Items", value: stats.items, color: T.blue },
              { label: "Units", value: stats.units.toLocaleString(), color: T.blue },
              { label: "Prints", value: stats.prints.toLocaleString(), color: T.purple },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: isMobile ? "6px 8px" : "6px 14px", textAlign: "center", minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800, color: kpi.color, fontFamily: mono }}>{kpi.value}</div>
                <div style={{ fontSize: 9, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{kpi.label}</div>
              </div>
            ))}
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

      {/* Pipeline summary */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {([
          { id: "needsBlanks",    label: "Needs Blanks",    value: stats.needsBlanks,    color: stats.needsBlanks > 0 ? T.amber : T.faint,   list: stats.pipelineLists?.needsBlanks },
          { id: "needsPO",        label: "Needs PO",        value: stats.needsPO,        color: stats.needsPO > 0 ? T.amber : T.faint,       list: stats.pipelineLists?.needsPO },
          { id: "needsProofs",    label: "Awaiting Proofs", value: stats.needsProofs,    color: stats.needsProofs > 0 ? T.amber : T.faint,   list: stats.pipelineLists?.needsProofs },
          { id: "atDecorator",    label: "At Decorator",    value: stats.atDecorator,    color: stats.atDecorator > 0 ? T.blue : T.faint,    list: stats.pipelineLists?.atDecorator },
          { id: "shipped",        label: "Shipped",         value: stats.shipped,        color: stats.shipped > 0 ? T.green : T.faint,       list: stats.pipelineLists?.shipped },
          { id: "stalled",        label: "Stalled 7d+",     value: stats.stalled,        color: stats.stalled > 0 ? T.red : T.faint,         list: stats.pipelineLists?.stalled },
          { id: "awaitingClient", label: "Awaiting Client", value: stats.awaitingClient, color: stats.awaitingClient > 0 ? T.muted : T.faint, list: stats.pipelineLists?.awaitingClient },
        ] as const).map(s => {
          const hasList = (s.list?.length ?? 0) > 0;
          const isOpen = openKpi === s.id;
          return (
            <div
              key={s.label}
              onMouseEnter={() => { if (!isMobile && hasList) setOpenKpi(s.id); }}
              onMouseLeave={() => { if (!isMobile) setOpenKpi(null); }}
              onClick={() => { if (isMobile && hasList) setOpenKpi(isOpen ? null : s.id); }}
              style={{
                flex: 1, minWidth: 90, background: T.card,
                border: `1px solid ${isOpen ? T.accent : T.border}`,
                borderRadius: 8, padding: "8px 10px", textAlign: "center",
                cursor: hasList ? "pointer" : "default",
                position: "relative",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: mono }}>{s.value}</div>
              <div style={{ fontSize: 8, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{s.label}</div>

              {isOpen && hasList && (
                <KpiPopup
                  items={s.list!}
                  label={s.label}
                  accent={s.color}
                  onNavigate={(href) => { setOpenKpi(null); router.push(href); }}
                  onClose={() => setOpenKpi(null)}
                  isMobile={isMobile}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Decorator breakdown */}
      {Object.keys(stats.decoratorCounts).length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>At Decorators:</span>
          {Object.entries(stats.decoratorCounts).sort((a, b) => b[1] - a[1]).map(([vendor, count]) => (
            <span key={vendor} style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 99, background: T.blueDim, color: "#3a8a9e" }}>
              {vendor} {count}
            </span>
          ))}
        </div>
      )}

      {/* Three-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        {renderColumn("Sales", salesAlerts, T.purple)}
        {renderColumn("Production", prodAlerts, T.accent)}
      </div>
      {billingAlerts.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {renderColumn("Billing", billingAlerts, T.amber)}
        </div>
      )}

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
              <input value={invoiceInput} onChange={e => setInvoiceInput(e.target.value)}
                placeholder="Enter QB invoice #" autoFocus
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 16, fontFamily: mono, fontWeight: 700, outline: "none", textAlign: "center", boxSizing: "border-box" }} />
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
              type={emailModal.type} jobId={emailModal.jobId}
              contacts={emailModal.contacts}
              defaultEmail={emailModal.contacts.find((c: any) => c.role === "primary" || c.role === "billing")?.email || emailModal.contacts[0]?.email || ""}
              defaultSubject={emailModal.subject} vendor={emailModal.vendor}
              onClose={() => setEmailModal(null)}
              onSent={() => { setEmailModal(null); router.refresh(); }} />
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
            <button onClick={() => { window.location.href = noContactWarn.href; }}
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

// ── KPI Popup ─────────────────────────────────────────────────
// Hover-triggered (desktop) / tap-triggered (mobile) list of projects
// contributing to a pipeline KPI. Each row links to the relevant tab.
function KpiPopup({
  items,
  label,
  accent,
  onNavigate,
  onClose,
  isMobile,
}: {
  items: KpiListItem[];
  label: string;
  accent: string;
  onNavigate: (href: string) => void;
  onClose: () => void;
  isMobile: boolean;
}) {
  const mobileStyle: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center",
  };
  const mobileSheet: React.CSSProperties = {
    width: "100%", maxWidth: 480, maxHeight: "75vh",
    background: T.card, borderRadius: "12px 12px 0 0",
    display: "flex", flexDirection: "column",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
  };
  const desktopStyle: React.CSSProperties = {
    position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
    minWidth: 280, maxWidth: 360, maxHeight: 320,
    background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    zIndex: 100, display: "flex", flexDirection: "column",
    textAlign: "left",
  };

  const body = (
    <>
      <div style={{
        padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: T.text, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
          <span style={{ fontSize: 10, color: T.faint }}>{items.length}</span>
        </div>
        {isMobile && (
          <button onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ background: "none", border: "none", fontSize: 18, color: T.muted, cursor: "pointer", padding: 0, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {items.map(it => (
          <button
            key={it.key}
            onClick={(e) => { e.stopPropagation(); onNavigate(it.href); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              background: "transparent", border: "none",
              padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
              cursor: "pointer", fontFamily: "inherit", color: T.text,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {it.clientName} — {it.jobTitle}
              </span>
              <span style={{ fontSize: 10, color: T.faint, fontFamily: mono, flexShrink: 0 }}>{it.jobNumber}</span>
            </div>
            {it.subtitle && (
              <div style={{ fontSize: 11, color: T.muted, marginTop: 3, lineHeight: 1.3 }}>{it.subtitle}</div>
            )}
          </button>
        ))}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div style={mobileStyle} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <div style={mobileSheet} onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }

  return (
    <div style={desktopStyle} onClick={(e) => e.stopPropagation()}>
      {body}
    </div>
  );
}

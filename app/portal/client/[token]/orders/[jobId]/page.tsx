"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useIsMobile } from "@/lib/useIsMobile";
import { parseDay, daysUntilDay } from "@/lib/dates";
import { StatusPill } from "../../_shared/StatusPill";

// Per-order detail view inside the Client Hub. Clone of /portal/[token]
// with these changes:
//   - Top bar + left project sidebar removed (Shell handles nav)
//   - Fetches from /api/portal/client/{token}/orders/{jobId}
//   - PDF URLs use jobPortalToken returned by the new API (the PDF routes
//     themselves still auth against jobs.portal_token).

const C = {
  bg: "#f8f8f9",
  card: "#ffffff",
  surface: "#f3f3f5",
  border: "#e0e0e4",
  text: "#1a1a1a",
  muted: "#6b6b78",
  faint: "#a0a0ad",
  accent: "#1a1a1a",
  accentBg: "#f0f0f2",
  green: "#1a8c5c",
  greenBg: "#edf7f2",
  greenBorder: "#b4dfc9",
  amber: "#b45309",
  amberBg: "#fef9ee",
  amberBorder: "#f5dfa8",
  red: "#c43030",
  redBg: "#fdf2f2",
  redBorder: "#f0c0c0",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'IBM Plex Mono', Menlo, monospace",
};

const fmtD = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Date-only values (item ETAs) split-parse as local via parseDay; full
// timestamps (quote/proof approved_at) go through new Date(). Bare
// new Date("YYYY-MM-DD") rendered the previous day in US timezones.
const asLocalDate = (iso: string) => (iso.includes("T") ? new Date(iso) : parseDay(iso));
const fmtDate = (iso: string) => {
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};
// Short date for per-item ETAs in the Items list — drops the year so
// the chip stays compact (most ETAs are near-term).
const fmtDateShort = (iso: string) => {
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
};
// Countdown for per-item ETAs. Returns the color-tinted countdown text
// (e.g. "5d", "today", "2d overdue") or null if no date. Same calendar-day
// math as the shared portal daysUntil.
function etaCountdown(iso: string | null): { text: string; color: string } | null {
  const diff = daysUntilDay(iso);
  if (diff === null) return null;
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red };
  if (diff === 0) return { text: "today", color: C.red };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber };
  return { text: `${diff}d`, color: C.muted };
}
const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

type PortalData = {
  jobPortalToken: string;
  project: {
    id: string; title: string; jobNumber: string; phase: string; phaseLabel: string;
    shipDate: string | null; quoteApproved: boolean; quoteApprovedAt: string | null;
    paymentTerms: string | null;
  };
  client: { name: string };
  quote: { items: any[]; subtotal: number; tax: number; total: number };
  invoiceStale: boolean;
  items: { id: string; name: string; qty: number; status: import("@/lib/item-status").ItemState; eta: string | null; eta_tbd?: boolean; eta_note: string | null; proofs: any[] }[];
  payments: { id: string; type: string; amount: number; status: string; dueDate: string | null; paidDate: string | null; invoiceNumber: string | null }[];
  paymentLink: string | null;
  invoiceNumber: string | null;
  activity: { message: string; date: string }[];
  shipments?: {
    decoratorId: string | null; tracking: string; itemCount: number; forwardTracking?: string;
    // live carrier feed (when the shipment has a tracker)
    carrier?: string | null; carrierStatus?: string | null;
    estDelivery?: string | null; deliveredAt?: string | null; lastScanLocation?: string | null;
  }[];
};

const PHASE_STEPS = [
  { key: "quote", label: "Quote" },
  { key: "approved", label: "Approved" },
  { key: "production", label: "In Production" },
  { key: "shipping", label: "Shipping" },
  { key: "complete", label: "Complete" },
];

// Default export = the standalone /portal/client/[token]/orders/[jobId]
// route. Wraps the shared view component so deep links / bookmarks keep
// working. The Orders tab uses OrderDetailView directly in a modal.
export default function ClientHubOrderDetail({ params }: { params: { token: string; jobId: string } }) {
  return <OrderDetailView token={params.token} jobId={params.jobId} />;
}

// Reusable view — used by the standalone route AND by the Orders tab
// modal. Pass `onClose` to render as a modal (Close button top-right, no
// back link); omit it to render as the standalone page (back link at
// top-left).
export function OrderDetailView({ token, jobId, onClose, suppressOwnChrome }: { token: string; jobId: string; onClose?: () => void; suppressOwnChrome?: boolean }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState<Record<string, string>>({});
  const [showRevisionInput, setShowRevisionInput] = useState<string | null>(null);
  const [showQuoteReject, setShowQuoteReject] = useState(false);
  const [quoteRejectNote, setQuoteRejectNote] = useState("");
  const [viewingProof, setViewingProof] = useState<any>(null);
  // PDF preview modal — full-screen viewer for invoice, quote, packing
  // slip, etc. Same chrome the proof viewer uses (sticky header with
  // title · Download · Close, white viewport body) so the client sees
  // one consistent pattern for every document. downloadHref optional —
  // when omitted the Download button is hidden.
  const [pdfPreview, setPdfPreview] = useState<{ src: string; title: string; downloadHref?: string; downloadName?: string } | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, jobId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${token}/orders/${jobId}`);
      if (!res.ok) {
        setError("This link is no longer valid.");
        return;
      }
      const d = await res.json();
      setData(d);
    } catch {
      setError("Unable to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function doAction(action: string, extra?: Record<string, any>) {
    const key = action + (extra?.fileId || "");
    setActionLoading(key);
    try {
      const res = await fetch(`/api/portal/client/${token}/orders/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        await load();
        setShowRevisionInput(null);
      }
    } catch {}
    setActionLoading(null);
  }

  if (loading) {
    return <div style={{ padding: 40, color: C.muted, fontFamily: C.font, fontSize: 14 }}>Loading...</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 40, fontFamily: C.font, textAlign: "center" }}>
        <div style={{ fontSize: 36, opacity: 0.3 }}>🔒</div>
        <div style={{ color: C.text, fontSize: 16, fontWeight: 600, marginTop: 10 }}>{error || "Not found"}</div>
        {onClose ? (
          <button onClick={onClose} style={{ display: "inline-block", marginTop: 16, color: C.accent, fontSize: 13, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontFamily: C.font }}>
            Close
          </button>
        ) : (
          <Link href={`/portal/client/${token}/orders`} style={{ display: "inline-block", marginTop: 16, color: C.accent, fontSize: 13, textDecoration: "underline" }}>
            ← Back to Orders
          </Link>
        )}
      </div>
    );
  }

  const { project, client, quote, items, payments, paymentLink, invoiceNumber, invoiceStale, activity, jobPortalToken, shipments = [] } = data;

  const totalPaid = payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const balance = (quote.total || 0) - totalPaid;
  const hasQuote = quote.items.length > 0;
  const actualProofs = items.flatMap(i => i.proofs.filter(p => p.stage === "proof"));
  // Section visibility — show when items have ANY visual file
  // (mockup OR proof). Previously this gated on actualProofs only,
  // which hid the section entirely for items that only had mockups
  // attached + internal artwork_status approval (Jon's common flow).
  const hasVisuals = items.some(i => i.proofs.length > 0);
  // Approval-flow state is still proof-driven: only formal proofs
  // have a pending → approved cycle. hasProofs gates the pay-online
  // "approve-before-pay" prompt (mockup-only items don't trigger it).
  const hasProofs = actualProofs.length > 0;
  const allProofsApproved = hasProofs && actualProofs.every(p => p.approval === "approved");
  const pendingProofCount = actualProofs.filter(p => p.approval === "pending").length;

  const phaseOrder = ["quote", "approved", "production", "shipping", "complete"];
  const phaseToStep: Record<string, string> = {
    intake: "quote", pending: "quote",
    ready: "approved",
    production: "production",
    receiving: "shipping", shipping: "shipping", fulfillment: "shipping",
    complete: "complete",
  };
  const currentStep = phaseToStep[project.phase] || "quote";
  const currentIdx = phaseOrder.indexOf(currentStep);

  return (
    <div style={{ fontFamily: C.font, color: C.text, maxWidth: 800, margin: "0 auto" }}>
      {/* Top bar: Back link when standalone, Close button when modal.
          Suppressed when the wrapping shell provides its own chrome
          (full-page modal in the Orders tab — the shell's header bar
          owns the close action so a second button would be redundant). */}
      {!suppressOwnChrome && (onClose ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button
            onClick={onClose}
            style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.text,
              cursor: "pointer", padding: "8px 20px", fontFamily: C.font,
            }}>
            Close
          </button>
        </div>
      ) : (
        <Link href={`/portal/client/${token}/orders`} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 12, color: C.muted, textDecoration: "none", marginBottom: 16,
        }}>
          ← All orders
        </Link>
      ))}

      {/* ── Project Header ── headline is the invoice # once issued,
            else the OpsHub job number. Project memo (title) dropped
            per Jon's call — the invoice/job ref is the recognized
            identifier. Subtitle = client name. Est. ship date moved
            into the per-item ETAs in the Items list below. */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.2 }}>
          {invoiceNumber
            ? `Invoice #${invoiceNumber}`
            : (project.jobNumber || project.title || "Order")}
        </h1>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 500, marginTop: 4 }}>
          {client.name}
        </div>
      </div>

      {/* ── Items list ── At-a-glance per-item state. Mirrors the
            hover summary on the orders list: item name, total qty,
            canonical status pill. Always visible regardless of quote
            status (Quote section may still be empty pre-send). */}
      {items.length > 0 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
        }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>
            Items {items.length > 0 && <span style={{ fontWeight: 400, color: C.faint }}>· {items.length}</span>}
          </h2>
          {/* On phones the 4-col grid (96+96+120 = 312px of fixed
              columns) collapses the name column to nothing. CSS
              below flips to a 2-row stack at <640px: name on top,
              qty · ETA · status laid out on a second row. */}
          <style>{`
            @media (max-width: 640px) {
              .order-items-row {
                grid-template-columns: 1fr !important;
                gap: 4px !important;
                padding: 12px 0 !important;
              }
              .order-items-row__name {
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: clip !important;
              }
              .order-items-row__meta {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: baseline !important;
                gap: 12px !important;
                margin-top: 4px !important;
              }
              .order-items-row__meta > * { text-align: left !important; min-width: 0 !important; }
              .order-items-row__meta .order-items-row__eta { align-items: flex-start !important; }
            }
            .order-items-row__meta { display: contents; }
          `}</style>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {items.map(it => {
              const cd = etaCountdown(it.eta);
              return (
                <div key={it.id} className="order-items-row" style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 96px 96px 120px",
                  alignItems: "center", gap: 14,
                  padding: "10px 0",
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  {/* Item name — wraps freely, takes remaining space. */}
                  <span className="order-items-row__name" style={{
                    minWidth: 0,
                    fontSize: 14, fontWeight: 600, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{it.name || "Item"}</span>
                  {/* Meta cells — render as grid columns on desktop
                      (display:contents hands them off to the parent
                      grid). On mobile the CSS above flips this wrap
                      to a flex row beneath the name so qty / ETA /
                      status sit on a second line without crushing
                      the name column. */}
                  <span className="order-items-row__meta">
                    {/* Qty */}
                    <span style={{ fontSize: 12, color: C.muted, fontFamily: C.mono, whiteSpace: "nowrap", textAlign: "right" }}>
                      {it.qty > 0 ? `${it.qty.toLocaleString()} ${it.qty === 1 ? "pc" : "pcs"}` : "—"}
                    </span>
                    {/* ETA */}
                    <span className="order-items-row__eta" style={{
                      display: "inline-flex", flexDirection: "column",
                      alignItems: "flex-end", gap: 1,
                    }}>
                      {it.eta ? (
                        <>
                          <span style={{ fontSize: 12, color: C.text, fontFamily: C.mono, whiteSpace: "nowrap" }}>
                            {fmtDateShort(it.eta)}
                          </span>
                          {cd && (
                            <span style={{ fontSize: 9, color: cd.color, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                              {cd.text}
                            </span>
                          )}
                        </>
                      ) : it.eta_tbd ? (
                        <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.05em" }}>TBD</span>
                      ) : (
                        <span style={{ fontSize: 12, color: C.faint, fontFamily: C.mono }}>—</span>
                      )}
                    </span>
                    {/* Status */}
                    <span style={{ textAlign: "left" }}>
                      <StatusPill status={it.status} size="sm" />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Phase progress bar removed 2026-05-17 — replaced by per-item
          status pills on the Quote section's line items. The single
          project-phase indicator collapsed multi-item orders into one
          state, which lied when items were at different stages. */}

      {/* ── Payment Section ── */}
      {invoiceNumber && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
        }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Payment</h2>

          {/* Meta blocks (Total · Paid · Balance Due) in their own
              wrap row so they line up cleanly on every width. The
              View Invoice button gets its own row below — full-width
              on mobile, right-aligned on desktop. Avoids the awkward
              "button alone on wrapped line with flex gap" case. */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: isMobile ? 16 : 24, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Total</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtD(quote.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Paid</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{fmtD(totalPaid)}</div>
            </div>
            {balance > 0 && !invoiceStale && (
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Balance Due</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.red }}>{fmtD(balance)}</div>
              </div>
            )}
          </div>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: isMobile ? "stretch" : "flex-end" }}>
            <button
              onClick={() => setPdfPreview({
                src: `/api/pdf/invoice/${project.id}?portal=${jobPortalToken}`,
                title: `Invoice #${invoiceNumber}`,
                downloadHref: `/api/pdf/invoice/${project.id}?portal=${jobPortalToken}&download=1`,
                downloadName: `invoice-${invoiceNumber}.pdf`,
              })}
              style={{
                fontSize: 13, color: "#fff", fontWeight: 700,
                background: C.accent, border: "none", borderRadius: 6,
                padding: "10px 20px", cursor: "pointer",
                whiteSpace: "nowrap", fontFamily: C.font,
                width: isMobile ? "100%" : "auto",
              }}>
              View Invoice #{invoiceNumber}
            </button>
          </div>

          {invoiceStale ? (
            <div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: C.muted, background: C.surface, borderRadius: 8 }}>
              Your invoice is being updated — you'll be notified when it's ready.
            </div>
          ) : paymentLink && balance > 0 && (
            hasProofs && !allProofsApproved ? (
              <button onClick={async () => {
                await doAction("approve-all-proofs");
                window.open(paymentLink, "_blank");
              }}
                disabled={!!actionLoading}
                style={{
                  display: "block", textAlign: "center", width: "100%",
                  padding: "14px 0", borderRadius: 10, border: "none", cursor: "pointer",
                  background: C.accent, color: "#fff",
                  fontSize: 15, fontWeight: 700, opacity: actionLoading ? 0.6 : 1,
                }}>
                Approve &amp; Pay Now — {fmtD(balance)}
              </button>
            ) : (
              <a href={paymentLink} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "block", textAlign: "center", width: "100%",
                  padding: "14px 0", borderRadius: 10, textDecoration: "none",
                  background: C.accent, color: "#fff",
                  fontSize: 15, fontWeight: 700,
                }}>
                Pay Now — {fmtD(balance)}
              </a>
            )
          )}

          {payments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>History</div>
              {payments.map(p => (
                <div key={p.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13,
                }}>
                  <div>
                    <span style={{ fontWeight: 500 }}>{p.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                    {p.invoiceNumber && <span style={{ color: C.faint, marginLeft: 8, fontSize: 11 }}>#{p.invoiceNumber}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{fmtD(p.amount)}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                      color: p.status === "paid" ? C.green : p.status === "overdue" ? C.red : C.amber,
                    }}>
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {project.paymentTerms && (
            <div style={{ fontSize: 11, color: C.faint, marginTop: 12 }}>
              Terms: {project.paymentTerms.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </div>
          )}
        </div>
      )}

      {/* ── Shipments Section — packing slip downloads ──
          One row per (decoratorId + tracking) pair. Vendor name
          intentionally not shown (drop_ship anonymity). */}
      {shipments.length > 0 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Shipments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shipments.map((s, i) => (
              <div key={`${s.decoratorId || ""}__${s.tracking}__${i}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    Shipment {shipments.length > 1 ? `#${i + 1}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Tracking: <span style={{ fontFamily: "'SF Mono',Menlo,monospace" }}>{s.tracking}</span>
                    <span style={{ color: C.faint, margin: "0 6px" }}>·</span>
                    {s.itemCount} item{s.itemCount !== 1 ? "s" : ""}
                  </div>
                  {/* live carrier status — only when the shipment has a tracker feed */}
                  {(() => {
                    if (s.deliveredAt) {
                      return (
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginTop: 4 }}>
                          ✓ Delivered {fmtDateShort(s.deliveredAt)}
                        </div>
                      );
                    }
                    if (s.carrierStatus === "out_for_delivery") {
                      return (
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginTop: 4 }}>
                          Out for delivery{s.lastScanLocation ? ` · ${s.lastScanLocation}` : ""}
                        </div>
                      );
                    }
                    if (s.carrierStatus === "in_transit" || s.carrierStatus === "pre_transit") {
                      const est = s.estDelivery ? ` — estimated arrival ${fmtDateShort(s.estDelivery)}` : "";
                      const scan = s.lastScanLocation ? ` · last scan ${s.lastScanLocation}` : "";
                      return (
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.blue, marginTop: 4 }}>
                          {s.carrierStatus === "pre_transit" ? "Label created — awaiting pickup" : `In transit${est}${scan}`}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <button
                  onClick={() => {
                    const params = new URLSearchParams({ portal: jobPortalToken });
                    if (s.forwardTracking) {
                      params.set("forwardTracking", s.forwardTracking);
                    } else {
                      if (s.decoratorId) params.set("decoratorId", s.decoratorId);
                      if (s.tracking) params.set("tracking", s.tracking);
                    }
                    const base = `/api/pdf/packing-slip/${project.id}?${params.toString()}`;
                    setPdfPreview({
                      src: base,
                      title: `Packing slip · ${s.tracking}`,
                      downloadHref: `${base}&download=1`,
                      downloadName: `packing-slip-${s.tracking}.pdf`,
                    });
                  }}
                  style={{
                    fontSize: 13, color: "#fff", fontWeight: 700,
                    background: C.accent, border: "none", borderRadius: 6,
                    padding: "10px 20px", cursor: "pointer", flexShrink: 0,
                    whiteSpace: "nowrap", fontFamily: C.font,
                  }}>
                  View packing slip
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quote Section ── */}
      {hasQuote && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "24px 28px", marginBottom: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Quote</h2>
            {project.quoteApproved ? (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                color: C.green,
              }}>Approved {project.quoteApprovedAt ? fmtDate(project.quoteApprovedAt) : ""}</span>
            ) : (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                color: C.amber,
              }}>Awaiting Approval</span>
            )}
          </div>

          <div style={{ borderTop: `2px solid ${C.text}`, marginTop: 8 }}>
            <div style={{ display: "flex", padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>
              <div style={{ width: 28 }}></div>
              <div style={{ flex: 1 }}>Item</div>
              <div style={{ width: 120, textAlign: "center" }}>Sizes</div>
              <div style={{ width: 50, textAlign: "right" }}>Qty</div>
              <div style={{ width: 80, textAlign: "right" }}>Unit Price</div>
              <div style={{ width: 90, textAlign: "right" }}>Subtotal</div>
            </div>
            {quote.items.map((qi: any, i: number) => {
              const sizeEntries = (qi.sizes || []).map((sz: string) => ({ sz, qty: qi.qtys?.[sz] || 0 })).filter((e: any) => e.qty > 0);
              const letter = String.fromCharCode(65 + i);
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", padding: "14px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ width: 28, fontSize: 10, fontWeight: 700, color: C.faint, paddingTop: 2 }}>{letter}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{qi.name}</div>
                    {(qi.style || qi.color) && (
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                        {qi.style && <span>{qi.style}</span>}
                        {qi.color && <div style={{ color: C.faint }}>{qi.color}</div>}
                      </div>
                    )}
                    {/* Per-item canonical status — same vocabulary as
                        the Items tab + item modal. Replaces the
                        single project-phase progress bar that used to
                        sit at the top of this view. */}
                    {qi.status && (
                      <div style={{ marginTop: 6 }}>
                        <StatusPill status={qi.status} size="sm" />
                      </div>
                    )}
                  </div>
                  <div style={{ width: 120, display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center", paddingTop: 2 }}>
                    {sizeEntries.map((e: any) => (
                      <span key={e.sz} style={{ fontSize: 10, color: C.muted, fontFamily: C.mono, whiteSpace: "nowrap" }}>
                        {e.sz} {e.qty}
                      </span>
                    ))}
                  </div>
                  <div style={{ width: 50, textAlign: "right", fontSize: 13, fontWeight: 600, fontFamily: C.mono, paddingTop: 2 }}>{qi.qty}</div>
                  <div style={{ width: 80, textAlign: "right", fontSize: 13, color: C.muted, fontFamily: C.mono, paddingTop: 2 }}>{fmtD(qi.sellPerUnit)}</div>
                  <div style={{ width: 90, textAlign: "right", fontSize: 14, fontWeight: 700, fontFamily: C.mono, paddingTop: 2 }}>{fmtD(qi.total)}</div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: `2px solid ${C.text}`, paddingTop: 16, marginTop: 4, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Subtotal</span>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: C.mono }}>{fmtD(quote.subtotal)}</span>
            </div>
            {quote.tax > 0 && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Sales Tax</span>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: C.mono }}>{fmtD(quote.tax)}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Amount Due</span>
              <span style={{ fontSize: 20, fontWeight: 800, fontFamily: C.mono }}>{fmtD(quote.total)}</span>
            </div>
          </div>

          {!project.quoteApproved && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => doAction("approve-quote")}
                disabled={actionLoading === "approve-quote"}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: 10,
                  background: C.green, color: "#fff", border: "none",
                  fontSize: 15, fontWeight: 700, cursor: "pointer",
                  opacity: actionLoading === "approve-quote" ? 0.6 : 1,
                }}>
                {actionLoading === "approve-quote" ? "Approving..." : "Approve Quote"}
              </button>
              {!showQuoteReject ? (
                <button
                  onClick={() => setShowQuoteReject(true)}
                  style={{
                    width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10,
                    background: "transparent", color: C.muted, border: `1px solid ${C.border}`,
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>
                  Request Changes
                </button>
              ) : (
                <div style={{ marginTop: 10, background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>What changes are needed?</div>
                  <textarea
                    value={quoteRejectNote}
                    onChange={e => setQuoteRejectNote(e.target.value)}
                    placeholder="Describe the changes you'd like..."
                    rows={3}
                    style={{
                      width: "100%", padding: 10, borderRadius: 8,
                      border: `1px solid ${C.border}`, background: C.card, color: C.text,
                      fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => doAction("reject-quote", { note: quoteRejectNote })}
                      disabled={!quoteRejectNote.trim() || actionLoading === "reject-quote"}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 8,
                        background: C.red, color: "#fff", border: "none",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                        opacity: (!quoteRejectNote.trim() || actionLoading === "reject-quote") ? 0.5 : 1,
                      }}>
                      {actionLoading === "reject-quote" ? "Sending..." : "Submit Changes"}
                    </button>
                    <button
                      onClick={() => { setShowQuoteReject(false); setQuoteRejectNote(""); }}
                      style={{
                        padding: "10px 16px", borderRadius: 8,
                        background: "transparent", border: `1px solid ${C.border}`, color: C.muted,
                        fontSize: 13, cursor: "pointer",
                      }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setPdfPreview({
              src: `/api/pdf/quote/${project.id}?portal=${jobPortalToken}`,
              title: `Quote ${project.jobNumber || ""}`.trim(),
              downloadHref: `/api/pdf/quote/${project.id}?portal=${jobPortalToken}&download=1`,
              downloadName: `quote-${project.jobNumber || project.id}.pdf`,
            })}
            style={{
              display: "inline-block", marginTop: 12, padding: 0, fontSize: 12, fontWeight: 600,
              color: C.accent, background: "transparent", border: "none", cursor: "pointer",
              fontFamily: C.font,
            }}>
            View Quote PDF
          </button>
        </div>
      )}

      {/* ── Proofs / Designs Section ── */}
      {hasVisuals && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>{allProofsApproved ? "Proofs" : "Proofs for Review"}</h2>
            {allProofsApproved && (
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.green }}>All Approved</span>
            )}
            {!allProofsApproved && pendingProofCount > 0 && (
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.amber }}>{pendingProofCount} pending</span>
                <button onClick={() => doAction("approve-all-proofs")} disabled={!!actionLoading}
                  style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: C.green, color: "#fff", fontSize: 11, fontWeight: 700, opacity: actionLoading ? 0.6 : 1 }}>
                  Approve All
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.filter(i => i.proofs.length > 0).map(item => {
              const mockups = item.proofs.filter((p: any) => p.stage === "mockup");
              const proofs = item.proofs.filter((p: any) => p.stage === "proof");
              // Pick the primary visual + view target. Formal proofs
              // win when they exist (those drive the approval flow);
              // mockup-only items fall back to the mockup for both
              // the thumbnail AND the open-in-viewer action so the
              // client can still see what was made for them.
              const firstProof = proofs[0];
              const primaryVisual = firstProof || mockups[0];
              const isMockupOnly = !firstProof && !!mockups[0];
              const allApproved = proofs.length > 0 && proofs.every((p: any) => p.approval === "approved");
              // Mockup-only items inherit approval from item.artwork_status
              // (cascaded onto every file by the API). If the team marked
              // approval internally, surface "Approved" so the client
              // doesn't think the design is still in limbo.
              const mockupApproved = isMockupOnly && mockups[0].approval === "approved";
              const statusLabel = allApproved
                ? "Approved"
                : mockupApproved
                ? "Approved"
                : firstProof?.approval === "revision_requested"
                ? "Revision Requested"
                : firstProof?.approval === "pending"
                ? "Pending"
                : null;
              const statusColor = (allApproved || mockupApproved) ? C.green : C.amber;
              return (
                <div key={item.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", background: C.bg }}>
                  {/* Thumb + name on the top row, status + button on
                      the bottom row. Keeps the layout from overlapping
                      "Approved" onto wrapped item names at phone width.
                      Wraps cleanly at any size — name takes whatever
                      width's available, controls always sit beneath. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {mockups[0]?.driveFileId && (
                      <img src={`/api/files/thumbnail?id=${mockups[0].driveFileId}`} alt=""
                        onClick={() => setViewingProof(mockups[0])}
                        onError={(e: any) => { e.target.style.display = "none"; }}
                        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}`, flexShrink: 0, cursor: "pointer" }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{item.name}</div>
                      {proofs.length > 0 && (
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{proofs.length} proof{proofs.length !== 1 ? "s" : ""}</div>
                      )}
                      {isMockupOnly && (
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Mockup</div>
                      )}
                    </div>
                  </div>
                  {(statusLabel || primaryVisual?.driveFileId) && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 12, marginTop: 10, flexWrap: "wrap",
                    }}>
                      {statusLabel ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>{statusLabel}</span>
                      ) : <span />}
                      {primaryVisual?.driveFileId && (
                        <button onClick={() => setViewingProof(primaryVisual)}
                          style={{ fontSize: 13, color: "#fff", fontWeight: 700, background: C.accent, border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", flexShrink: 0 }}>
                          {firstProof ? "View Proof" : "View Mockup"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Activity Timeline ── */}
      {activity.length > 0 && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "20px 24px",
        }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Updates</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activity.map((a, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                padding: "6px 0", borderBottom: i < activity.length - 1 ? `1px solid ${C.border}` : "none",
              }}>
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.4, paddingRight: 12 }}>{a.message}</span>
                <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{timeAgo(a.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Proof Preview Modal ── */}
      {viewingProof && (
        <div style={{
          position: "fixed", inset: 0, background: "#fff", zIndex: 9999,
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            padding: "12px 20px", borderBottom: `1px solid ${C.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{viewingProof.fileName}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>
                {viewingProof.stage === "mockup" ? "Mockup" : "Product Proof"}
                {(() => { const pending = actualProofs.filter(p => p.approval === "pending"); const idx = pending.findIndex(p => p.id === viewingProof.id); return pending.length > 1 && idx >= 0 ? ` · ${idx + 1} of ${pending.length}` : ""; })()}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {viewingProof.driveFileId && (
                <a
                  href={`/api/files/view/${encodeURIComponent(viewingProof.fileName || "proof")}?id=${viewingProof.driveFileId}&download=1`}
                  download={viewingProof.fileName || true}
                  style={{
                    background: C.text, border: "none", borderRadius: 8,
                    color: "#fff", fontSize: 13, fontWeight: 700,
                    padding: "8px 18px", textDecoration: "none",
                    fontFamily: C.font, cursor: "pointer",
                  }}>
                  Download
                </a>
              )}
              <button onClick={() => { setViewingProof(null); setShowRevisionInput(null); }} style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.text, cursor: "pointer", padding: "8px 20px",
              }}>Close</button>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", background: C.bg, padding: 20 }}>
            {/\.pdf$/i.test(viewingProof.fileName) ? (
              <iframe
                src={`/api/files/view/${encodeURIComponent(viewingProof.fileName)}?id=${viewingProof.driveFileId}`}
                style={{ width: "100%", height: "100%", border: "none", borderRadius: 8 }}
              />
            ) : (
              <img
                src={`/api/files/view/${encodeURIComponent(viewingProof.fileName)}?id=${viewingProof.driveFileId}`}
                alt={viewingProof.fileName}
                style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }}
              />
            )}
          </div>

          {(viewingProof.approval === "pending" || viewingProof.approval === "revision_requested") && (
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
              {showRevisionInput === viewingProof.id ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>What changes would you like?</div>
                  <textarea value={revisionNote[viewingProof.id] || ""}
                    onChange={e => setRevisionNote(prev => ({ ...prev, [viewingProof.id]: e.target.value }))}
                    placeholder="Describe the changes..."
                    autoFocus
                    style={{ width: "100%", minHeight: 70, borderRadius: 8, border: `1px solid ${C.border}`, padding: 10, fontSize: 13, fontFamily: C.font, resize: "vertical", background: C.surface, color: C.text, boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={async () => { await doAction("request-revision", { fileId: viewingProof.id, note: revisionNote[viewingProof.id] || "" }); setViewingProof(null); }}
                      disabled={actionLoading === `request-revision${viewingProof.id}`}
                      style={{ flex: 1, padding: "10px", borderRadius: 8, background: C.red, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: actionLoading ? 0.6 : 1 }}>
                      {actionLoading ? "Sending..." : "Submit Changes"}
                    </button>
                    <button onClick={() => setShowRevisionInput(null)}
                      style={{ padding: "10px 20px", borderRadius: 8, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 13, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={async () => {
                    const currentId = viewingProof.id;
                    await doAction("approve-proof", { fileId: currentId });
                    const pending = actualProofs.filter(p => p.approval === "pending" && p.id !== currentId);
                    if (pending.length > 0) setViewingProof(pending[0]);
                    else setViewingProof(null);
                  }}
                    disabled={actionLoading === `approve-proof${viewingProof.id}`}
                    style={{ padding: "12px 32px", borderRadius: 10, background: C.green, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: actionLoading ? 0.6 : 1 }}>
                    {(() => { const remaining = actualProofs.filter(p => p.approval === "pending" && p.id !== viewingProof.id).length; return remaining > 0 ? `Approve · ${remaining} more` : "Approve"; })()}
                  </button>
                  <button onClick={() => setShowRevisionInput(viewingProof.id)}
                    style={{ padding: "12px 32px", borderRadius: 10, background: "transparent", color: C.red, border: `1px solid ${C.redBorder}`, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    Request Changes
                  </button>
                </div>
              )}
            </div>
          )}

          {viewingProof.approval === "approved" && (
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, textAlign: "center", fontSize: 14, fontWeight: 600, color: C.green }}>
              Approved {viewingProof.approvedAt ? fmtDate(viewingProof.approvedAt) : ""}
            </div>
          )}
        </div>
      )}

      {/* ── PDF preview modal ── matches the proof viewer chrome:
            full-screen white background, sticky header with title +
            Download (when downloadHref present) + Close, iframe body.
            One consistent pattern for every document the client views
            (invoice · packing slip · quote). */}
      {pdfPreview && (
        <div style={{
          position: "fixed", inset: 0, background: "#fff", zIndex: 10000,
          display: "flex", flexDirection: "column", fontFamily: C.font,
        }}>
          <div style={{
            padding: "12px 20px", borderBottom: `1px solid ${C.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pdfPreview.title}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {pdfPreview.downloadHref && (
                <a href={pdfPreview.downloadHref}
                  download={pdfPreview.downloadName || true}
                  style={{
                    background: C.text, border: "none", borderRadius: 8,
                    color: "#fff", fontSize: 13, fontWeight: 700,
                    padding: "8px 18px", textDecoration: "none",
                    fontFamily: C.font, cursor: "pointer",
                  }}>
                  Download
                </a>
              )}
              <button onClick={() => setPdfPreview(null)} style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                fontSize: 13, fontWeight: 600, color: C.text,
                cursor: "pointer", padding: "8px 20px", fontFamily: C.font,
              }}>Close</button>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", background: C.bg, padding: 20 }}>
            <iframe
              src={pdfPreview.src}
              style={{ flex: 1, border: "none", background: "#fff", borderRadius: 8 }}
              title={pdfPreview.title}
            />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useIsMobile } from "@/lib/useIsMobile";

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
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
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
  items: { id: string; name: string; proofs: any[] }[];
  payments: { id: string; type: string; amount: number; status: string; dueDate: string | null; paidDate: string | null; invoiceNumber: string | null }[];
  paymentLink: string | null;
  invoiceNumber: string | null;
  activity: { message: string; date: string }[];
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
export function OrderDetailView({ token, jobId, onClose }: { token: string; jobId: string; onClose?: () => void }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState<Record<string, string>>({});
  const [showRevisionInput, setShowRevisionInput] = useState<string | null>(null);
  const [showQuoteReject, setShowQuoteReject] = useState(false);
  const [quoteRejectNote, setQuoteRejectNote] = useState("");
  const [viewingProof, setViewingProof] = useState<any>(null);
  const [pdfPreview, setPdfPreview] = useState<{ src: string; title: string } | null>(null);
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

  const { project, client, quote, items, payments, paymentLink, invoiceNumber, invoiceStale, activity, jobPortalToken } = data;

  const totalPaid = payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const balance = (quote.total || 0) - totalPaid;
  const hasQuote = quote.items.length > 0;
  const actualProofs = items.flatMap(i => i.proofs.filter(p => p.stage === "proof"));
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
    <div style={{ fontFamily: C.font, color: C.text, maxWidth: 800 }}>
      {/* Top bar: Back link when standalone, Close button when modal.
          Close style matches the proof modal's Close button so there's
          one consistent control pattern across all modals. */}
      {onClose ? (
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
      )}

      {/* ── Project Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.2 }}>{project.title}</h1>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 500, marginTop: 4 }}>
          {client.name}
          {(invoiceNumber || project.jobNumber) && <span style={{ fontFamily: C.mono, fontSize: 12, color: C.faint }}>{"  ·  "}{invoiceNumber ? `#${invoiceNumber}` : project.jobNumber}</span>}
        </div>
        {project.shipDate && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            <span style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.04em" }}>Est. Ship Date</span>
            <span style={{ marginLeft: 8 }}>{fmtDate(project.shipDate)}</span>
          </div>
        )}
      </div>

      {/* ── Phase Progress ── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: isMobile ? "16px" : "16px 24px", marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 8 }}>
          {PHASE_STEPS.map((step, idx) => {
            const isActive = idx <= currentIdx && currentIdx >= 0;
            const isCurrent = step.key === currentStep;
            return (
              <div key={step.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{
                  height: 3, width: "100%", borderRadius: 2,
                  background: isActive ? C.accent : "#e0e0e4",
                  transition: "background 0.3s",
                }} />
                <span style={{
                  fontSize: isMobile ? 9 : 10, fontWeight: isCurrent ? 700 : 500,
                  color: isCurrent ? C.accent : isActive ? C.text : C.faint,
                }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, fontWeight: 600, color: C.accent }}>
          {PHASE_STEPS[currentIdx]?.label || project.phaseLabel}
        </div>
      </div>

      {/* ── Payment Section ── */}
      {invoiceNumber && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
        }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted }}>Payment</h2>

          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 24, flexWrap: "wrap", marginBottom: 12 }}>
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
            <button
              onClick={() => setPdfPreview({
                src: `/api/pdf/invoice/${project.id}?portal=${jobPortalToken}`,
                title: `Invoice #${invoiceNumber}`,
              })}
              style={{
                marginLeft: "auto", padding: "6px 14px", borderRadius: 6, cursor: "pointer",
                background: C.surface, color: C.text, border: `1px solid ${C.border}`,
                fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", fontFamily: C.font,
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
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{qi.name}</div>
                    {(qi.style || qi.color) && (
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                        {qi.style && <span>{qi.style}</span>}
                        {qi.color && <div style={{ color: C.faint }}>{qi.color}</div>}
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

      {/* ── Proofs Section ── */}
      {hasProofs && (
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
              const firstProof = proofs[0];
              const allApproved = proofs.length > 0 && proofs.every((p: any) => p.approval === "approved");
              const statusLabel = allApproved ? "Approved" : firstProof?.approval === "revision_requested" ? "Revision Requested" : firstProof?.approval === "pending" ? "Pending" : null;
              const statusColor = allApproved ? C.green : C.amber;
              return (
                <div key={item.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", background: C.bg }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {mockups[0]?.driveFileId && (
                      <img src={`/api/files/thumbnail?id=${mockups[0].driveFileId}`} alt=""
                        onClick={() => setViewingProof(mockups[0])}
                        onError={(e: any) => { e.target.style.display = "none"; }}
                        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}`, flexShrink: 0, cursor: "pointer" }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{item.name}</div>
                      {proofs.length > 0 && (
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{proofs.length} proof{proofs.length !== 1 ? "s" : ""}</div>
                      )}
                    </div>
                    {statusLabel && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, flexShrink: 0 }}>{statusLabel}</span>
                    )}
                    {firstProof?.driveFileId && (
                      <button onClick={() => setViewingProof(firstProof)}
                        style={{ fontSize: 13, color: "#fff", fontWeight: 700, background: C.accent, border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer", flexShrink: 0 }}>
                        View Proof
                      </button>
                    )}
                  </div>
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
            <button onClick={() => { setViewingProof(null); setShowRevisionInput(null); }} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.text, cursor: "pointer", padding: "8px 20px",
            }}>Close</button>
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

      {/* ── PDF preview modal ── */}
      {pdfPreview && (
        <div
          onClick={() => setPdfPreview(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10000, padding: 24, fontFamily: C.font,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "relative", width: "min(1000px, 96vw)", height: "92vh",
              background: C.card, borderRadius: 10, display: "flex",
              flexDirection: "column", overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{pdfPreview.title}</div>
              <button
                onClick={() => setPdfPreview(null)}
                style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}
              >×</button>
            </div>
            <iframe
              src={pdfPreview.src}
              style={{ flex: 1, border: "none", background: "#fff" }}
              title={pdfPreview.title}
            />
          </div>
        </div>
      )}
    </div>
  );
}

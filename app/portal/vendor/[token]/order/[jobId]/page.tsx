"use client";

// Vendor self-serve actions (Enter Tracking + Ship Qtys / Report Discrepancy)
// PARKED (Jon, Jul 27 2026) — behaving inconsistently; deliberately disabled
// rather than half-fixed. Flip to false to restore; the panels + API write
// paths below are intact.
const VENDOR_ACTIONS_DISABLED = true;
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { sortSizes } from "@/lib/theme";
import SizeGrid from "@/components/SizeGrid";
import { C, fmtDate, fmtDateLong, fmtMoney, daysUntil } from "../../_shared/theme";
import { StatusPill, vendorStageFor, rollupOrderStatus } from "../../_shared/StatusPill";

// Vendor Hub — dedicated ORDER PAGE (V2 treatment, Jon 2026-07-20). Replaces
// the MobileSheet detail: clicking an order in the hub lands here. Same data +
// actions as the hub (GET/POST /api/portal/vendor/[token]); job_id param makes
// deep links work even when the order lives in the completed bucket.

type DecoLine = { label: string; qty: number; rate: number; total: number };
type OrderItem = {
  id: string; name: string; letter: string; garmentType: string; blankVendor: string;
  blankSku: string; pipelineStage: string; driveLink: string | null;
  incomingGoods: string | null; productionNotes: string | null;
  packingNotes: string | null; shipTracking: string | null;
  shipQtys: Record<string, number> | null; sizes: string[]; qtys: Record<string, number>;
  totalQty: number; decoLines: DecoLine[]; itemTotal: number;
  mockupThumb: string | null; blanksOrdered: boolean;
};
type Order = {
  jobId: string; jobNumber: string; jobTitle: string; clientName: string;
  phase: string; shipDate: string | null; shippingRoute: string;
  poSent: boolean; poSentDate: string | null; shipTo: any; shipMethod: string | null;
  shippingAccount: string; grandTotal: number; totalUnits: number;
  items: OrderItem[];
};

const LBL: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" };

export default function VendorOrderPage({ params }: { params: { token: string; jobId: string } }) {
  const router = useRouter();
  const [decorator, setDecorator] = useState<{ name: string; shortCode: string } | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showTracking, setShowTracking] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, { tracking: string; carrier: string }>>({});
  const [shipQtyInputs, setShipQtyInputs] = useState<Record<string, Record<string, number>>>({});
  const [packingSlipFiles, setPackingSlipFiles] = useState<Record<string, File | null>>({});
  const [issueInputs, setIssueInputs] = useState<Record<string, string>>({});
  // Bill-to from tenant branding via the API — the same source as the PO PDF.
  const [billTo, setBillTo] = useState<{ name: string; addressHtml: string; email: string } | null>(null);

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [params.token, params.jobId]);

  async function loadData() {
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}?job_id=${params.jobId}`);
      if (!res.ok) { setError("This link is no longer valid."); return; }
      const d = await res.json();
      setDecorator(d.decorator);
      setBillTo(d.billTo || null);
      const found = [...(d.orders || []), ...(d.completed || [])].find((o: Order) => o.jobId === params.jobId) || null;
      if (!found) setError("Order not found on this account.");
      setOrder(found);
    } catch { setError("Unable to load."); }
    finally { setLoading(false); }
  }

  async function doAction(action: string, payload: Record<string, any>) {
    const key = action + payload.itemId;
    setActionLoading(key);
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) { await loadData(); setShowTracking(null); setShowIssue(null); }
    } catch {}
    setActionLoading(null);
  }

  async function markShipped(item: OrderItem) {
    if (!order) return;
    const t = trackingInputs[item.id];
    if (!t?.tracking?.trim()) return;
    setActionLoading("enter_tracking" + item.id);
    try {
      const slip = packingSlipFiles[item.id];
      if (slip) {
        const fd = new FormData();
        fd.append("itemId", item.id);
        fd.append("file", slip);
        await fetch(`/api/portal/vendor/${params.token}/packing-slip`, { method: "POST", body: fd }).catch(() => {});
      }
      const completeShipQtys = { ...(item.qtys || {}), ...(shipQtyInputs[item.id] || {}) };
      await fetch(`/api/portal/vendor/${params.token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enter_tracking", itemId: item.id, jobId: order.jobId, tracking: t.tracking.trim(), carrier: t.carrier || "", shipQtys: Object.keys(completeShipQtys).length > 0 ? completeShipQtys : null }),
      });
      await loadData();
      setShowTracking(null);
      setPackingSlipFiles(prev => ({ ...prev, [item.id]: null }));
    } catch {}
    setActionLoading(null);
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.font }}>
      <div style={{ color: C.muted }}>Loading…</div>
    </div>
  );
  if (error || !order || !decorator) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: C.font }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>🔒</div>
      <div style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{error || "Not found"}</div>
    </div>
  );

  const rollup = rollupOrderStatus(order.items.map(it => vendorStageFor(it.pipelineStage)));
  const stillActive = rollup !== "shipped" && rollup !== "complete";
  const shipInfo = stillActive && order.shipDate ? daysUntil(order.shipDate) : null;
  const shipToText = order.shipTo
    ? (typeof order.shipTo === "string" ? order.shipTo : [order.shipTo.name, order.shipTo.address, [order.shipTo.city, order.shipTo.state, order.shipTo.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n"))
    : "—";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* Header — same chrome as the hub. */}
      <header style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "14px 20px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>House Party Distro</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{decorator.name}</div>
          </div>
          <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Vendor Hub</div>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "clamp(16px, 4vw, 28px) clamp(12px, 3vw, 24px) 60px" }}>
        <button onClick={() => router.push(`/portal/vendor/${params.token}`)}
          style={{ background: "none", border: "none", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "2px 0", fontFamily: C.font, marginBottom: 12 }}>
          ‹ All orders
        </button>

        {/* Order hero */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 24, fontWeight: 800, fontFamily: C.mono, letterSpacing: "-0.01em" }}>{order.jobNumber || "Order"}</span>
              <StatusPill status={rollup} />
            </div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>{order.clientName}{order.jobTitle ? ` · ${order.jobTitle}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={LBL}>Ship date</div>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: C.mono, marginTop: 2 }}>{order.shipDate ? fmtDate(order.shipDate) : "TBD"}</div>
            {shipInfo && <div style={{ fontSize: 11, fontWeight: 700, color: shipInfo.color, fontFamily: C.mono, marginTop: 2 }}>{shipInfo.text}</div>}
          </div>
        </div>

        {/* Summary strip */}
        <div style={{ display: "flex", flexWrap: "wrap", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          {([
            ["Items", String(order.items.length)],
            ["Units", order.totalUnits.toLocaleString()],
            ["Decoration total", order.grandTotal > 0 ? fmtMoney(order.grandTotal) : "—"],
            ["Ship method", order.shipMethod || "—"],
            ["PO date", order.poSentDate ? fmtDate(order.poSentDate) : "—"],
          ] as [string, string][]).map(([label, val], i, arr) => (
            <div key={label} style={{ flex: 1, minWidth: 120, padding: "12px 14px", borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div style={LBL}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: C.mono, marginTop: 3 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Ship to / Bill to / account */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 18 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ ...LBL, marginBottom: 5 }}>Ship to</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{shipToText}</div>
            {order.shippingAccount && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}><span style={{ ...LBL, marginRight: 5 }}>Ship acct #</span><span style={{ fontFamily: C.mono }}>{order.shippingAccount}</span></div>}
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ ...LBL, marginBottom: 5 }}>Bill to</div>
            {billTo ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                {billTo.name}<br/>
                <span dangerouslySetInnerHTML={{ __html: billTo.addressHtml }} />
                {billTo.email && <><br/>{billTo.email}</>}
              </div>
            ) : <div style={{ fontSize: 12.5, color: C.muted }}>—</div>}
          </div>
        </div>

        {/* Items */}
        {order.items.map(item => {
          const sortedSizes = sortSizes(item.sizes).filter(s => (item.qtys[s] || 0) > 0);
          const stage = vendorStageFor(item.pipelineStage);
          const isShipped = stage === "shipped" || stage === "complete" || !!item.shipTracking;
          return (
            <div key={item.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 15.5, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: C.faint, fontFamily: C.mono, marginRight: 8 }}>{item.letter}</span>{item.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: C.muted, fontFamily: C.mono }}>{item.totalQty.toLocaleString()} u</span>
                  <StatusPill status={stage} />
                </div>
              </div>
              {(item.blankVendor || item.blankSku) && (
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                  {[item.blankVendor, item.blankSku].filter(Boolean).join(" · ")}
                </div>
              )}

              {/* Mockup + right column (sizes, deco) */}
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", marginTop: 12, flexWrap: "wrap" }}>
                {item.mockupThumb && (
                  <img src={item.mockupThumb} alt=""
                    style={{ width: 168, height: 168, objectFit: "contain", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, flexShrink: 0 }}
                    onError={e => (e.currentTarget.style.display = "none")} />
                )}
                <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 10 }}>
                  {sortedSizes.length > 0 && (
                    <div>
                      <div style={{ ...LBL, marginBottom: 4 }}>Sizes</div>
                      <SizeGrid labels={item.sizes} qtys={item.qtys} palette={{ text: C.text, muted: C.muted, faint: C.faint, border: C.border, surface: C.bg, accent: C.accent }} mono={C.mono} />
                    </div>
                  )}
                  {item.decoLines.length > 0 && (
                    <div>
                      <div style={{ ...LBL, marginBottom: 4 }}>Print &amp; decoration</div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <tbody>
                          {item.decoLines.map((l, li) => (
                            <tr key={li}>
                              <td style={{ padding: "3px 0", color: C.text }}>{l.label}</td>
                              <td style={{ padding: "3px 8px", textAlign: "right", color: C.muted, fontFamily: C.mono, fontSize: 11 }}>{l.qty.toLocaleString()}×{fmtMoney(l.rate)}</td>
                              <td style={{ padding: "3px 0", textAlign: "right", fontWeight: 700, fontFamily: C.mono }}>{fmtMoney(l.total)}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: `1px solid ${C.border}` }}>
                            <td colSpan={2} style={{ padding: "5px 0 0", ...LBL }}>Item total</td>
                            <td style={{ padding: "5px 0 0", textAlign: "right", fontSize: 14, fontWeight: 800, fontFamily: C.mono }}>{fmtMoney(item.itemTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {item.driveLink && (
                    <div style={{ fontSize: 12 }}>
                      <span style={{ ...LBL, marginRight: 6 }}>Production folder</span>
                      <a href={item.driveLink} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontWeight: 600, wordBreak: "break-all" }}>Open files ↗</a>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes — left accent rails */}
              {(item.incomingGoods || item.productionNotes || item.packingNotes) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                  {item.incomingGoods && (
                    <div style={{ borderLeft: `3px solid ${C.border}`, padding: "4px 12px" }}>
                      <div style={{ ...LBL, marginBottom: 2 }}>Incoming goods</div>
                      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.incomingGoods}</div>
                    </div>
                  )}
                  {item.productionNotes && (
                    <div style={{ borderLeft: `3px solid ${C.amber}`, padding: "4px 12px" }}>
                      <div style={{ ...LBL, color: C.amber, marginBottom: 2 }}>Production notes</div>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.productionNotes}</div>
                    </div>
                  )}
                  {item.packingNotes && (
                    <div style={{ borderLeft: `3px solid ${C.accent}`, padding: "4px 12px" }}>
                      <div style={{ ...LBL, color: C.accent, marginBottom: 2 }}>Packing / shipping</div>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.packingNotes}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions — vendor self-serve tracking + discrepancy DISABLED
                  (Jon, Jul 27: acting funny, parked rather than chased).
                  Flip VENDOR_ACTIONS_DISABLED below to re-enable; the panels
                  + write paths are untouched underneath. */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
                {!VENDOR_ACTIONS_DISABLED && !isShipped && (
                  <button onClick={() => { const next = showTracking === item.id ? null : item.id; setShowTracking(next); if (next) setShowIssue(null); }}
                    style={{ padding: "9px 16px", borderRadius: 9, background: C.green, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
                    {showTracking === item.id ? "Cancel" : "Enter Tracking + Ship Qtys"}
                  </button>
                )}
                {item.shipTracking && (
                  <div style={{ fontSize: 12.5, color: C.green, fontWeight: 700 }}>
                    Shipped · <span style={{ fontFamily: C.mono }}>{item.shipTracking}</span>
                  </div>
                )}
                {!VENDOR_ACTIONS_DISABLED && !isShipped && (
                  <button onClick={() => { const next = showIssue === item.id ? null : item.id; setShowIssue(next); if (next) setShowTracking(null); }}
                    style={{ padding: "9px 16px", borderRadius: 9, background: "transparent", color: C.amber, border: `1px solid ${C.amberBorder}`, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
                    {showIssue === item.id ? "Cancel" : "Report Discrepancy"}
                  </button>
                )}
                {VENDOR_ACTIONS_DISABLED && !isShipped && (
                  <div style={{ fontSize: 12, color: C.muted }}>To report shipments or issues, reply to the PO email — your reply reaches this order&apos;s thread directly.</div>
                )}
              </div>

              {/* Tracking panel */}
              {showTracking === item.id && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, background: C.bg, padding: 14, borderRadius: 10, border: `1px solid ${C.border}` }}>
                  {item.sizes && item.sizes.length > 0 && (
                    <div>
                      <div style={{ ...LBL, color: C.muted, marginBottom: 6 }}>Shipped quantities (defaults to ordered)</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {sortSizes(item.sizes).map(sz => {
                          const ordered = item.qtys?.[sz] || 0;
                          const current = shipQtyInputs[item.id]?.[sz];
                          const value = current !== undefined ? current : ordered;
                          const mismatch = value !== ordered;
                          return (
                            <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 9, color: C.muted, fontFamily: C.mono }}>{sz}</span>
                              <input type="number" min={0} value={value}
                                onChange={e => { const n = parseInt(e.target.value || "0", 10); setShipQtyInputs(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), [sz]: isNaN(n) ? 0 : n } })); }}
                                onFocus={e => e.target.select()}
                                style={{ width: 50, textAlign: "center", padding: 4, border: `1px solid ${mismatch ? C.amber : C.border}`, borderRadius: 4, background: C.card, color: mismatch ? C.amber : C.text, fontSize: 12, fontFamily: C.mono, outline: "none" }} />
                              <span style={{ fontSize: 8, color: C.faint, fontFamily: C.mono }}>{ordered}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ ...LBL, color: C.muted, marginBottom: 6 }}>Packing slip (optional)</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: C.card, border: `1px dashed ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, color: C.muted }}>
                      <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                        onChange={e => { const f = e.target.files?.[0] || null; setPackingSlipFiles(prev => ({ ...prev, [item.id]: f })); }} />
                      <span style={{ fontSize: 16, lineHeight: 1, color: C.faint }}>＋</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{packingSlipFiles[item.id]?.name || "Click to attach your packing slip (PDF or image)"}</span>
                      {packingSlipFiles[item.id] && (
                        <span onClick={e => { e.preventDefault(); e.stopPropagation(); setPackingSlipFiles(prev => ({ ...prev, [item.id]: null })); }} style={{ fontSize: 14, color: C.muted, padding: "0 4px" }}>×</span>
                      )}
                    </label>
                  </div>
                  <div style={{ ...LBL, color: C.muted, marginTop: 4 }}>Tracking</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select value={trackingInputs[item.id]?.carrier || ""}
                      onChange={e => setTrackingInputs(prev => ({ ...prev, [item.id]: { ...prev[item.id], carrier: e.target.value, tracking: prev[item.id]?.tracking || "" } }))}
                      style={{ width: 120, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: C.font, background: C.card }}>
                      <option value="">Carrier</option>
                      <option>UPS</option><option>FedEx</option><option>USPS</option><option>Freight</option><option>Will Call</option>
                    </select>
                    <input value={trackingInputs[item.id]?.tracking || ""}
                      onChange={e => setTrackingInputs(prev => ({ ...prev, [item.id]: { ...prev[item.id], tracking: e.target.value, carrier: prev[item.id]?.carrier || "" } }))}
                      placeholder="Tracking number"
                      style={{ flex: 1, minWidth: 160, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: C.font, background: C.card }} />
                  </div>
                  <button onClick={() => markShipped(item)}
                    disabled={!trackingInputs[item.id]?.tracking?.trim() || actionLoading === "enter_tracking" + item.id}
                    style={{ padding: "10px 0", borderRadius: 8, width: "100%", background: C.green, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font, opacity: (!trackingInputs[item.id]?.tracking?.trim() || actionLoading === "enter_tracking" + item.id) ? 0.5 : 1 }}>
                    {actionLoading === "enter_tracking" + item.id ? "Saving..." : "Mark as Shipped"}
                  </button>
                </div>
              )}

              {/* Discrepancy panel */}
              {showIssue === item.id && (
                <div style={{ marginTop: 12, background: C.amberBg, padding: 14, borderRadius: 10, border: `1px solid ${C.amberBorder}` }}>
                  <div style={{ ...LBL, color: C.amber, marginBottom: 6 }}>Report a discrepancy on this item</div>
                  <textarea value={issueInputs[item.id] || ""}
                    onChange={e => setIssueInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="e.g. short M-3, over L-12"
                    style={{ width: "100%", minHeight: 60, padding: 10, borderRadius: 6, border: `1px solid ${C.amberBorder}`, fontSize: 12, fontFamily: C.font, resize: "vertical", background: C.card, boxSizing: "border-box" }} />
                  <button onClick={() => { if (issueInputs[item.id]?.trim()) doAction("flag_issue", { itemId: item.id, jobId: order.jobId, note: issueInputs[item.id].trim() }); }}
                    disabled={!issueInputs[item.id]?.trim() || actionLoading === "flag_issue" + item.id}
                    style={{ marginTop: 8, padding: "8px 18px", borderRadius: 6, background: C.amber, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font, opacity: (!issueInputs[item.id]?.trim() || actionLoading === "flag_issue" + item.id) ? 0.5 : 1 }}>
                    {actionLoading === "flag_issue" + item.id ? "Sending..." : "Send to HPD"}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* PO total */}
        {order.grandTotal > 0 && (
          <div style={{ borderTop: `2px solid ${C.text}`, paddingTop: 12, marginBottom: 16, textAlign: "right" }}>
            <div style={{ ...LBL, marginBottom: 4 }}>PO Total — Decoration</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: C.mono }}>{fmtMoney(order.grandTotal)}</div>
          </div>
        )}

        {/* Terms */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, fontSize: 10, color: C.faint, lineHeight: 1.6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 3 }}>House Party Distro Purchase Order Conditions</div>
          House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date.
        </div>
      </main>
    </div>
  );
}

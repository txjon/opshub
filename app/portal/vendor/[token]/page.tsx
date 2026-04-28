"use client";
import { useState, useEffect } from "react";
import { sortSizes } from "@/lib/theme";

// ── Vendor Hub theme — mirrors Designer Studio (lib/theme.ts T palette).
// Future vendor types (decorators, suppliers, freight, etc.) will all live
// under this same hub aesthetic. Borders are derived from each color's
// *Bg background tone for soft, readable badges.
const C = {
  bg: "#f4f4f6",        // T.bg
  card: "#ffffff",      // T.card
  surface: "#eaeaee",   // T.surface
  border: "#dcdce0",    // T.border
  text: "#1a1a1a",      // T.text
  muted: "#6b6b78",     // T.muted
  faint: "#a0a0ad",     // T.faint
  accent: "#000000",    // T.accent
  accentBg: "#e8e8e8",  // T.accentDim
  green: "#4ddb88",     // T.green
  greenBg: "#e5f9ed",   // T.greenDim
  greenBorder: "#bdebd0",
  amber: "#f4b22b",     // T.amber
  amberBg: "#fef5e0",   // T.amberDim
  amberBorder: "#f5dfa8",
  red: "#ff324d",       // T.red
  redBg: "#ffe8ec",     // T.redDim
  redBorder: "#ffc3cc",
  blue: "#73b6c9",      // T.blue
  blueBg: "#e3f1f5",    // T.blueDim
  blueBorder: "#bbdde6",
  purple: "#fd3aa3",    // T.purple
  purpleBg: "#fee8f4",  // T.purpleDim
  purpleBorder: "#fbc3df",
  font: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
  mono: "'IBM Plex Mono', 'Courier New', monospace",
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtDateLong = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysUntil = (iso: string) => {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red, urgent: true };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber, urgent: true };
  if (diff <= 7) return { text: `${diff}d`, color: C.amber, urgent: false };
  return { text: `${diff}d`, color: C.green, urgent: false };
};

type DecoLine = { label: string; qty: number; rate: number; total: number };
type Order = {
  jobId: string; jobNumber: string; jobTitle: string; clientName: string;
  phase: string; shipDate: string | null; shippingRoute: string;
  poSent: boolean; poSentDate: string | null; shipTo: any; shipMethod: string | null;
  shippingAccount: string; grandTotal: number; totalUnits: number;
  items: OrderItem[];
};
type OrderItem = {
  id: string; name: string; letter: string; garmentType: string; blankVendor: string;
  blankSku: string; pipelineStage: string; driveLink: string | null;
  incomingGoods: string | null; productionNotes: string | null;
  packingNotes: string | null; shipTracking: string | null;
  shipQtys: Record<string, number> | null; sizes: string[]; qtys: Record<string, number>;
  totalQty: number; decoLines: DecoLine[]; itemTotal: number;
  mockupThumb: string | null; blanksOrdered: boolean;
};

const STAGE_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: "PO Sent", bg: C.accentBg, color: C.text },
  in_production: { label: "In Production", bg: C.amberBg, color: C.amber },
  shipped: { label: "Shipped", bg: C.greenBg, color: C.green },
  complete: { label: "Complete", bg: C.greenBg, color: C.green },
};

export default function VendorPortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<{ decorator: { name: string; shortCode: string }; orders: Order[]; completed: Order[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, { tracking: string; carrier: string }>>({});
  const [shipQtyInputs, setShipQtyInputs] = useState<Record<string, Record<string, number>>>({});
  const [packingSlipFiles, setPackingSlipFiles] = useState<Record<string, File | null>>({});
  const [issueInputs, setIssueInputs] = useState<Record<string, string>>({});
  const [showIssue, setShowIssue] = useState<string | null>(null);
  const [showTracking, setShowTracking] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ itemId: string; action: string; label: string } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"active" | "completed">("active");
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [completedSearch, setCompletedSearch] = useState("");
  const [completedLoading, setCompletedLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { loadData(); }, [params.token]);

  // Auto-select first order on load
  useEffect(() => {
    if (data?.orders?.length && !selectedOrderId) {
      setSelectedOrderId(data.orders[0].jobId);
    }
  }, [data?.orders?.length]);

  async function loadData() {
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}`);
      if (!res.ok) { setError("This link is no longer valid."); return; }
      const d = await res.json();
      setData(d);
      setCompletedOrders(d.completed || []);
      setCompletedTotal(d.completedTotal || 0);
      setCompletedOffset(0);
    } catch { setError("Unable to load."); }
    finally { setLoading(false); }
  }

  async function loadCompleted(offset: number, search: string, append: boolean) {
    setCompletedLoading(true);
    try {
      const qs = new URLSearchParams({ completed_offset: String(offset), completed_limit: "10" });
      if (search) qs.set("completed_search", search);
      const res = await fetch(`/api/portal/vendor/${params.token}?${qs}`);
      if (res.ok) {
        const d = await res.json();
        setCompletedOrders(append ? (prev: any[]) => [...prev, ...(d.completed || [])] : d.completed || []);
        setCompletedTotal(d.completedTotal || 0);
        setCompletedOffset(offset);
      }
    } catch {}
    setCompletedLoading(false);
  }

  async function doAction(action: string, payload: Record<string, any>) {
    const key = action + payload.itemId;
    setActionLoading(key);
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        await loadData();
        setShowTracking(null);
        setShowIssue(null);
        setConfirmAction(null);
      }
    } catch {}
    setActionLoading(null);
  }

  // Combined Mark as Shipped — per-size qtys + optional packing slip upload
  async function markShipped(item: OrderItem, orderJobId: string) {
    const t = trackingInputs[item.id];
    if (!t?.tracking?.trim()) return;
    const key = "enter_tracking" + item.id;
    setActionLoading(key);
    try {
      // Upload packing slip first (if attached) so we have the Drive link logged
      const slip = packingSlipFiles[item.id];
      if (slip) {
        const fd = new FormData();
        fd.append("itemId", item.id);
        fd.append("file", slip);
        await fetch(`/api/portal/vendor/${params.token}/packing-slip`, { method: "POST", body: fd }).catch(() => {});
      }
      // Fill in ordered qtys for sizes the user didn't touch, so the saved
      // ship_qtys object has a value for every size (matches UI defaults).
      const ordered = item.qtys || {};
      const inputs = shipQtyInputs[item.id] || {};
      const completeShipQtys = { ...ordered, ...inputs };
      // Then mark shipped with tracking + complete per-size qtys
      await fetch(`/api/portal/vendor/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enter_tracking",
          itemId: item.id,
          jobId: orderJobId,
          tracking: t.tracking.trim(),
          carrier: t.carrier || "",
          shipQtys: Object.keys(completeShipQtys).length > 0 ? completeShipQtys : null,
        }),
      });
      await loadData();
      setShowTracking(null);
      setPackingSlipFiles(prev => ({ ...prev, [item.id]: null }));
    } catch {}
    setActionLoading(null);
  }

  // ── Loading / Error ──
  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.muted, fontFamily: C.font }}>Loading...</div>
    </div>
  );

  if (error || !data) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>🔒</div>
      <div style={{ color: C.text, fontFamily: C.font, fontSize: 16, fontWeight: 600 }}>{error || "Not found"}</div>
    </div>
  );

  const { decorator, orders, completed } = data;
  const totalItems = orders.reduce((s, o) => s + o.items.length, 0);
  const needsAction = orders.reduce((s, o) => s + o.items.filter(i => i.pipelineStage === "pending").length, 0);
  const inProd = orders.reduce((s, o) => s + o.items.filter(i => i.pipelineStage === "in_production").length, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* ── Top Bar — mirrors the Designer Studio eyebrow + h1 layout ── */}
      <div style={{
        background: C.card, padding: isMobile ? "14px 20px" : "14px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>House Party Distro</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: C.text }}>Vendor Hub</div>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>{decorator.name}</div>
      </div>
      {/* ── Sidebar + Content Layout ── */}
      <div style={{ display: "flex", height: "calc(100vh - 49px)" }}>
        {/* Left sidebar */}
        <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.card, overflowY: "auto" }}>
          <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{decorator.name}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {totalItems} item{totalItems !== 1 ? "s" : ""} · {orders.length} order{orders.length !== 1 ? "s" : ""}
              {needsAction > 0 && <span style={{ color: C.amber, marginLeft: 6 }}>{needsAction} pending</span>}
            </div>
          </div>
          {/* Active / Completed tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
            {(["active", "completed"] as const).map(t => (
              <button key={t} onClick={() => { setSidebarTab(t); if (t === "completed" && completedOrders.length === 0) loadCompleted(0, "", false); }}
                style={{ flex: 1, padding: "10px 0", fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none",
                  background: sidebarTab === t ? C.bg : C.card, color: sidebarTab === t ? C.text : C.faint,
                  borderBottom: sidebarTab === t ? `2px solid ${C.text}` : "2px solid transparent",
                  textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {t === "active" ? `Active (${orders.length})` : `Completed`}
              </button>
            ))}
          </div>

          {/* Active orders list */}
          {sidebarTab === "active" && orders.map(order => {
            const selected = selectedOrderId === order.jobId;
            const shipInfo = order.shipDate ? daysUntil(order.shipDate) : null;
            return (
              <div key={order.jobId} onClick={() => setSelectedOrderId(order.jobId)}
                style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                  background: selected ? C.bg : C.card, borderLeft: selected ? `3px solid ${C.text}` : "3px solid transparent" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{order.jobNumber || "Order"}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{order.clientName}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: C.faint }}>{order.items.length} item{order.items.length !== 1 ? "s" : ""} · {order.totalUnits.toLocaleString()} units</span>
                  {shipInfo && <span style={{ fontSize: 10, fontWeight: 600, color: shipInfo.color, fontFamily: C.mono }}>{shipInfo.text}</span>}
                </div>
              </div>
            );
          })}

          {/* Completed orders list */}
          {sidebarTab === "completed" && (
            <>
              {/* Search */}
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                <input value={completedSearch}
                  onChange={e => { setCompletedSearch(e.target.value); }}
                  onKeyDown={e => { if (e.key === "Enter") loadCompleted(0, completedSearch, false); }}
                  placeholder="Search by PO # or name..."
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              </div>
              {completedOrders.map(order => {
                const selected = selectedOrderId === order.jobId;
                return (
                  <div key={order.jobId} onClick={() => setSelectedOrderId(order.jobId)}
                    style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                      background: selected ? C.bg : C.card, borderLeft: selected ? `3px solid ${C.text}` : "3px solid transparent" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{order.jobNumber || "Order"}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{order.clientName}</div>
                  </div>
                );
              })}
              {/* Load more */}
              {completedOrders.length < completedTotal && (
                <button onClick={() => loadCompleted(completedOffset + 10, completedSearch, true)}
                  disabled={completedLoading}
                  style={{ width: "100%", padding: "12px", border: "none", background: C.bg, color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  {completedLoading ? "Loading..." : `Load more (${completedTotal - completedOrders.length} remaining)`}
                </button>
              )}
              {completedOrders.length === 0 && !completedLoading && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: C.faint }}>No completed orders{completedSearch ? " matching search" : ""}</div>
              )}
            </>
          )}
        </div>

        {/* Right content */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "24px 28px" }}>
        {(() => {
          const order = [...orders, ...completedOrders].find(o => o.jobId === selectedOrderId);
          if (!order) return <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Select an order</div>;
          const shipInfo = order.shipDate ? daysUntil(order.shipDate) : null;
          const pendingItems = order.items.filter(i => i.pipelineStage === "pending");
          const expanded = true;
          return (<div>
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{order.jobNumber || "Order"} — {order.clientName}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{order.items.length} item{order.items.length !== 1 ? "s" : ""} · {order.totalUnits.toLocaleString()} units</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {shipInfo && <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: shipInfo.urgent ? (shipInfo.color === C.red ? C.redBg : C.amberBg) : C.greenBg, color: shipInfo.color }}>Ship {fmtDate(order.shipDate!)} · {shipInfo.text}</div>}
            {order.shipMethod && <div style={{ fontSize: 10, color: C.faint }}>{order.shipMethod}{order.shippingAccount ? ` · ${order.shippingAccount}` : ""}</div>}
          </div>
        </div>

              {/* PO detail content */}
                <div style={{ padding: isMobile ? "12px 16px" : "20px 24px" }}>

                  {/* Bulk confirm button if multiple pending */}
                  {pendingItems.length > 1 && (
                    <button
                      onClick={() => doAction("bulk_confirm", { itemIds: pendingItems.map(i => i.id) })}
                      disabled={actionLoading === "bulk_confirm" + pendingItems[0].id}
                      style={{
                        width: "100%", padding: "10px 0", borderRadius: 8, marginBottom: 16,
                        background: C.accent, color: "#fff", border: "none",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                        opacity: actionLoading ? 0.6 : 1,
                      }}
                    >
                      Confirm All {pendingItems.length} Items Received
                    </button>
                  )}

                  {/* ── Info Strip — softer card-row style ── */}
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 0, overflow: "hidden",
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 10, marginBottom: 16,
                  }}>
                    {([
                      ["Date", order.poSentDate ? fmtDateLong(order.poSentDate) : "—"],
                      ["Ship Date", order.shipDate ? fmtDateLong(order.shipDate) : "TBD"],
                      ["Vendor ID", decorator.shortCode || decorator.name],
                      ["Ship Method", order.shipMethod || "—"],
                      ["Ship Acct #", order.shippingAccount || "—"],
                    ] as [string, string][]).map(([label, val], idx) => (
                      <div key={idx} style={{
                        flex: 1, minWidth: isMobile ? "33%" : 0, padding: "8px 12px",
                        borderRight: idx < 4 ? `1px solid ${C.border}` : "none",
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── Bill To / Ship To ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16, fontSize: 12 }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Bill to</div>
                      <div style={{ lineHeight: 1.7, color: C.text }}>
                        House Party Distro<br/>
                        jon@housepartydistro.com<br/>
                        3945 W Reno Ave, Ste A<br/>
                        Las Vegas, NV 89118
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Ship to</div>
                      <div style={{ lineHeight: 1.7, color: C.text, whiteSpace: "pre-wrap" }}>
                        {order.shipTo
                          ? (typeof order.shipTo === "string" ? order.shipTo : [order.shipTo.name, order.shipTo.address, [order.shipTo.city, order.shipTo.state, order.shipTo.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n"))
                          : "—"}
                      </div>
                    </div>
                  </div>

                  {/* ── Order Summary chip — soft accent card, replaces
                      the PDF-mirroring black info bar so the page feels
                      like the studio aesthetic, not a printed PO. ── */}
                  <div style={{
                    background: C.accentBg, color: C.text, padding: "8px 14px",
                    display: "flex", gap: 24, fontSize: 12, marginBottom: 20,
                    borderRadius: 8, border: `1px solid ${C.border}`,
                  }}>
                    <div><span style={{ color: C.muted, marginRight: 6, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.08em", fontWeight: 700 }}>Client</span><span style={{ fontWeight: 600 }}>{order.clientName}</span></div>
                    <div><span style={{ color: C.muted, marginRight: 6, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.08em", fontWeight: 700 }}>Items</span><span style={{ fontWeight: 600 }}>{order.items.length}</span></div>
                    <div><span style={{ color: C.muted, marginRight: 6, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.08em", fontWeight: 700 }}>Total units</span><span style={{ fontWeight: 600, fontFamily: C.mono }}>{order.totalUnits.toLocaleString()}</span></div>
                  </div>

                  {/* ── Item Blocks (mirrors PO PDF) ── */}
                  {order.items.map(item => {
                    const stage = STAGE_LABELS[item.pipelineStage] || STAGE_LABELS.pending;
                    const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
                    const sortedSizes = [...item.sizes].filter(s => (item.qtys[s] || 0) > 0).sort((a, b) => {
                      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
                      if (ai === -1 && bi === -1) return a.localeCompare(b);
                      if (ai === -1) return 1; if (bi === -1) return -1;
                      return ai - bi;
                    });
                    const sizeStr = sortedSizes.map(sz => `${sz} ${item.qtys[sz]}`).join("  ·  ");

                    return (
                      <div key={item.id} style={{
                        background: C.card, border: `1px solid ${C.border}`,
                        borderRadius: 12, padding: 18, marginBottom: 14,
                      }}>
                        {/* Item header: letter — name + units + stage */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontSize: 15, fontWeight: 700 }}>
                            {item.letter} — {item.name}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: C.muted }}>{item.totalQty.toLocaleString()} units</span>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                              background: stage.bg, color: stage.color,
                            }}>
                              {stage.label}
                            </span>
                          </div>
                        </div>

                        {/* Meta: Brand / Color */}
                        <div style={{ display: "flex", gap: 12, marginBottom: 4, fontSize: 11, color: C.muted }}>
                          {item.blankVendor && (
                            <div><span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 4 }}>Brand</span>{item.blankVendor}</div>
                          )}
                          {item.blankSku && (
                            <div><span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 4 }}>Color</span>{item.blankSku}</div>
                          )}
                        </div>

                        {/* Sizes */}
                        {sizeStr && (
                          <div style={{
                            fontSize: 11, color: C.muted, padding: "4px 8px", background: C.bg,
                            borderRadius: 4, marginBottom: 6, border: `1px solid ${C.border}`,
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 6 }}>Sizes</span>
                            {sizeStr}
                          </div>
                        )}

                        {/* Production files link */}
                        {item.driveLink && (
                          <div style={{
                            fontSize: 11, padding: "4px 8px", background: "#eef3ff",
                            borderRadius: 4, marginBottom: 6,
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 6 }}>Production folder</span>
                            <a href={item.driveLink} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none" }}>{item.driveLink}</a>
                          </div>
                        )}

                        {/* Mockup thumbnail + Decoration table */}
                        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 6 }}>
                          {item.mockupThumb && (
                            <div style={{ flexShrink: 0 }}>
                              <img src={item.mockupThumb} alt="" style={{
                                height: 120, width: "auto", objectFit: "contain",
                                borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`,
                              }} onError={e => (e.currentTarget.style.display = "none")} />
                            </div>
                          )}
                          {item.decoLines.length > 0 && (
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 4 }}>Print & Decoration</div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                  <tbody>
                                    {item.decoLines.map((l, li) => (
                                      <tr key={li}>
                                        <td style={{ padding: "2px 0", color: C.text }}>{l.label}</td>
                                        <td style={{ padding: "2px 6px", textAlign: "right", color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
                                          {l.qty.toLocaleString()}×{fmtD(l.rate)}
                                        </td>
                                        <td style={{ padding: "2px 0", textAlign: "right", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtD(l.total)}</td>
                                      </tr>
                                    ))}
                                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                                      <td colSpan={2} style={{ padding: "4px 0 2px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted }}>Item total</td>
                                      <td style={{ padding: "4px 0 2px", textAlign: "right", fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{fmtD(item.itemTotal)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Notes grid (incoming, production notes, packing) */}
                        {(item.incomingGoods || item.productionNotes || item.packingNotes) && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
                            {item.incomingGoods ? (
                              <div style={{ background: C.bg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 2 }}>Incoming goods</div>
                                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item.incomingGoods}</div>
                              </div>
                            ) : <div />}
                            {item.productionNotes ? (
                              <div style={{ background: C.amberBg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.amberBorder}` }}>
                                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 2 }}>Production notes</div>
                                <div style={{ fontSize: 11, color: C.amber, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.productionNotes}</div>
                              </div>
                            ) : <div />}
                            {item.packingNotes ? (
                              <div style={{ background: C.accentBg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.accent}33` }}>
                                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.accent, marginBottom: 2 }}>Packing / shipping</div>
                                <div style={{ fontSize: 11, color: C.accent, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.packingNotes}</div>
                              </div>
                            ) : <div />}
                          </div>
                        )}

                        {/* ── Actions ── */}
                        {(() => {
                          const isShipped = item.pipelineStage === "shipped" || item.pipelineStage === "complete" || !!item.shipTracking;
                          const alreadyReceived = item.pipelineStage === "in_production" || item.pipelineStage === "blanks_received" || isShipped;
                          return (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                              {/* Mark Blanks Received — visible until shipped */}
                              {!isShipped && (
                                <button
                                  onClick={() => setConfirmAction({ itemId: item.id, action: "confirm_received", label: `Mark ${item.name} blanks as received?` })}
                                  disabled={alreadyReceived}
                                  style={{
                                    padding: "8px 16px", borderRadius: 8,
                                    background: alreadyReceived ? C.greenBg : C.accent,
                                    color: alreadyReceived ? C.green : "#fff",
                                    border: alreadyReceived ? `1px solid ${C.greenBorder}` : "none",
                                    fontSize: 12, fontWeight: 600,
                                    cursor: alreadyReceived ? "default" : "pointer",
                                  }}>
                                  {alreadyReceived ? "✓ Blanks Received" : "Mark Blanks Received"}
                                </button>
                              )}

                              {/* Enter Tracking — visible until shipped */}
                              {!isShipped && (
                                <button
                                  onClick={() => setShowTracking(showTracking === item.id ? null : item.id)}
                                  style={{
                                    padding: "8px 16px", borderRadius: 8,
                                    background: C.green, color: "#fff", border: "none",
                                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                                  }}>
                                  {showTracking === item.id ? "Cancel" : "Enter Tracking + Ship Qtys"}
                                </button>
                              )}

                              {/* Shipped state */}
                              {item.shipTracking && (
                                <div style={{ fontSize: 12, color: C.green, fontWeight: 600, padding: "8px 0" }}>
                                  Tracking: {item.shipTracking}
                                </div>
                              )}

                              {/* Report Discrepancy — always visible on unshipped items */}
                              {!isShipped && (
                                <button
                                  onClick={() => setShowIssue(showIssue === item.id ? null : item.id)}
                                  style={{
                                    padding: "8px 16px", borderRadius: 8,
                                    background: "transparent", color: C.amber, border: `1px solid ${C.amberBorder}`,
                                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                                  }}>
                                  {showIssue === item.id ? "Cancel" : "Report Discrepancy"}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* Tracking input + per-size ship qtys + packing slip */}
                        {showTracking === item.id && (
                          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, background: C.bg, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                            {/* Per-size shipped quantities */}
                            {item.sizes && item.sizes.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginBottom: 6 }}>
                                  Shipped quantities (defaults to ordered)
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {sortSizes(item.sizes).map(sz => {
                                    const ordered = item.qtys?.[sz] || 0;
                                    const current = shipQtyInputs[item.id]?.[sz];
                                    const value = current !== undefined ? current : ordered;
                                    const mismatch = value !== ordered;
                                    return (
                                      <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                        <span style={{ fontSize: 9, color: C.muted, fontFamily: C.mono }}>{sz}</span>
                                        <input
                                          type="number"
                                          min={0}
                                          value={value}
                                          onChange={e => {
                                            const n = parseInt(e.target.value || "0", 10);
                                            setShipQtyInputs(prev => ({
                                              ...prev,
                                              [item.id]: { ...(prev[item.id] || {}), [sz]: isNaN(n) ? 0 : n },
                                            }));
                                          }}
                                          onFocus={e => e.target.select()}
                                          style={{ width: 50, textAlign: "center", padding: "4px", border: `1px solid ${mismatch ? C.amber : C.border}`, borderRadius: 4, background: C.card, color: mismatch ? C.amber : C.text, fontSize: 12, fontFamily: C.mono, outline: "none" }}
                                        />
                                        <span style={{ fontSize: 8, color: C.faint, fontFamily: C.mono }}>{ordered}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Packing slip upload */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginBottom: 6 }}>
                                Packing slip (optional)
                              </div>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: C.card, border: `1px dashed ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, color: C.muted }}>
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  style={{ display: "none" }}
                                  onChange={e => {
                                    const f = e.target.files?.[0] || null;
                                    setPackingSlipFiles(prev => ({ ...prev, [item.id]: f }));
                                  }}
                                />
                                <span style={{ fontSize: 16, lineHeight: 1, color: C.faint }}>＋</span>
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {packingSlipFiles[item.id]?.name || "Click to attach your packing slip (PDF or image)"}
                                </span>
                                {packingSlipFiles[item.id] && (
                                  <span
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPackingSlipFiles(prev => ({ ...prev, [item.id]: null })); }}
                                    style={{ fontSize: 14, color: C.muted, padding: "0 4px" }}
                                  >×</span>
                                )}
                              </label>
                            </div>

                            {/* Carrier + tracking */}
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginTop: 4 }}>
                              Tracking
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <select
                                value={trackingInputs[item.id]?.carrier || ""}
                                onChange={e => setTrackingInputs(prev => ({
                                  ...prev, [item.id]: { ...prev[item.id], carrier: e.target.value, tracking: prev[item.id]?.tracking || "" }
                                }))}
                                style={{
                                  width: 120, padding: "8px 10px", borderRadius: 8,
                                  border: `1px solid ${C.border}`, fontSize: 12,
                                  fontFamily: C.font, background: C.card,
                                }}
                              >
                                <option value="">Carrier</option>
                                <option>UPS</option>
                                <option>FedEx</option>
                                <option>USPS</option>
                                <option>Freight</option>
                                <option>Will Call</option>
                              </select>
                              <input
                                value={trackingInputs[item.id]?.tracking || ""}
                                onChange={e => setTrackingInputs(prev => ({
                                  ...prev, [item.id]: { ...prev[item.id], tracking: e.target.value, carrier: prev[item.id]?.carrier || "" }
                                }))}
                                placeholder="Tracking number"
                                style={{
                                  flex: 1, padding: "8px 10px", borderRadius: 8,
                                  border: `1px solid ${C.border}`, fontSize: 12,
                                  fontFamily: C.font, background: C.card,
                                }}
                              />
                            </div>
                            <button
                              onClick={() => markShipped(item, order.jobId)}
                              disabled={!trackingInputs[item.id]?.tracking?.trim() || actionLoading === "enter_tracking" + item.id}
                              style={{
                                padding: "10px 0", borderRadius: 8, width: "100%",
                                background: C.green, color: "#fff", border: "none",
                                fontSize: 13, fontWeight: 600, cursor: "pointer",
                                opacity: (!trackingInputs[item.id]?.tracking?.trim() || actionLoading === "enter_tracking" + item.id) ? 0.5 : 1,
                              }}>
                              {actionLoading === "enter_tracking" + item.id ? "Saving..." : "Mark as Shipped"}
                            </button>
                          </div>
                        )}

                        {/* Discrepancy input — blanks received counts off, qc issues, etc. */}
                        {showIssue === item.id && (
                          <div style={{ marginTop: 10, background: C.amberBg, padding: 12, borderRadius: 8, border: `1px solid ${C.amberBorder}` }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.amber, marginBottom: 6 }}>
                              Report a discrepancy on this item
                            </div>
                            <textarea
                              value={issueInputs[item.id] || ""}
                              onChange={e => setIssueInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                              placeholder="e.g. short M-3, over L-12"
                              style={{
                                width: "100%", minHeight: 60, padding: 10, borderRadius: 6,
                                border: `1px solid ${C.amberBorder}`, fontSize: 12,
                                fontFamily: C.font, resize: "vertical", background: C.card,
                                boxSizing: "border-box",
                              }}
                            />
                            <button
                              onClick={() => {
                                if (!issueInputs[item.id]?.trim()) return;
                                doAction("flag_issue", {
                                  itemId: item.id,
                                  jobId: order.jobId,
                                  note: issueInputs[item.id].trim(),
                                });
                              }}
                              disabled={!issueInputs[item.id]?.trim() || actionLoading === "flag_issue" + item.id}
                              style={{
                                marginTop: 8, padding: "8px 20px", borderRadius: 6,
                                background: C.amber, color: "#fff", border: "none",
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                                opacity: (!issueInputs[item.id]?.trim() || actionLoading === "flag_issue" + item.id) ? 0.5 : 1,
                              }}>
                              {actionLoading === "flag_issue" + item.id ? "Sending..." : "Send to HPD"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* ── PO Total ── */}
                  {order.grandTotal > 0 && (
                    <div style={{
                      borderTop: `2px solid #1a1d2b`, paddingTop: 12, marginBottom: 20,
                      textAlign: "right",
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 4 }}>PO Total — Decoration</div>
                      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", fontFamily: "ui-monospace, monospace" }}>{fmtD(order.grandTotal)}</div>
                    </div>
                  )}

                  {/* ── Terms ── */}
                  <div style={{
                    borderTop: `1px solid ${C.border}`, paddingTop: 10,
                    fontSize: 10, color: C.faint, lineHeight: 1.6,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 3 }}>House Party Distro Purchase Order Conditions</div>
                    House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date.
                  </div>
                </div>
        </div>);
        })()}
        </div>
      </div>

      {/* ── Confirm Dialog ── */}
      {confirmAction && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999,
        }} onClick={() => setConfirmAction(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, borderRadius: 8, padding: 24, maxWidth: 380, width: "90%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{confirmAction.label}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
              This will update the status to &quot;In Production&quot;.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmAction(null)} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: C.bg, border: `1px solid ${C.border}`, color: C.text, cursor: "pointer",
              }}>Cancel</button>
              <button
                onClick={() => doAction(confirmAction.action, { itemId: confirmAction.itemId })}
                disabled={actionLoading === confirmAction.action + confirmAction.itemId}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: C.accent, border: "none", color: "#fff", cursor: "pointer",
                }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

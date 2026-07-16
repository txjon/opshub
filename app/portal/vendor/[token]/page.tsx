"use client";
import { useState, useEffect, useMemo } from "react";
import { sortSizes } from "@/lib/theme";
import { daysUntilDay } from "@/lib/dates";
import SizeGrid from "@/components/SizeGrid";
import { C, fmtDate, fmtDateLong, fmtMoney, daysUntil } from "./_shared/theme";
import { MobileSheet } from "./_shared/MobileSheet";
import {
  StatusPill, vendorStageFor, rollupOrderStatus,
  type VendorState,
} from "./_shared/StatusPill";

// Vendor Hub — mirrors the client hub's polish (KPI strip, tabs,
// MobileSheet detail surface, uppercase color-text status, no pills)
// while keeping its own logic + state. Data still comes entirely
// from OpsHub via /api/portal/vendor/[token].

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

export default function VendorPortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<{
    decorator: { name: string; shortCode: string };
    orders: Order[];
    completed: Order[];
    completedTotal?: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [tab, setTab] = useState<"active" | "past">("active");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const [trackingInputs, setTrackingInputs] = useState<Record<string, { tracking: string; carrier: string }>>({});
  const [shipQtyInputs, setShipQtyInputs] = useState<Record<string, Record<string, number>>>({});
  const [packingSlipFiles, setPackingSlipFiles] = useState<Record<string, File | null>>({});
  const [issueInputs, setIssueInputs] = useState<Record<string, string>>({});
  const [showIssue, setShowIssue] = useState<string | null>(null);
  const [showTracking, setShowTracking] = useState<string | null>(null);

  // Completed pagination + search
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [completedSearch, setCompletedSearch] = useState("");
  const [completedLoading, setCompletedLoading] = useState(false);

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [params.token]);

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
        setCompletedOrders(prev => append ? [...prev, ...(d.completed || [])] : (d.completed || []));
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
      }
    } catch {}
    setActionLoading(null);
  }

  async function markShipped(item: OrderItem, orderJobId: string) {
    const t = trackingInputs[item.id];
    if (!t?.tracking?.trim()) return;
    const key = "enter_tracking" + item.id;
    setActionLoading(key);
    try {
      const slip = packingSlipFiles[item.id];
      if (slip) {
        const fd = new FormData();
        fd.append("itemId", item.id);
        fd.append("file", slip);
        await fetch(`/api/portal/vendor/${params.token}/packing-slip`, { method: "POST", body: fd }).catch(() => {});
      }
      const ordered = item.qtys || {};
      const inputs = shipQtyInputs[item.id] || {};
      const completeShipQtys = { ...ordered, ...inputs };
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

  // ── KPI rollup ──
  // Computed against active orders only — past orders are by definition
  // already shipped/complete so they don't count toward "pending" or "late".
  const kpi = useMemo(() => {
    if (!data) return { poReceived: 0, inProduction: 0, shippingThisWeek: 0, late: 0 };
    let poReceived = 0, inProduction = 0, shippingThisWeek = 0, late = 0;
    for (const o of data.orders) {
      for (const it of o.items) {
        const s = vendorStageFor(it.pipelineStage);
        if (s === "pending") poReceived++;
        if (s === "in_production") inProduction++;
        if (s !== "shipped" && s !== "complete" && o.shipDate) {
          if (o.shipDate === "ASAP") {
            // ASAP counts as "shipping this week" so it shows in the
            // urgent bucket; not "late" since it has no calendar miss.
            shippingThisWeek++;
          } else {
            // calendar-day bucketing — a date-only ship date parsed bare is UTC
            // midnight (= "late" from 5 PM the prior Vegas evening)
            const d = daysUntilDay(o.shipDate);
            if (d !== null && d < 0) late++;
            else if (d !== null && d <= 7) shippingThisWeek++;
          }
        }
      }
    }
    return { poReceived, inProduction, shippingThisWeek, late };
  }, [data]);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.font }}>
      <div style={{ color: C.muted }}>Loading…</div>
    </div>
  );
  if (error || !data) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: C.font }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>🔒</div>
      <div style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{error || "Not found"}</div>
    </div>
  );

  const { decorator, orders } = data;
  const activeList = orders;
  const pastList = completedOrders;
  const visibleList = tab === "active" ? activeList : pastList;

  const openOrder = openOrderId
    ? [...orders, ...completedOrders].find(o => o.jobId === openOrderId) || null
    : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      <style>{`
        @media (max-width: 640px) {
          .vendor-kpi-grid { display: none !important; }
          .vendor-kpi-card { display: block !important; }
        }
        @media (min-width: 641px) {
          .vendor-kpi-card { display: none !important; }
        }
      `}</style>

      {/* Header — same eyebrow + h1 + tab nav layout as the client hub. */}
      <header style={{
        background: C.card, borderBottom: `1px solid ${C.border}`, padding: "14px 20px",
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              House Party Distro
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              {decorator.name}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            Vendor Hub
          </div>
        </div>
      </header>

      <main style={{
        maxWidth: 1200, margin: "0 auto",
        padding: "clamp(16px, 4vw, 32px) clamp(12px, 3vw, 24px) 60px",
      }}>

        {/* KPI strip — 4 cards on desktop, single condensed card on mobile.
            Same condense pattern the client hub Items KPI uses. */}
        <div className="vendor-kpi-grid" style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18,
        }}>
          <KpiCard label="PO Received" value={kpi.poReceived} />
          <KpiCard label="In Production" value={kpi.inProduction} color={C.blue} />
          <KpiCard label="Shipping This Week" value={kpi.shippingThisWeek} color={kpi.shippingThisWeek > 0 ? C.amber : undefined} />
          <KpiCard label="Late" value={kpi.late} color={kpi.late > 0 ? C.red : undefined} />
        </div>
        <div className="vendor-kpi-card" style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 12, marginBottom: 16,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <CondensedKpi label="PO Received" value={kpi.poReceived} />
            <CondensedKpi label="In Production" value={kpi.inProduction} color={C.blue} />
            <CondensedKpi label="Shipping This Week" value={kpi.shippingThisWeek} color={kpi.shippingThisWeek > 0 ? C.amber : undefined} />
            <CondensedKpi label="Late" value={kpi.late} color={kpi.late > 0 ? C.red : undefined} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12, gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["active", "past"] as const).map(t => (
              <button key={t}
                onClick={() => {
                  setTab(t);
                  if (t === "past" && completedOrders.length === 0) loadCompleted(0, "", false);
                }}
                style={{
                  padding: "8px 14px", border: "none", cursor: "pointer", background: "transparent",
                  fontFamily: C.font, fontSize: 13, fontWeight: 700,
                  color: tab === t ? C.text : C.muted,
                  borderBottom: tab === t ? `2px solid ${C.text}` : "2px solid transparent",
                }}>
                {t === "active" ? `Active (${orders.length})` : `Past (${completedTotal || pastList.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Search — only on Past tab, same pattern as client hub */}
        {tab === "past" && (
          <div style={{ marginBottom: 10 }}>
            <input value={completedSearch}
              onChange={e => setCompletedSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") loadCompleted(0, completedSearch, false); }}
              placeholder="Search by PO # or client…"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.card, color: C.text,
                fontSize: 13, fontFamily: C.font, boxSizing: "border-box", outline: "none",
              }} />
          </div>
        )}

        {/* Orders list */}
        {visibleList.length === 0 ? (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: "40px 20px", textAlign: "center",
            color: C.muted, fontSize: 13,
          }}>
            {tab === "active" ? "No active orders" : (completedLoading ? "Loading…" : `No past orders${completedSearch ? " matching search" : ""}`)}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleList.map(o => (
              <OrderRow key={o.jobId} order={o} onOpen={() => setOpenOrderId(o.jobId)} />
            ))}
            {tab === "past" && completedOrders.length < completedTotal && (
              <button onClick={() => loadCompleted(completedOffset + 10, completedSearch, true)}
                disabled={completedLoading}
                style={{
                  padding: "10px 14px", border: `1px solid ${C.border}`,
                  background: C.card, color: C.muted, fontSize: 12, fontWeight: 600,
                  borderRadius: 8, cursor: "pointer", marginTop: 4, fontFamily: C.font,
                }}>
                {completedLoading ? "Loading…" : `Load more (${completedTotal - completedOrders.length} remaining)`}
              </button>
            )}
          </div>
        )}
      </main>

      {/* Order detail sheet */}
      <MobileSheet
        open={!!openOrder}
        onClose={() => setOpenOrderId(null)}
        title={openOrder ? (openOrder.jobNumber || "Order") : ""}
        subtitle={openOrder ? `${openOrder.clientName} · ${openOrder.totalUnits.toLocaleString()} units` : ""}
        rightAccessory={openOrder?.shipDate ? (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ship date</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: C.mono }}>{fmtDate(openOrder.shipDate)}</div>
          </div>
        ) : undefined}
      >
        {openOrder && (
          <OrderDetail
            order={openOrder}
            decorator={decorator}
            actionLoading={actionLoading}
            showTracking={showTracking}
            setShowTracking={setShowTracking}
            showIssue={showIssue}
            setShowIssue={setShowIssue}
            trackingInputs={trackingInputs}
            setTrackingInputs={setTrackingInputs}
            shipQtyInputs={shipQtyInputs}
            setShipQtyInputs={setShipQtyInputs}
            packingSlipFiles={packingSlipFiles}
            setPackingSlipFiles={setPackingSlipFiles}
            issueInputs={issueInputs}
            setIssueInputs={setIssueInputs}
            doAction={doAction}
            markShipped={markShipped}
          />
        )}
      </MobileSheet>
    </div>
  );
}

// ── KPI tiles ──

function KpiCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: C.faint,
        textTransform: "uppercase", letterSpacing: "0.08em",
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 800, marginTop: 4, fontFamily: C.mono,
        color: color || C.text,
      }}>{value}</div>
    </div>
  );
}

function CondensedKpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: C.mono, color: color || C.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── Order row — worksheet-style list entry ──

function OrderRow({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const rollup = rollupOrderStatus(order.items.map(it => vendorStageFor(it.pipelineStage)));
  // Countdown only matters while the order is still the vendor's
  // responsibility. Once they've shipped or wrapped, "Nd late" is
  // noise — the work is out the door.
  const stillActive = rollup !== "shipped" && rollup !== "complete";
  const shipInfo = stillActive && order.shipDate ? daysUntil(order.shipDate) : null;

  return (
    <button onClick={onOpen}
      style={{
        width: "100%", background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: "12px 14px", textAlign: "left",
        cursor: "pointer", fontFamily: C.font, color: C.text,
        display: "flex", alignItems: "center", gap: 12,
      }}
      onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = C.text; }}
      onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = C.border; }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, fontFamily: C.mono }}>
            {order.jobNumber || "Order"}
          </span>
          <span style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.clientName}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
          <span>{order.totalUnits.toLocaleString()} units</span>
          {order.shipDate && (
            <span>Ship {fmtDate(order.shipDate)}</span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <StatusPill status={rollup} />
        {shipInfo && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: shipInfo.color, fontFamily: C.mono,
          }}>{shipInfo.text}</span>
        )}
      </div>
    </button>
  );
}

// ── Order detail (renders inside the sheet) ──

function OrderDetail(props: {
  order: Order; decorator: { name: string; shortCode: string };
  actionLoading: string | null;
  showTracking: string | null;
  setShowTracking: (v: string | null) => void;
  showIssue: string | null;
  setShowIssue: (v: string | null) => void;
  trackingInputs: Record<string, { tracking: string; carrier: string }>;
  setTrackingInputs: (fn: any) => void;
  shipQtyInputs: Record<string, Record<string, number>>;
  setShipQtyInputs: (fn: any) => void;
  packingSlipFiles: Record<string, File | null>;
  setPackingSlipFiles: (fn: any) => void;
  issueInputs: Record<string, string>;
  setIssueInputs: (fn: any) => void;
  doAction: (action: string, payload: Record<string, any>) => Promise<void>;
  markShipped: (item: OrderItem, orderJobId: string) => Promise<void>;
}) {
  const {
    order, decorator, actionLoading,
    showTracking, setShowTracking, showIssue, setShowIssue,
    trackingInputs, setTrackingInputs,
    shipQtyInputs, setShipQtyInputs,
    packingSlipFiles, setPackingSlipFiles,
    issueInputs, setIssueInputs,
    doAction, markShipped,
  } = props;

  return (
    <div>
      {/* Info strip — date / ship / vendor id / ship method / acct # */}
      <div style={{
        display: "flex", flexWrap: "wrap", overflow: "hidden",
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, marginBottom: 14,
      }}>
        {([
          ["Date", order.poSentDate ? fmtDateLong(order.poSentDate) : "—"],
          ["Ship Date", order.shipDate ? fmtDateLong(order.shipDate) : "TBD"],
          ["Vendor ID", decorator.shortCode || decorator.name],
          ["Ship Method", order.shipMethod || "—"],
          ["Ship Acct #", order.shippingAccount || "—"],
        ] as [string, string][]).map(([label, val], idx, arr) => (
          <div key={idx} style={{
            flex: 1, minWidth: "33%", padding: "8px 12px",
            borderRight: idx < arr.length - 1 ? `1px solid ${C.border}` : "none",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Bill to / Ship to */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16, fontSize: 12 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Bill to</div>
          <div style={{ lineHeight: 1.7, color: C.text }}>
            House Party Distro<br/>
            production@housepartydistro.com<br/>
            4670 W Silverado Ranch Blvd, STE 120<br/>
            Las Vegas, NV 89139
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

      {/* Items */}
      {order.items.map(item => {
        const sortedSizes = sortSizes(item.sizes).filter(s => (item.qtys[s] || 0) > 0);
        const stage = vendorStageFor(item.pipelineStage);
        const isShipped = stage === "shipped" || stage === "complete" || !!item.shipTracking;

        return (
          <div key={item.id} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: 16, marginBottom: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.letter} — {item.name}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>{item.totalQty.toLocaleString()}</span>
                <StatusPill status={stage} />
              </div>
            </div>

            {/* Brand / Color */}
            {(item.blankVendor || item.blankSku) && (
              <div style={{ display: "flex", gap: 12, marginBottom: 6, fontSize: 11, color: C.muted, flexWrap: "wrap" }}>
                {item.blankVendor && (
                  <div><span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 4 }}>Brand</span>{item.blankVendor}</div>
                )}
                {item.blankSku && (
                  <div><span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 4 }}>Color</span>{item.blankSku}</div>
                )}
              </div>
            )}

            {/* Sizes */}
            {sortedSizes.length > 0 && (
              <div style={{
                padding: "6px 8px", background: C.bg,
                borderRadius: 4, marginBottom: 6, border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginBottom: 4 }}>Sizes</div>
                <SizeGrid labels={item.sizes} qtys={item.qtys} palette={{ text: C.text, muted: C.muted, faint: C.faint, border: C.border, surface: C.card, accent: C.accent }} mono={C.mono} />
              </div>
            )}

            {/* Production folder link */}
            {item.driveLink && (
              <div style={{
                fontSize: 11, padding: "4px 8px", background: C.blueBg,
                borderRadius: 4, marginBottom: 6, border: `1px solid ${C.blueBorder}`,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 6 }}>Production folder</span>
                <a href={item.driveLink} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none", wordBreak: "break-all" }}>{item.driveLink}</a>
              </div>
            )}

            {/* Mockup + decoration table */}
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 8, flexWrap: "wrap" }}>
              {item.mockupThumb && (
                <img src={item.mockupThumb} alt=""
                  style={{
                    height: 110, width: "auto", objectFit: "contain",
                    borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`,
                    flexShrink: 0,
                  }}
                  onError={e => (e.currentTarget.style.display = "none")} />
              )}
              {item.decoLines.length > 0 && (
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 4 }}>Print & Decoration</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <tbody>
                        {item.decoLines.map((l, li) => (
                          <tr key={li}>
                            <td style={{ padding: "2px 0", color: C.text }}>{l.label}</td>
                            <td style={{ padding: "2px 6px", textAlign: "right", color: C.muted, fontFamily: C.mono, fontSize: 10 }}>
                              {l.qty.toLocaleString()}×{fmtMoney(l.rate)}
                            </td>
                            <td style={{ padding: "2px 0", textAlign: "right", fontWeight: 700, fontFamily: C.mono }}>{fmtMoney(l.total)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: `1px solid ${C.border}` }}>
                          <td colSpan={2} style={{ padding: "4px 0 2px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted }}>Item total</td>
                          <td style={{ padding: "4px 0 2px", textAlign: "right", fontSize: 13, fontWeight: 800, fontFamily: C.mono }}>{fmtMoney(item.itemTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Notes grid */}
            {(item.incomingGoods || item.productionNotes || item.packingNotes) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6, marginTop: 8 }}>
                {item.incomingGoods && (
                  <div style={{ background: C.bg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 2 }}>Incoming goods</div>
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item.incomingGoods}</div>
                  </div>
                )}
                {item.productionNotes && (
                  <div style={{ background: C.amberBg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.amberBorder}` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 2 }}>Production notes</div>
                    <div style={{ fontSize: 11, color: C.amber, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.productionNotes}</div>
                  </div>
                )}
                {item.packingNotes && (
                  <div style={{ background: C.accent + "11", padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.accent}33` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.accent, marginBottom: 2 }}>Packing / shipping</div>
                    <div style={{ fontSize: 11, color: C.accent, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.packingNotes}</div>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
              {!isShipped && (
                <button
                  onClick={() => {
                    const next = showTracking === item.id ? null : item.id;
                    setShowTracking(next);
                    if (next) setShowIssue(null);
                  }}
                  style={{
                    padding: "8px 14px", borderRadius: 8,
                    background: C.green, color: "#fff", border: "none",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                  {showTracking === item.id ? "Cancel" : "Enter Tracking + Ship Qtys"}
                </button>
              )}
              {item.shipTracking && (
                <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>
                  Tracking: <span style={{ fontFamily: C.mono }}>{item.shipTracking}</span>
                </div>
              )}
              {!isShipped && (
                <button
                  onClick={() => {
                    const next = showIssue === item.id ? null : item.id;
                    setShowIssue(next);
                    if (next) setShowTracking(null);
                  }}
                  style={{
                    padding: "8px 14px", borderRadius: 8,
                    background: "transparent", color: C.amber, border: `1px solid ${C.amberBorder}`,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                  {showIssue === item.id ? "Cancel" : "Report Discrepancy"}
                </button>
              )}
            </div>

            {/* Tracking panel */}
            {showTracking === item.id && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, background: C.bg, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
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
                            <input type="number" min={0} value={value}
                              onChange={e => {
                                const n = parseInt(e.target.value || "0", 10);
                                setShipQtyInputs((prev: any) => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] || {}), [sz]: isNaN(n) ? 0 : n },
                                }));
                              }}
                              onFocus={e => e.target.select()}
                              style={{
                                width: 50, textAlign: "center", padding: "4px",
                                border: `1px solid ${mismatch ? C.amber : C.border}`, borderRadius: 4,
                                background: C.card, color: mismatch ? C.amber : C.text,
                                fontSize: 12, fontFamily: C.mono, outline: "none",
                              }} />
                            <span style={{ fontSize: 8, color: C.faint, fontFamily: C.mono }}>{ordered}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginBottom: 6 }}>
                    Packing slip (optional)
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: C.card, border: `1px dashed ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, color: C.muted }}>
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        setPackingSlipFiles((prev: any) => ({ ...prev, [item.id]: f }));
                      }} />
                    <span style={{ fontSize: 16, lineHeight: 1, color: C.faint }}>＋</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {packingSlipFiles[item.id]?.name || "Click to attach your packing slip (PDF or image)"}
                    </span>
                    {packingSlipFiles[item.id] && (
                      <span onClick={e => { e.preventDefault(); e.stopPropagation(); setPackingSlipFiles((prev: any) => ({ ...prev, [item.id]: null })); }}
                        style={{ fontSize: 14, color: C.muted, padding: "0 4px" }}>×</span>
                    )}
                  </label>
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginTop: 4 }}>
                  Tracking
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={trackingInputs[item.id]?.carrier || ""}
                    onChange={e => setTrackingInputs((prev: any) => ({
                      ...prev, [item.id]: { ...prev[item.id], carrier: e.target.value, tracking: prev[item.id]?.tracking || "" }
                    }))}
                    style={{
                      width: 120, padding: "8px 10px", borderRadius: 8,
                      border: `1px solid ${C.border}`, fontSize: 12,
                      fontFamily: C.font, background: C.card,
                    }}>
                    <option value="">Carrier</option>
                    <option>UPS</option>
                    <option>FedEx</option>
                    <option>USPS</option>
                    <option>Freight</option>
                    <option>Will Call</option>
                  </select>
                  <input value={trackingInputs[item.id]?.tracking || ""}
                    onChange={e => setTrackingInputs((prev: any) => ({
                      ...prev, [item.id]: { ...prev[item.id], tracking: e.target.value, carrier: prev[item.id]?.carrier || "" }
                    }))}
                    placeholder="Tracking number"
                    style={{
                      flex: 1, minWidth: 160, padding: "8px 10px", borderRadius: 8,
                      border: `1px solid ${C.border}`, fontSize: 12,
                      fontFamily: C.font, background: C.card,
                    }} />
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

            {/* Discrepancy panel */}
            {showIssue === item.id && (
              <div style={{ marginTop: 10, background: C.amberBg, padding: 12, borderRadius: 8, border: `1px solid ${C.amberBorder}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.amber, marginBottom: 6 }}>
                  Report a discrepancy on this item
                </div>
                <textarea value={issueInputs[item.id] || ""}
                  onChange={e => setIssueInputs((prev: any) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="e.g. short M-3, over L-12"
                  style={{
                    width: "100%", minHeight: 60, padding: 10, borderRadius: 6,
                    border: `1px solid ${C.amberBorder}`, fontSize: 12,
                    fontFamily: C.font, resize: "vertical", background: C.card,
                    boxSizing: "border-box",
                  }} />
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
                    marginTop: 8, padding: "8px 18px", borderRadius: 6,
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

      {/* PO total */}
      {order.grandTotal > 0 && (
        <div style={{
          borderTop: `2px solid ${C.text}`, paddingTop: 12, marginBottom: 16,
          textAlign: "right",
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 4 }}>PO Total — Decoration</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: C.mono }}>{fmtMoney(order.grandTotal)}</div>
        </div>
      )}

      {/* Terms */}
      <div style={{
        borderTop: `1px solid ${C.border}`, paddingTop: 10,
        fontSize: 10, color: C.faint, lineHeight: 1.6,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 3 }}>House Party Distro Purchase Order Conditions</div>
        House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date.
      </div>
    </div>
  );
}

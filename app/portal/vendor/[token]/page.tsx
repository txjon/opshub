"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { sortSizes } from "@/lib/theme";
import { daysUntilDay } from "@/lib/dates";
import SizeGrid from "@/components/SizeGrid";
import { C, fmtDate, fmtMoney, daysUntil } from "./_shared/theme";
import { vendorStageFor, rollupOrderStatus } from "./_shared/StatusPill";

// Vendor Hub — mirrors the client hub's polish (KPI strip, tabs, uppercase
// color-text status, no pills). Clicking an order navigates to its own page
// (./order/[jobId] — the V2 treatment); this page is purely the list. Data
// still comes entirely from /api/portal/vendor/[token].

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
  mockupThumb: string | null; blanksOrdered: boolean; impressions?: number;
};

export default function VendorPortalPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [data, setData] = useState<{
    decorator: { name: string; shortCode: string };
    orders: Order[];
    completed: Order[];
    completedTotal?: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"active" | "past">("active");

  // Completed pagination + search
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [completedSearch, setCompletedSearch] = useState("");
  const [completedLoading, setCompletedLoading] = useState(false);
  // Initial hub load skips the (slow) completed-history scan; the Past tab
  // lazy-loads it on first open. completed[] from the initial payload only
  // holds this vendor's all-shipped ACTIVE jobs.
  const [completedLoaded, setCompletedLoaded] = useState(false);

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [params.token]);

  async function loadData() {
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}?skip_completed=1`);
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
        setCompletedLoaded(true);
      }
    } catch {}
    setCompletedLoading(false);
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
                  if (t === "past" && !completedLoaded) loadCompleted(0, "", false);
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

        {/* Orders list — each row navigates to the order's own page (V2). */}
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
              <OrderRow key={o.jobId} order={o} onOpen={() => router.push(`/portal/vendor/${params.token}/order/${o.jobId}`)} />
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
  const letters = order.items.map(it => it.letter).filter(Boolean).join("");
  const impressions = order.items.reduce((a, it) => a + (it.impressions || 0), 0);

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
            {letters && <span style={{ fontWeight: 600, color: C.faint, marginLeft: 6, letterSpacing: "0.12em" }}>{letters}</span>}
          </span>
          <span style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.clientName}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
          <span>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
          <span><b style={{ fontFamily: C.mono }}>{order.totalUnits.toLocaleString()}</b> units</span>
          {impressions > 0 && <span><b style={{ fontFamily: C.mono }}>{impressions.toLocaleString()}</b> impressions</span>}
          {order.grandTotal > 0 && <span style={{ fontFamily: C.mono, fontWeight: 700, color: C.text }}>{fmtMoney(order.grandTotal)}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ship date</div>
        <div style={{ fontSize: 13, fontWeight: 800, fontFamily: C.mono }}>{order.shipDate ? fmtDate(order.shipDate) : "TBD"}</div>
        {shipInfo && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: shipInfo.color, fontFamily: C.mono,
          }}>{shipInfo.text}</span>
        )}
      </div>
    </button>
  );
}

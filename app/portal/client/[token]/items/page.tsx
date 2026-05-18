"use client";
import { useEffect, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate, fmtDateYear, daysUntil } from "../_shared/theme";
import { ItemState, STATE_LABELS } from "@/lib/item-status";
import { StatusPill } from "../_shared/StatusPill";
import { MobileSheet } from "../_shared/MobileSheet";
import { SIZE_ORDER } from "@/lib/theme";

type Item = {
  id: string;
  name: string;
  garment_type: string | null;
  mockup_color: string | null;
  blank_vendor: string | null;
  blank_sku: string | null;
  sizes: { size: string; qty: number }[];
  qty: number;
  status: ItemState;
  thumb_id: string | null;
  created_at: string;
  client_eta: string | null;
  client_eta_note: string | null;
  archived_at: string | null;
  cost: number | null;
  retail: number | null;
  notes: string | null;
  paid: boolean;
  payment_status: "paid" | "partial" | "unpaid" | "none";
  invoice_number: string | null;
  job: {
    id: string;
    job_number: string | null;
    title: string | null;
    phase: string | null;
    target_ship_date: string | null;
    completed_at: string | null;
  };
  brief: { id: string; title: string | null; state: string } | null;
  design_id: string | null;
};

const fmtMoney = (n: number | null) => n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoneyShort = (n: number) => "$" + Math.round(n || 0).toLocaleString();

// Friendly color name for the header — items.mockup_color is often
// stored as a hex (e.g. "#ffffff") rather than a label. The Orders tab
// already does this lookup with the same table; kept here so the
// modal subtitle reads "White" rather than "#ffffff". Anything not in
// the map falls back to the raw value so unusual blanks still show.
const HEX_COLOR_NAMES: Record<string, string> = {
  "#ffffff": "White",
  "#000000": "Black",
  "#d9d9d9": "Ash",
  "#b5b5b5": "Sport Grey",
  "#808080": "Charcoal",
  "#1a1a1a": "Pitch Black",
  "#eeeeee": "Natural",
  "#f5f5dc": "Cream",
  "#8b0000": "Cardinal",
  "#b22222": "Red",
  "#000080": "Navy",
  "#228b22": "Forest",
  "#4682b4": "Royal",
  "#d2b48c": "Sand",
};
function friendlyColor(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isHex = /^#?[0-9a-f]{3,8}$/i.test(trimmed);
  if (!isHex) return trimmed;
  const norm = (trimmed.startsWith("#") ? trimmed : `#${trimmed}`).toLowerCase();
  return HEX_COLOR_NAMES[norm] || null;
}

// Color only makes sense on actual apparel. Patches, stickers, custom
// accessories, tote bags, etc. carry a mockup_color value (often the
// default #ffffff) that isn't a real product attribute — it's a stray
// default the Buy Sheet wrote. Mirrors NON_GARMENT in lib/pricing.ts /
// lib/lifecycle.ts.
const NON_GARMENT_TYPES = new Set([
  "accessory","patch","sticker","poster","pin","koozie","banner","flag",
  "lighter","towel","water_bottle","samples","custom","key_chain",
  "woven_labels","bandana","socks","tote","custom_bag","pillow","rug",
  "pens","napkins","balloons","stencils",
]);
function shouldShowColor(garmentType: string | null): boolean {
  if (!garmentType) return true;
  return !NON_GARMENT_TYPES.has(garmentType);
}

// History bucket = anything past completion. The internal model
// distinguishes "complete" (recently delivered) from "archived"
// (delivered 30+ days ago or manually archived), but on the portal
// that distinction adds noise — every done item belongs in History.
function isItemArchived(it: Item): boolean {
  return it.status === "archived" || it.status === "cancelled" || it.status === "complete";
}

// ETA resolver — manual override wins over job target ship date.
// Returns null if neither is set, OR if the item is past the in-transit
// stages (in_stock / complete / archived / cancelled). Once the item
// has landed at HPD, the "X days until delivery" countdown loses its
// meaning — the original ETA prediction was for arrival, which has
// happened. A separate fulfillment-out ETA isn't tracked.
function resolveItemEta(it: Item): { date: string; isOverride: boolean } | null {
  if (it.status === "in_stock" || it.status === "complete" || it.status === "archived" || it.status === "cancelled") {
    return null;
  }
  if (it.client_eta) return { date: it.client_eta, isOverride: true };
  if (it.job.target_ship_date) return { date: it.job.target_ship_date, isOverride: false };
  return null;
}

// Status display — same labels (STATE_LABELS) the internal worksheet
// uses; colors mapped onto the portal's C palette.
const STATUS_META: Record<ItemState, { label: string; color: string; bg: string }> = {
  setup:         { label: STATE_LABELS.setup,         color: C.muted,   bg: C.surface },
  in_production: { label: STATE_LABELS.in_production, color: C.blue,    bg: C.blueBg },
  shipped:       { label: STATE_LABELS.shipped,       color: C.purple,  bg: C.purpleBg },
  in_stock:      { label: STATE_LABELS.in_stock,      color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  complete:      { label: STATE_LABELS.complete,      color: C.green,   bg: C.greenBg },
  archived:      { label: STATE_LABELS.archived,      color: C.faint,   bg: C.surface },
  on_hold:       { label: STATE_LABELS.on_hold,       color: C.amber,   bg: C.amberBg },
  cancelled:     { label: STATE_LABELS.cancelled,     color: C.red,     bg: C.redBg },
};

// Filters mirror the internal Working Sheet — 4 active stage buckets,
// default In Production. "Complete" lives in the History view, not
// here — once an item is done, it stops being actionable in the
// current-orders surface.
const FILTERS: Array<{ key: string; label: string; matches: (s: ItemState) => boolean }> = [
  { key: "setup", label: "Setup", matches: s => s === "setup" },
  { key: "in_production", label: "In Production", matches: s => s === "in_production" },
  { key: "shipped", label: "Shipped", matches: s => s === "shipped" },
  { key: "in_stock", label: "In Stock", matches: s => s === "in_stock" },
];

export default function ItemsPage() {
  const { token } = useClientPortal();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("in_production");
  const [detail, setDetail] = useState<Item | null>(null);
  // Current orders (default) vs History. Past orders (delivered 30+ days
  // ago, or items the team manually archived) live in History so they
  // don't crowd live orders. Fixes the "wait, are my new belts already
  // delivered?" confusion when the same item ships more than once.
  // Three top-level buckets — Active (the work in flight), History
  // (anything past completion or manually archived), and On Hold (a
  // paused project's items, surfaced separately so they're findable
  // without polluting the active stage filters).
  const [view, setView] = useState<"active" | "history" | "on_hold">("active");

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${token}/items`);
      const body = await res.json();
      if (res.ok) setItems(body.items || []);
    } catch {}
    setLoading(false);
  }

  // Partition first by current vs history. The detailed status filters
  // apply within whichever bucket is showing.
  const all = items || [];
  const historyItems = all.filter(isItemArchived);
  const onHoldItems = all.filter(it => it.status === "on_hold");
  const activeItems = all.filter(it => !isItemArchived(it) && it.status !== "on_hold");
  const inView = view === "history" ? historyItems
    : view === "on_hold" ? onHoldItems
    : activeItems;

  const active = FILTERS.find(f => f.key === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  // Status filters only apply in Current Orders — every History item
  // is archived/complete/cancelled by definition, so the per-stage
  // filter rows would always return zero. In History we just search.
  const filtered = inView.filter(it => {
    if (view === "active" && !active.matches(it.status)) return false;
    if (!q) return true;
    return (
      it.name.toLowerCase().includes(q) ||
      (it.garment_type || "").toLowerCase().includes(q) ||
      (it.job.title || "").toLowerCase().includes(q) ||
      (it.job.job_number || "").toLowerCase().includes(q)
    );
  });

  const counts: Record<string, number> = { all: inView.length };
  for (const f of FILTERS) counts[f.key] = inView.filter(it => f.matches(it.status)).length;

  // KPI rollup — mirrors the worksheet's Phase/Items/Qty/Cost/Gross/Profit
  // table. Computed against the items in the active top-level view
  // (Current Orders or History).
  const rollup = (list: Item[]) => {
    let count = 0, qty = 0, cost = 0, gross = 0;
    for (const it of list) {
      const c = Number(it.cost) || 0;
      const r = Number(it.retail) || 0;
      count++; qty += it.qty;
      cost += c * it.qty;
      gross += r * it.qty;
    }
    return { count, qty, cost, gross, profit: gross - cost };
  };
  const rollups = {
    setup: rollup(inView.filter(it => it.status === "setup")),
    in_production: rollup(inView.filter(it => it.status === "in_production")),
    shipped: rollup(inView.filter(it => it.status === "shipped")),
    in_stock: rollup(inView.filter(it => it.status === "in_stock")),
    total: rollup(inView),
  };
  const ROLLUP_ROWS: { key: "setup"|"in_production"|"shipped"|"in_stock"; color: string }[] = [
    { key: "setup", color: C.muted },
    { key: "in_production", color: C.blue },
    { key: "shipped", color: C.purple },
    { key: "in_stock", color: "#14b8a6" },
  ];

  return (
    <div>
      {/* Top tabs: Active · History · On Hold */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
        {(["active", "history", "on_hold"] as const).map(v => {
          const isActive = view === v;
          const count = v === "history" ? historyItems.length
            : v === "on_hold" ? onHoldItems.length
            : activeItems.length;
          const label = v === "active" ? "Active" : v === "history" ? "History" : "On Hold";
          return (
            <button key={v}
              onClick={() => { setView(v); setFilter("in_production"); }}
              style={{
                background: "transparent", border: "none",
                padding: "10px 16px", marginBottom: -1,
                borderBottom: isActive ? `2px solid ${C.text}` : "2px solid transparent",
                color: isActive ? C.text : C.muted,
                fontSize: 14, fontWeight: isActive ? 800 : 600,
                cursor: "pointer", fontFamily: C.font,
              }}>
              {label}
              <span style={{ marginLeft: 6, fontSize: 11, color: isActive ? C.muted : C.faint, fontWeight: 600 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* KPI rollup — mirrors the internal Working Sheet so the client
          sees the same financial roll-up Jon does (their cost, retail
          if set, and profit per stage). Per-stage rows only make sense
          in Current Orders (every History item is past those stages by
          definition); skipped in History to avoid an all-zero table. */}
      {!loading && inView.length > 0 && view === "active" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Phase", "Items", "Qty", "Cost", "Gross", "Profit"].map((h, i) => (
                  <th key={h} style={{ padding: "6px 10px", fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.07em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLLUP_ROWS.map(({ key, color }) => {
                const r = rollups[key];
                return (
                  <tr key={key}>
                    <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.07em" }}>{STATE_LABELS[key]}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: C.mono, color: C.muted, textAlign: "right" }}>{r.count}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: C.mono, color: C.text, textAlign: "right" }}>{r.qty.toLocaleString()}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: C.mono, color: C.text, textAlign: "right" }}>{fmtMoneyShort(r.cost)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: C.mono, color: C.text, textAlign: "right" }}>{fmtMoneyShort(r.gross)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: C.mono, fontWeight: 600, color: C.green, textAlign: "right" }}>{fmtMoneyShort(r.profit)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
                <td style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>Total</td>
                <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text, textAlign: "right" }}>{rollups.total.count}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text, textAlign: "right" }}>{rollups.total.qty.toLocaleString()}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text, textAlign: "right" }}>{fmtMoneyShort(rollups.total.cost)}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text, textAlign: "right" }}>{fmtMoneyShort(rollups.total.gross)}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: C.mono, fontWeight: 800, color: C.green, textAlign: "right" }}>{fmtMoneyShort(rollups.total.profit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Filters + search on one row — stage filters only render in
          Current Orders. History is by definition everything past
          completion; there's no useful sub-stage to filter on, so the
          row collapses to just the search input. */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 6, alignItems: "center", marginBottom: 14 }}>
        {view === "active" && FILTERS.map(f => {
          const isActive = filter === f.key;
          const n = counts[f.key] || 0;
          return (
            <button key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "8px 0", minHeight: 40,
                background: "transparent",
                color: isActive ? C.text : C.muted,
                border: "none",
                borderBottom: isActive ? `2px solid ${C.text}` : "2px solid transparent",
                fontSize: 13, fontWeight: isActive ? 800 : 600, cursor: "pointer",
                fontFamily: C.font, marginBottom: -7,
              }}>
              {f.label} {n > 0 && <span style={{ opacity: 0.7 }}>· {n}</span>}
            </button>
          );
        })}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={view === "history" ? "Search past orders…" : view === "on_hold" ? "Search paused items…" : "Search items, garment, or project…"}
          style={{
            marginLeft: "auto", flex: "1 1 220px", maxWidth: 360,
            padding: "8px 12px", fontSize: 13,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 6, outline: "none",
            fontFamily: C.font, boxSizing: "border-box",
            marginBottom: 6,
          }}
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: "center", color: C.muted }}>
          Loading items…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted, fontSize: 13 }}>
          {(items || []).length === 0
            ? "No items yet. Once a design turns into an order, it'll land here."
            : q ? "No items match that search." : "Nothing in this filter."}
        </div>
      ) : (
        <div className="portal-items-list" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Column header — desktop-only. On mobile each row stands
              alone as a card with its own visual hierarchy. */}
          <div className="portal-items-header" style={{ display: "grid", gridTemplateColumns: view === "active" ? "minmax(0, 1fr) 60px 80px 80px 84px 110px 78px 44px" : "minmax(0, 1fr) 60px 80px 80px 44px", gap: 8, padding: "4px 10px", fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            <div>Item</div>
            <div style={{ textAlign: "right" }}>Qty</div>
            <div style={{ textAlign: "right" }}>Cost</div>
            <div style={{ textAlign: "right" }}>Retail</div>
            {view === "active" && <div style={{ textAlign: "right" }}>Profit</div>}
            {view === "active" && <div>Status</div>}
            {view === "active" && <div>ETA</div>}
            <div style={{ textAlign: "center" }}>Paid</div>
          </div>
          {/* Responsive: at ≤640px the row grid collapses to a single
              column. The Item cell hosts everything — thumb (scaled up
              from 36 → 84), name, job line, and a mobile summary row
              with status pill + qty + cost + ETA. Secondary columns
              hide entirely since the summary covers them. */}
          <style>{`
            @media (max-width: 640px) {
              .portal-items-header { display: none !important; }
              .portal-item-row {
                grid-template-columns: 1fr !important;
                padding: 12px !important;
                gap: 0 !important;
              }
              .portal-item-row__cell--name {
                align-items: flex-start !important;
                gap: 14px !important;
              }
              .portal-item-row__thumb-box {
                width: 84px !important; height: 84px !important;
                border-radius: 10px !important;
              }
              .portal-item-row__cell--qty,
              .portal-item-row__cell--cost,
              .portal-item-row__cell--retail,
              .portal-item-row__cell--profit,
              .portal-item-row__cell--status,
              .portal-item-row__cell--eta,
              .portal-item-row__cell--paid { display: none !important; }
              .portal-item-row__mobile-summary { display: flex !important; }
              .portal-item-row__name-text {
                font-size: 15px !important;
                -webkit-line-clamp: 2 !important;
              }
              .portal-item-row__job-line { font-size: 12px !important; }
            }
            .portal-item-row__mobile-summary { display: none; }
          `}</style>
          {filtered.map(it => (
            <ItemRow key={it.id} item={it} compact={view !== "active"} onOpen={() => setDetail(it)} />
          ))}
        </div>
      )}

      {detail && <ItemDetail item={detail} token={token} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Row layout matches the internal Working Sheet — same grid columns
// (Item / Qty / Cost / Retail / Profit / Status / ETA / Paid), same
// uppercase color-text status, same thumb in the name cell. Read-only
// on the client side; clicking opens the ItemDetail modal for fuller
// info + Reorder.
//
// `compact` mode (used in History) drops Profit / Status / ETA — every
// historical row sits past those columns by definition, so showing
// them is noise.
function ItemRow({ item, onOpen, compact = false }: { item: Item; onOpen: () => void; compact?: boolean }) {
  const status = STATUS_META[item.status];
  const cost = item.cost ?? null;
  const retail = item.retail ?? null;
  const profit = cost != null && retail != null ? (retail - cost) * item.qty : null;
  const eta = resolveItemEta(item);
  const cd = eta ? daysUntil(eta.date) : null;
  return (
    <button onClick={onOpen}
      className="portal-item-row"
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "10px 12px",
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0, 1fr) 60px 80px 80px 44px" : "minmax(0, 1fr) 60px 80px 80px 84px 110px 78px 44px",
        gap: 8, alignItems: "center",
        cursor: "pointer", textAlign: "left", fontFamily: C.font,
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Item cell — thumb nested inside on desktop so the 8-column
          grid template stays intact. On mobile the parent grid drops
          to 1fr and the thumb scales up via CSS (see <style> block in
          the parent). */}
      <div className="portal-item-row__cell--name"
        style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <div className="portal-item-row__thumb-box"
          style={{
            width: 36, height: 36, flexShrink: 0,
            background: "#fff", borderRadius: 6, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${C.border}`,
          }}>
          {item.thumb_id ? (
            <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
              alt="" referrerPolicy="no-referrer" loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              onError={(e: any) => { e.target.style.display = "none"; }} />
          ) : (
            <span style={{ color: C.faint, fontSize: 8 }}>—</span>
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="portal-item-row__name-text" style={{
            fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.3,
            display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
            overflow: "hidden", wordBreak: "break-word",
          }}>{item.name}</div>
          {/* Reference label — single soft line under the item name.
              Prefer the QB/Stripe invoice # once it exists (that's
              what the client recognizes), fall back to the OpsHub
              job number while the order is still pre-bill. Project
              title dropped — the item name + invoice/job # is enough
              identification and reads cleaner. */}
          <div className="portal-item-row__job-line" style={{ fontSize: 10, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.invoice_number
              ? `Invoice #${item.invoice_number}`
              : item.job.job_number || ""}
          </div>
          {/* Mobile-only summary — status pill + qty + (cost) + ETA
              chip. Tucked under the name so the row reads top-down on
              a phone instead of left-right. Hidden on desktop by the
              parent style block. */}
          <div className="portal-item-row__mobile-summary"
            style={{
              marginTop: 8, gap: 8, alignItems: "center", flexWrap: "wrap",
            }}>
            <StatusPill status={item.status} size="sm" />
            {item.qty > 0 && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>
                {item.qty.toLocaleString()} pc{item.qty === 1 ? "" : "s"}
              </span>
            )}
            {!compact && cost != null && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>
                · {fmtMoney(cost)}
              </span>
            )}
            {!compact && eta && (
              <span style={{ fontSize: 11, color: cd?.color || C.muted, fontWeight: 600 }}>
                · {fmtDate(eta.date)}{cd ? ` (${cd.text})` : ""}
              </span>
            )}
            {item.paid && (
              <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>· Paid</span>
            )}
          </div>
        </div>
      </div>

      {/* Qty */}
      <div className="portal-item-row__cell--qty" style={{ fontSize: 12, fontFamily: C.mono, color: C.text, textAlign: "right" }}>
        {item.qty > 0 ? item.qty.toLocaleString() : "—"}
      </div>

      {/* Cost */}
      <div className="portal-item-row__cell--cost" style={{ fontSize: 12, fontFamily: C.mono, color: cost != null ? C.text : C.faint, textAlign: "right" }}>
        {fmtMoney(cost)}
      </div>

      {/* Retail */}
      <div className="portal-item-row__cell--retail" style={{ fontSize: 12, fontFamily: C.mono, color: retail != null ? C.text : C.faint, textAlign: "right" }}>
        {fmtMoney(retail)}
      </div>

      {!compact && (
        <>
          {/* Profit (derived) */}
          <div className="portal-item-row__cell--profit" style={{ fontSize: 12, fontFamily: C.mono, fontWeight: 600, color: profit != null && profit > 0 ? C.green : C.faint, textAlign: "right" }}>
            {profit != null && profit !== 0 ? fmtMoneyShort(profit) : "—"}
          </div>

          {/* Status — uppercase color text, no pill */}
          <div className="portal-item-row__cell--status" style={{ fontSize: 10, fontWeight: 700, color: status.color, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
            {status.label}
          </div>

          {/* ETA */}
          <div className="portal-item-row__cell--eta" style={{ fontSize: 11, fontFamily: C.mono, color: C.muted, textAlign: "left" }}>
            {eta ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                <span style={{ color: eta.isOverride ? C.text : C.muted, fontWeight: eta.isOverride ? 600 : 500 }}>
                  {fmtDate(eta.date)}
                </span>
                {cd && (
                  <span style={{ fontSize: 9, color: cd.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {cd.text}
                  </span>
                )}
              </div>
            ) : "—"}
          </div>
        </>
      )}

      {/* Paid */}
      <div className="portal-item-row__cell--paid" style={{ textAlign: "center", fontSize: 14, color: item.paid ? C.green : C.faint }}>
        {item.paid ? "✓" : "—"}
      </div>
    </button>
  );
}

function ItemDetail({ item, token, onClose }: { item: Item; token: string; onClose: () => void }) {
  const [reordering, setReordering] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [reorderResult, setReorderResult] = useState<string | null>(null);

  async function reorder() {
    setReordering(true);
    setReorderResult(null);
    try {
      const res = await fetch(`/api/portal/client/${token}/items/${item.id}/reorder`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setReorderResult("Re-order request created — HPD will be in touch.");
      } else {
        setReorderResult(data.error || "Couldn't start re-order");
      }
    } catch {
      setReorderResult("Couldn't start re-order");
    }
    setReordering(false);
  }

  // Renders inside MobileSheet — slides up from the bottom on phone
  // widths, presents as a centered modal on desktop. Header / body /
  // footer slots are owned by the wrapper so this component just lays
  // out content. Reorder button gets primary-action weight.
  // Subtitle = item info only (brand + sku). garment_type is dropped
  // because it's the QuickBooks invoice category — internal taxonomy
  // ("tee", "patch", "hoodie") that the client doesn't need to see.
  // The actual product identification is in blank_vendor + blank_sku
  // (e.g. "Bella + Canvas · 3001 - Black", or "Patch · Embroidered").
  const subtitleBits = [item.blank_vendor, item.blank_sku]
    .filter((b): b is string => !!b);

  return (
    <MobileSheet
      open
      onClose={onClose}
      title={item.name}
      subtitle={subtitleBits.join(" · ") || undefined}
      footer={
        <>
          <button onClick={onClose}
            style={{ padding: "10px 16px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, minHeight: 44 }}>
            Close
          </button>
          <button onClick={reorder} disabled={reordering}
            style={{
              padding: "10px 20px",
              background: reordering ? C.border : C.text,
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: reordering ? "wait" : "pointer", fontFamily: C.font,
              minHeight: 44,
            }}>
            {reordering ? "Requesting…" : "Re-order this item"}
          </button>
        </>
      }
    >
      <style>{`
        @media (min-width: 640px) {
          .item-detail-body { grid-template-columns: 240px 1fr !important; }
        }
        .item-detail-thumb {
          aspect-ratio: 1; background: #fff; border-radius: 10;
          overflow: hidden; display: flex; align-items: center; justify-content: center;
          border: 1px solid ${C.border};
          padding: 0; cursor: pointer;
        }
        .item-detail-thumb:hover { border-color: ${C.text}; }
      `}</style>
      <div className="item-detail-body" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
        {/* Thumb — click to enlarge in a full-screen lightbox (same
            pattern the order-detail proof viewer uses). */}
        <button
          type="button"
          className="item-detail-thumb"
          onClick={() => { if (item.thumb_id) setLightboxOpen(true); }}
          disabled={!item.thumb_id}
          aria-label={item.thumb_id ? "Enlarge image" : "No image"}
          style={{
            aspectRatio: "1", background: "#fff", borderRadius: 10,
            overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${C.border}`,
            padding: 0, cursor: item.thumb_id ? "pointer" : "default",
            fontFamily: C.font,
          }}>
          {item.thumb_id ? (
            <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
              alt="" referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              onError={(e: any) => { e.target.style.display = "none"; }} />
          ) : (
            <span style={{ color: C.faint, fontSize: 12 }}>No preview</span>
          )}
        </button>

        {/* Meta column — Status + ETA share the top row, Quantity is
            full-width below (size list needs the room), Project +
            Invoice pair next, Design at the bottom. Clean two-column
            flow throughout. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Row 1: Status | Estimated delivery */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Status</div>
              <StatusPill status={item.status} size="md" />
            </div>
            {(() => {
              const eta = resolveItemEta(item);
              if (!eta) {
                return (
                  <div>
                    <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Estimated delivery</div>
                    <div style={{ fontSize: 13, color: C.faint }}>—</div>
                  </div>
                );
              }
              const cd = daysUntil(eta.date);
              return (
                <div>
                  <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Estimated delivery</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>{fmtDateYear(eta.date)}</div>
                    {cd && (
                      <div style={{ fontSize: 11, color: cd.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {cd.text}
                      </div>
                    )}
                  </div>
                  {item.client_eta_note && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontStyle: "italic" }}>
                      {item.client_eta_note}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Row 2: Quantity full-width with per-size breakdown laid
              out as a clean text line (no pills). */}
          <div>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Quantity</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>{item.qty ? `${item.qty.toLocaleString()} pcs` : "—"}</div>
            {item.sizes && item.sizes.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: C.muted, fontFamily: C.mono, lineHeight: 1.6 }}>
                {[...item.sizes]
                  .sort((a, b) => {
                    const ai = SIZE_ORDER.indexOf(a.size), bi = SIZE_ORDER.indexOf(b.size);
                    if (ai === -1 && bi === -1) return a.size.localeCompare(b.size);
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                  })
                  .map((s, i, arr) => (
                    <span key={s.size}>
                      <span style={{ color: C.faint, fontWeight: 700 }}>{s.size}</span>
                      <span style={{ marginLeft: 6, color: C.text }}>{s.qty}</span>
                      {i < arr.length - 1 && <span style={{ color: C.faint, margin: "0 10px" }}>·</span>}
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* Row 3: Invoice — takes the slot where Project used to
              live. Project dropped per Jon's call: the order modal
              already carries that context, so it's redundant here.
              Hidden until the order has actually been billed. */}
          {item.invoice_number && (
            <div>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Invoice</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 14, color: C.text, fontWeight: 700, fontFamily: C.mono }}>#{item.invoice_number}</div>
                {(() => {
                  const ps = item.payment_status;
                  if (ps === "none") return null;
                  const label = ps === "paid" ? "Paid" : ps === "partial" ? "Partial Paid" : "Unpaid";
                  const color = ps === "paid" ? C.green : ps === "partial" ? C.amber : C.red;
                  return (
                    <span style={{ fontSize: 11, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {label}
                    </span>
                  );
                })()}
              </div>
            </div>
          )}

          {item.brief && (
            <Meta label="Design" value={item.brief.title || "—"} sub={item.brief.state?.replace(/_/g, " ")} />
          )}
        </div>
      </div>

      {reorderResult && (
        <div style={{
          marginTop: 16,
          padding: "10px 14px",
          background: reorderResult.startsWith("Re-order request") ? C.greenBg : C.redBg,
          border: `1px solid ${reorderResult.startsWith("Re-order request") ? C.greenBorder : C.redBorder}`,
          borderRadius: 8,
          color: reorderResult.startsWith("Re-order request") ? C.green : C.red,
          fontSize: 12, fontWeight: 600,
        }}>
          {reorderResult}
        </div>
      )}

      {/* Lightbox — full-screen image viewer, same chrome the order
          detail's proof viewer uses (white background, sticky header
          with Close). Click backdrop or Esc to dismiss. Sits above
          the parent MobileSheet via higher z-index. */}
      {lightboxOpen && item.thumb_id && (
        <ImageLightbox
          src={`/api/files/thumbnail?id=${item.thumb_id}`}
          title={item.name}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </MobileSheet>
  );
}

function ImageLightbox({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#fff", zIndex: 1200,
      display: "flex", flexDirection: "column", fontFamily: C.font,
    }}>
      <div style={{
        padding: "12px 20px", borderBottom: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <button onClick={onClose} style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 13, fontWeight: 600, color: C.text,
          cursor: "pointer", padding: "8px 20px", fontFamily: C.font,
        }}>Close</button>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, padding: 20, overflow: "auto" }}>
        <img src={src} alt={title} referrerPolicy="no-referrer"
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
          onError={(e: any) => { e.target.style.display = "none"; }} />
      </div>
    </div>
  );
}

function Meta({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

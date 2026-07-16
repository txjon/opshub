"use client";
import { useEffect, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate, fmtDateYear, daysUntil } from "../_shared/theme";
import { ItemState, CLIENT_STATE_LABELS } from "@/lib/item-status";
import { StatusPill } from "../_shared/StatusPill";
import { MobileSheet } from "../_shared/MobileSheet";
import { ImageLightbox } from "@/components/DriveThumb";
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
  eta: string | null;                       // chain-resolved (override or derived); null = TBD
  eta_source: "override" | "derived" | null;
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
  // The API resolves the chain (client_eta override > derived from PO ship-by
  // + vendor transit + route buffer > null=TBD). in-hands (target_ship_date)
  // is an internal note and no longer an ETA source (locked 2026-07-15).
  if (it.eta) return { date: it.eta, isOverride: it.eta_source === "override" };
  return null;
}

// True when the item is in an active phase that warrants an ETA but
// nothing's been set yet — render "TBD" instead of an em-dash so the
// client sees a deliberate state, not a missing field. Flips back to
// a real date the moment client_eta or job.target_ship_date is set.
function isEtaTbd(it: Item): boolean {
  if (resolveItemEta(it)) return false;
  if (it.status === "in_stock" || it.status === "complete" || it.status === "archived" || it.status === "cancelled") return false;
  return true;
}

// Status display — client-facing labels (CLIENT_STATE_LABELS: internal
// vocabulary except shipped → "In Transit"); colors on the portal's C palette.
const STATUS_META: Record<ItemState, { label: string; color: string; bg: string }> = {
  setup:         { label: CLIENT_STATE_LABELS.setup,         color: C.muted,   bg: C.surface },
  in_production: { label: CLIENT_STATE_LABELS.in_production, color: C.blue,    bg: C.blueBg },
  shipped:       { label: CLIENT_STATE_LABELS.shipped,       color: C.purple,  bg: C.purpleBg },
  in_stock:      { label: CLIENT_STATE_LABELS.in_stock,      color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  complete:      { label: CLIENT_STATE_LABELS.complete,      color: C.green,   bg: C.greenBg },
  archived:      { label: CLIENT_STATE_LABELS.archived,      color: C.faint,   bg: C.surface },
  on_hold:       { label: CLIENT_STATE_LABELS.on_hold,       color: C.amber,   bg: C.amberBg },
  cancelled:     { label: CLIENT_STATE_LABELS.cancelled,     color: C.red,     bg: C.redBg },
};

// Filters mirror the internal Working Sheet — 4 active stage buckets,
// default In Production. "Complete" lives in the History view, not
// here — once an item is done, it stops being actionable in the
// current-orders surface.
const FILTERS: Array<{ key: string; label: string; matches: (s: ItemState) => boolean }> = [
  { key: "setup", label: "Setup", matches: s => s === "setup" },
  { key: "in_production", label: "In Production", matches: s => s === "in_production" },
  { key: "shipped", label: "In Transit", matches: s => s === "shipped" },
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
  // Per-view sort. Active = ETA ascending (next-due first; items with
  // no ETA sink to the bottom). History + On Hold = alphabetical by
  // item name (case-insensitive). The API hands them back newest-
  // first by created_at, which we override here.
  const byEtaAsc = (a: Item, b: Item) => {
    const ae = resolveItemEta(a)?.date || null;
    const be = resolveItemEta(b)?.date || null;
    if (!ae && !be) return (a.name || "").localeCompare(b.name || "");
    if (!ae) return 1;
    if (!be) return -1;
    return ae.localeCompare(be);
  };
  const byNameAsc = (a: Item, b: Item) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  const inView = view === "history" ? [...historyItems].sort(byNameAsc)
    : view === "on_hold" ? [...onHoldItems].sort(byNameAsc)
    : [...activeItems].sort(byEtaAsc);

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

      {/* KPI rollup — two layouts.
            • Desktop (≥641px): full table with every column (Phase /
              Items / Qty / Cost / Gross / Profit) so the back-office
              gets the same scan Jon sees in the internal worksheet.
            • Mobile (≤640px): one bold "Total" header showing Gross +
              Profit, then a vertical stack of phase cards. Drops
              Items / Qty / Cost from the mobile read since clients
              care about value + margin at-a-glance. */}
      {!loading && inView.length > 0 && view === "active" && (
        <>
          <style>{`
            @media (max-width: 640px) { .portal-kpi-table { display: none !important; } }
            @media (min-width: 641px) { .portal-kpi-cards { display: none !important; } }
          `}</style>

          {/* Desktop table */}
          <div className="portal-kpi-table" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 14, overflowX: "auto" }}>
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
                      <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.07em" }}>{CLIENT_STATE_LABELS[key]}</td>
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

          {/* Mobile card — single tight card with the Total headline
              on top and one ~24px row per phase beneath. Cuts the
              footprint roughly in half vs. one card per phase while
              keeping the at-a-glance Gross + Profit signal. */}
          <div className="portal-kpi-cards" style={{ marginBottom: 14 }}>
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: "12px 14px",
            }}>
              {/* Total headline */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total · {rollups.total.count} item{rollups.total.count === 1 ? "" : "s"}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontFamily: C.mono, lineHeight: 1.15, marginTop: 2 }}>{fmtMoneyShort(rollups.total.gross)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Profit</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.green, fontFamily: C.mono, lineHeight: 1.15, marginTop: 2 }}>{fmtMoneyShort(rollups.total.profit)}</div>
                </div>
              </div>
              {/* Per-phase rows — only show phases with content. Each
                  row is name · count on the left, gross / profit on
                  the right, all on a single line. */}
              {ROLLUP_ROWS.some(({ key }) => rollups[key].count > 0) && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 4 }}>
                  {ROLLUP_ROWS.map(({ key, color }) => {
                    const r = rollups[key];
                    if (r.count === 0) return null;
                    return (
                      <div key={key} style={{
                        display: "flex", alignItems: "baseline", justifyContent: "space-between",
                        gap: 10, fontSize: 12,
                      }}>
                        <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{CLIENT_STATE_LABELS[key]}</span>
                          <span style={{ fontSize: 10, color: C.faint, fontFamily: C.mono }}>{r.count}</span>
                        </span>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 6, fontFamily: C.mono, whiteSpace: "nowrap" }}>
                          <span style={{ color: C.muted, fontWeight: 600 }}>{fmtMoneyShort(r.gross)}</span>
                          <span style={{ color: C.faint }}>/</span>
                          <span style={{ color: C.green, fontWeight: 700 }}>{fmtMoneyShort(r.profit)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
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
            {!compact && eta && (
              <span style={{ fontSize: 11, color: cd?.color || C.muted, fontWeight: 600 }}>
                · {fmtDate(eta.date)}{cd ? ` (${cd.text})` : ""}
              </span>
            )}
            {!compact && !eta && isEtaTbd(item) && (
              <span style={{ fontSize: 11, color: C.faint, fontWeight: 700, letterSpacing: "0.05em" }}>· TBD</span>
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
            ) : isEtaTbd(item) ? (
              <span style={{ color: C.faint, fontWeight: 700, letterSpacing: "0.05em", fontFamily: C.font }}>TBD</span>
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
  const { data: portalData } = useClientPortal();
  const tenantLabel = (portalData?.company?.slug || "hpd").toUpperCase();
  const [reordering, setReordering] = useState(false);
  // Progressive image load — the thumbnail is already cached from the
  // item row preview, so it paints instantly when the sheet opens.
  // The full-res file fetches in parallel; once it lands we swap the
  // <img>'s src to the higher-quality version.
  const [imgSrc, setImgSrc] = useState<string | null>(
    item.thumb_id ? `/api/files/thumbnail?id=${item.thumb_id}&thumb=1` : null
  );
  // Click-to-enlarge lightbox. An earlier version was dropped because
  // it fought the old hand-rolled sheet's drag gesture — safe now:
  // ImageLightbox portals to document.body (escaping vaul's transform)
  // and the sheet is made non-dismissible while it's open, so closing
  // the lightbox can't fall through and close the sheet.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (!item.thumb_id) { setImgSrc(null); return; }
    const thumbUrl = `/api/files/thumbnail?id=${item.thumb_id}&thumb=1`;
    const fullUrl = `/api/files/thumbnail?id=${item.thumb_id}`;
    setImgSrc(thumbUrl);
    // Preload the full-res in the background; swap when it lands.
    const pre = new Image();
    pre.onload = () => setImgSrc(fullUrl);
    pre.src = fullUrl;
  }, [item.thumb_id]);
  const [reorderResult, setReorderResult] = useState<string | null>(null);

  async function reorder() {
    setReordering(true);
    setReorderResult(null);
    try {
      const res = await fetch(`/api/portal/client/${token}/items/${item.id}/reorder`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setReorderResult(`Re-order request created — ${tenantLabel} will be in touch.`);
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
      dismissible={!lightboxOpen}
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
      `}</style>
      <div className="item-detail-body" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
        {/* Image — thumb paints instantly, full-res swaps in once
            it's loaded (see imgSrc upgrade effect above). Click/tap
            opens the full-screen lightbox for a proper look. */}
        <button
          type="button"
          onClick={() => { if (imgSrc) setLightboxOpen(true); }}
          disabled={!imgSrc}
          aria-label={imgSrc ? "View full size" : "No image"}
          style={{
            aspectRatio: "1", background: "#fff", borderRadius: 10,
            overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${C.border}`, padding: 0,
            cursor: imgSrc ? "zoom-in" : "default", fontFamily: C.font,
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => { if (imgSrc) e.currentTarget.style.borderColor = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}>
          {imgSrc ? (
            <img src={imgSrc}
              alt={item.name} referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: "contain", transition: "opacity 0.2s" }}
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
                    {isEtaTbd(item) ? (
                      <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, letterSpacing: "0.04em" }}>TBD</div>
                    ) : (
                      <div style={{ fontSize: 13, color: C.faint }}>—</div>
                    )}
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

      {/* Full-screen viewer — portals to document.body, so it sits
          above the sheet regardless of where it renders in this tree. */}
      {lightboxOpen && item.thumb_id && (
        <ImageLightbox
          driveFileId={item.thumb_id}
          title={item.name}
          onClose={() => setLightboxOpen(false)}
        />
      )}

    </MobileSheet>
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

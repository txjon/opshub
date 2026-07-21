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
const ITEM_CATS: { key: string; label: string; match: (g: string) => boolean }[] = [
  { key: "tees", label: "Tees", match: g => g.includes("tee") || g === "tank" || g.includes("shirt") },
  { key: "hoodies", label: "Hoodies", match: g => g.includes("hoodie") || g.includes("crewneck") || g.includes("sweat") },
  { key: "hats", label: "Hats", match: g => g.includes("hat") || g.includes("beanie") || g.includes("cap") },
  { key: "patches", label: "Patches", match: g => g.includes("patch") },
];
const itemCatOf = (g: string | null) => {
  const x = (g || "").toLowerCase();
  return ITEM_CATS.find(c => c.match(x))?.key || "other";
};

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
  const [detail, setDetail] = useState<Item | null>(null);
  const [view, setView] = useState<"active" | "history" | "on_hold">("active");
  const [cat, setCat] = useState<string>("all");

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

  const all = items || [];
  const historyItems = all.filter(isItemArchived);
  const onHoldItems = all.filter(it => it.status === "on_hold");
  const activeItems = all.filter(it => !isItemArchived(it) && it.status !== "on_hold");

  const q = query.trim().toLowerCase();
  const matches = (it: Item) => !q || it.name.toLowerCase().includes(q) || (it.job.job_number || "").toLowerCase().includes(q);
  const catMatch = (it: Item) => cat === "all" || itemCatOf(it.garment_type) === cat;
  const inView = (view === "history" ? historyItems : view === "on_hold" ? onHoldItems : activeItems).filter(it => matches(it) && catMatch(it));

  // ── Financial rollup (same math as the old worksheet table) ──
  const rollup = (list: Item[]) => {
    let count = 0, qty = 0, cost = 0, gross = 0;
    for (const it of list) {
      count++; qty += it.qty;
      cost += (Number(it.cost) || 0) * it.qty;
      gross += (Number(it.retail) || 0) * it.qty;
    }
    return { count, qty, cost, gross, profit: gross - cost };
  };
  const PHASES: { key: ItemState; label: string; color: string }[] = [
    { key: "setup", label: "Setup", color: C.faint },
    { key: "in_production", label: "In Production", color: C.blue },
    { key: "shipped", label: "In Transit", color: C.purple },
    { key: "in_stock", label: "In Stock", color: "#14b8a6" },
  ];
  const byPhase = PHASES.map(p => ({ ...p, r: rollup(activeItems.filter(it => it.status === p.key)) }));
  const total = rollup(activeItems);

  // ── Timeline: every active item with a resolved ETA, today → last arrival ──
  const WEB_PREP_DAYS = 3; // prep window after landing before webstore-ready
  const timed = activeItems
    .map(it => ({ it, eta: resolveItemEta(it) }))
    .filter((x): x is { it: Item; eta: { date: string; isOverride: boolean } } => !!x.eta)
    .sort((a, b) => a.eta.date.localeCompare(b.eta.date));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAY = 86400000;
  const spanEnd = timed.length
    ? Math.max(today.getTime() + 14 * DAY, Math.max(...timed.map(x => new Date(x.eta.date + "T00:00").getTime())) + (WEB_PREP_DAYS + 3) * DAY)
    : today.getTime() + 14 * DAY;
  const spanMs = spanEnd - today.getTime();
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - today.getTime()) / spanMs) * 100));
  const weeks: { x: number; label: string }[] = [];
  for (let t = today.getTime(); t <= spanEnd; t += 7 * DAY) {
    weeks.push({ x: pct(t), label: new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) });
  }
  const tbd = activeItems.filter(it => isEtaTbd(it));
  const inStock = activeItems.filter(it => it.status === "in_stock");
  const landingSoon = timed.filter(x => new Date(x.eta.date + "T00:00").getTime() - today.getTime() <= 7 * DAY).length;

  const fmtShort = (iso: string) => new Date(iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const daysOut = (iso: string) => Math.round((new Date(iso + "T00:00").getTime() - today.getTime()) / DAY);

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .px-chip{flex-shrink:0;border-radius:999px;border:1px solid ${C.border};background:transparent;color:${C.muted};font-family:${C.mono};font-size:11px;font-weight:700;padding:8px 15px;cursor:pointer;white-space:nowrap}
        .px-chip.on{background:#fff;color:${C.bg};border-color:#fff}
        .px-kpis{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid ${C.border}}
        @media(min-width:720px){.px-kpis{grid-template-columns:repeat(4,1fr)}}
        .px-kpi{border-bottom:1px solid ${C.border};padding:20px 4px 18px}
        .px-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px}
        @media(min-width:720px){.px-grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}}
        .px-card{transition:transform .15s ease,border-color .15s ease}
        .px-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .px-timeline{display:none}
        @media(min-width:720px){.px-timeline{display:block}}
        .px-tl-name{width:150px}
        @media(min-width:720px){.px-tl-name{width:220px}}
        @media(prefers-reduced-motion:reduce){.px-card,.px-card:hover{transition:none;transform:none}}
      ` }} />

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>Items</div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 18px", textAlign: "center" }}>
        The pipeline.
      </h1>

      {/* View chips + search */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 22 }}>
        {([["active", `Active · ${activeItems.length}`], ["history", `History · ${historyItems.length}`], ["on_hold", `On hold · ${onHoldItems.length}`]] as const).map(([k, label]) => (
          <button key={k} className={`px-chip${view === k ? " on" : ""}`} onClick={() => setView(k)}>{label}</button>
        ))}
        {[{ key: "all", label: "All types" }, ...ITEM_CATS, { key: "other", label: "Everything else" }].map(c => {
          const base = view === "history" ? historyItems : view === "on_hold" ? onHoldItems : activeItems;
          const n = c.key === "all" ? base.length : base.filter(x => itemCatOf(x.garment_type) === c.key).length;
          if (n === 0 && c.key !== "all") return null;
          return <button key={c.key} className={`px-chip${cat === c.key ? " on" : ""}`} onClick={() => setCat(c.key)}>{(c as any).label} · {n}</button>;
        })}
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search pieces…"
          style={{ marginLeft: "auto", flex: "1 1 170px", maxWidth: 300, padding: "9px 14px", fontSize: 12.5, background: C.card, border: `1px solid ${C.border}`, borderRadius: 999, outline: "none", color: C.text, fontFamily: C.font, boxSizing: "border-box" }} />
      </div>

      {loading ? (
        <div style={{ color: C.faint, fontSize: 13, padding: "40px 0" }}>Loading your pipeline…</div>
      ) : view !== "active" ? (
        <Gallery items={inView} onOpen={setDetail} empty={q ? "No pieces match that search." : view === "history" ? "Nothing in history yet." : "Nothing on hold."} />
      ) : (
        <>
          {/* KPI numerals */}
          <div className="px-kpis" style={{ marginBottom: 30 }}>
            <div className="px-kpi">
              <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>Units in flight</div>
              <div style={{ fontSize: "clamp(28px,3.6vw,40px)", fontWeight: 900, lineHeight: 1.05, marginTop: 6, letterSpacing: "-0.02em" }}>{total.qty.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{total.count} pieces</div>
            </div>
            <div className="px-kpi">
              <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>Landing this week</div>
              <div style={{ fontSize: "clamp(28px,3.6vw,40px)", fontWeight: 900, lineHeight: 1.05, marginTop: 6, letterSpacing: "-0.02em", color: landingSoon > 0 ? C.purple : C.text }}>{landingSoon}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{inStock.length} already in stock</div>
            </div>
            <div className="px-kpi">
              <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>Pipeline value</div>
              <div style={{ fontSize: "clamp(28px,3.6vw,40px)", fontWeight: 900, lineHeight: 1.05, marginTop: 6, letterSpacing: "-0.02em" }}>{fmtMoneyShort(total.gross)}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>at retail</div>
            </div>
            <div className="px-kpi">
              <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>Projected profit</div>
              <div style={{ fontSize: "clamp(28px,3.6vw,40px)", fontWeight: 900, lineHeight: 1.05, marginTop: 6, letterSpacing: "-0.02em", color: C.green }}>{fmtMoneyShort(total.profit)}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{fmtMoneyShort(total.cost)} cost</div>
            </div>
          </div>

          {/* Phase value bar */}
          {total.gross > 0 && (
            <div style={{ marginBottom: 34 }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>Where the value sits</div>
              <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: C.card }}>
                {byPhase.map(p => p.r.gross > 0 && (
                  <div key={p.key} style={{ width: `${(p.r.gross / total.gross) * 100}%`, background: p.color }} title={`${p.label}: ${fmtMoneyShort(p.r.gross)}`} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
                {byPhase.map(p => p.r.count > 0 && (
                  <span key={p.key} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 10.5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, alignSelf: "center" }} />
                    <span style={{ fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>{p.label}</span>
                    <span style={{ fontFamily: C.mono, color: C.text }}>{fmtMoneyShort(p.r.gross)}</span>
                    <span style={{ fontFamily: C.mono, color: C.faint }}>· {p.r.qty.toLocaleString()} pcs</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Arrival timeline (desktop) — the drop-planning overview ── */}
          {timed.length > 0 && (
            <div className="px-timeline" style={{ marginBottom: 36 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>Landing schedule.</h2>
                <span style={{ fontSize: 10, color: C.faint, fontWeight: 700, letterSpacing: "0.06em" }}>solid = arrival at warehouse · soft = ~{WEB_PREP_DAYS}d web prep</span>
              </div>
              <div style={{ position: "relative", borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                {/* Week gridlines */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  {weeks.map((w, i) => (
                    <div key={i} style={{ position: "absolute", left: `calc(${w.x}% * (100% - 150px) / 100% + 150px)`, top: 0, bottom: 0 }} />
                  ))}
                </div>
                {timed.map(({ it, eta }) => {
                  const etaT = new Date(eta.date + "T00:00").getTime();
                  const barEnd = pct(etaT);
                  const prepEnd = pct(etaT + WEB_PREP_DAYS * DAY);
                  const color = it.status === "shipped" ? C.purple : it.status === "in_production" ? C.blue : it.status === "in_stock" ? "#14b8a6" : C.muted;
                  const d = daysOut(eta.date);
                  return (
                    <button key={it.id} onClick={() => setDetail(it)}
                      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, padding: "9px 0", cursor: "pointer", fontFamily: C.font, color: C.text, textAlign: "left" }}>
                      <div className="px-tl-name" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <div style={{ width: 30, height: 30, background: "#fff", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                          {it.thumb_id && <img src={`/api/files/thumbnail?id=${it.thumb_id}&thumb=1`} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                          <div style={{ fontSize: 9.5, color: C.faint, fontFamily: C.mono }}>{it.qty.toLocaleString()} pcs</div>
                        </div>
                      </div>
                      <div style={{ flex: 1, position: "relative", height: 22, minWidth: 0 }}>
                        <div style={{ position: "absolute", left: 0, right: 0, top: 10, height: 2, background: C.card, borderRadius: 2 }} />
                        <div style={{ position: "absolute", left: 0, width: `${barEnd}%`, top: 8, height: 6, borderRadius: 3, background: color }} />
                        <div style={{ position: "absolute", left: `${barEnd}%`, width: `${Math.max(0, prepEnd - barEnd)}%`, top: 8, height: 6, borderRadius: 3, background: color, opacity: 0.28 }} />
                        <div style={{ position: "absolute", left: `${barEnd}%`, top: 4, width: 2, height: 14, background: "#fff", borderRadius: 1 }} />
                      </div>
                      <div style={{ flexShrink: 0, width: 92, textAlign: "right" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, fontFamily: C.mono, color }}>{fmtShort(eta.date)}</div>
                        <div style={{ fontSize: 9.5, color: d <= 3 ? C.amber : C.faint, fontFamily: C.mono }}>{d <= 0 ? "landing" : `${d}d out`}</div>
                      </div>
                    </button>
                  );
                })}
                {/* Axis */}
                <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 162, paddingTop: 8, fontSize: 9, fontFamily: C.mono, color: C.faint }}>
                  <span>today</span>
                  {weeks.slice(1).map((w, i) => <span key={i}>{w.label}</span>)}
                </div>
              </div>
              {tbd.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: C.faint }}>
                  {tbd.length} piece{tbd.length === 1 ? "" : "s"} awaiting a delivery estimate — shown in the gallery below.
                </div>
              )}
            </div>
          )}

          {/* ── Drop planner: pieces grouped by when they're web-ready ── */}
          {(() => {
            const groups: { key: string; title: string; hint: string; items: Item[] }[] = [
              { key: "now", title: "Ready now.", hint: "In stock, drop whenever", items: [] },
              { key: "week", title: "This week.", hint: `Web-ready inside 7 days (arrival + ~${WEB_PREP_DAYS}d prep)`, items: [] },
              { key: "twoweeks", title: "Next two weeks.", hint: "Web-ready in 8 to 14 days", items: [] },
              { key: "month", title: "This month.", hint: "Web-ready in 2 to 5 weeks", items: [] },
              { key: "months", title: "One to three months.", hint: "The mid-range runs", items: [] },
              { key: "far", title: "Three months plus.", hint: "The long builds", items: [] },
              { key: "tbd", title: "Date pending.", hint: "No delivery estimate yet, we're on it", items: [] },
            ];
            const g = (k: string) => groups.find(x => x.key === k)!;
            for (const it of inView) {
              if (it.status === "in_stock") { g("now").items.push(it); continue; }
              const eta = resolveItemEta(it);
              if (!eta) { g("tbd").items.push(it); continue; }
              const ready = new Date(eta.date + "T00:00").getTime() + WEB_PREP_DAYS * DAY;
              const d = Math.round((ready - today.getTime()) / DAY);
              if (d <= 7) g("week").items.push(it);
              else if (d <= 14) g("twoweeks").items.push(it);
              else if (d <= 35) g("month").items.push(it);
              else if (d <= 92) g("months").items.push(it);
              else g("far").items.push(it);
            }
            const visible = groups.filter(x => x.items.length > 0);
            if (visible.length === 0) return <div style={{ color: C.muted, fontSize: 13, padding: "26px 0" }}>{q ? "No pieces match that search." : "No active pieces right now."}</div>;
            return visible.map(grp => (
              <div key={grp.key} style={{ marginBottom: 34 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{grp.title}</h2>
                  <span style={{ fontSize: 10, fontWeight: 800, color: C.faint, fontFamily: C.mono }}>{grp.items.length} piece{grp.items.length === 1 ? "" : "s"} · {grp.items.reduce((a, x) => a + x.qty, 0).toLocaleString()} pcs</span>
                  <span style={{ fontSize: 10.5, color: C.faint }}>{grp.hint}</span>
                </div>
                <Gallery items={grp.items} onOpen={setDetail} empty="" />
              </div>
            ));
          })()}
        </>
      )}

      {detail && <ItemDetail item={detail} token={token} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Gallery({ items, onOpen, empty }: { items: Item[]; onOpen: (it: Item) => void; empty: string }) {
  if (items.length === 0) return <div style={{ color: C.muted, fontSize: 13, padding: "26px 0" }}>{empty}</div>;
  return (
    <div className="px-grid">
      {items.map(it => {
        const meta = STATUS_META[it.status];
        const eta = resolveItemEta(it);
        const profit = it.cost != null && it.retail != null ? (Number(it.retail) - Number(it.cost)) * it.qty : null;
        return (
          <button key={it.id} className="px-card" onClick={() => onOpen(it)}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 0, overflow: "hidden", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
            <div style={{ background: "#fff", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {it.thumb_id
                ? <img src={`/api/files/thumbnail?id=${it.thumb_id}&thumb=1&size=500`} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                : <span style={{ color: "#bbb", fontSize: 11 }}>No preview</span>}
            </div>
            <div style={{ padding: "11px 13px 13px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{it.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.color }}>{meta.label}</span>
                <span style={{ fontSize: 9.5, color: C.faint, fontFamily: C.mono }}>{it.qty.toLocaleString()} pcs</span>
                {eta && <span style={{ fontSize: 9.5, color: C.muted, fontFamily: C.mono }}>· lands {new Date(eta.date + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
              </div>
              {profit != null && profit !== 0 && (
                <div style={{ fontSize: 10, fontFamily: C.mono, color: C.green, fontWeight: 700, marginTop: 5 }}>+{fmtMoneyShort(profit)} projected</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ItemDetail({ item, token, onClose }: { item: Item; token: string; onClose: () => void }) {
  const { data: portalData } = useClientPortal();
  const tenantLabel = (portalData?.company?.slug || "hpd").toUpperCase();
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

  // Pull request — any stage; team fulfills when goods land.
  const [pullOpen, setPullOpen] = useState(false);
  const [pullQtys, setPullQtys] = useState<Record<string, string>>({});
  const [pullDest, setPullDest] = useState("");
  const [pullBy, setPullBy] = useState("");
  const [pullNote, setPullNote] = useState("");
  const [pullBusy, setPullBusy] = useState(false);
  const [pullDone, setPullDone] = useState<string | null>(null);
  const pullSizes = (item.sizes && item.sizes.length > 0) ? item.sizes.map(s => s.size) : ["OSFA"];
  async function submitPull() {
    setPullBusy(true); setPullDone(null);
    try {
      const qtys: Record<string, number> = {};
      for (const [k, v] of Object.entries(pullQtys)) { const n = Math.round(Number(v) || 0); if (n > 0) qtys[k] = n; }
      const res = await fetch(`/api/portal/client/${token}/pulls`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, qtys, destination: pullDest.trim(), neededBy: pullBy || undefined, note: pullNote.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok) { setPullDone("Request received. We'll pull it as soon as the goods allow and confirm with you."); setPullOpen(false); setPullQtys({}); setPullDest(""); setPullBy(""); setPullNote(""); }
      else setPullDone(data.error || "Couldn't send the request.");
    } catch { setPullDone("Couldn't send the request."); }
    setPullBusy(false);
  }

  // Adds this piece to the shared reorder cart (same localStorage the
  // Reorder tab reads), prefilled with this run's sizes, then jumps there.
  function reorder() {
    try {
      const key = `hx-cart-${token}`;
      const cart = JSON.parse(localStorage.getItem(key) || "{}");
      const sizes: Record<string, number> = {};
      for (const sq of item.sizes || []) if (sq.qty > 0) sizes[sq.size] = sq.qty;
      if (Object.keys(sizes).length === 0) sizes["OSFA"] = item.qty || 0;
      cart[item.id] = { sizes };
      localStorage.setItem(key, JSON.stringify(cart));
    } catch {}
    window.location.href = `/portal/client/${token}/reorder`;
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
          <button onClick={() => { setPullOpen(o => !o); setPullDone(null); }}
            style={{ padding: "10px 16px", background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, minHeight: 44 }}>
            {pullOpen ? "Cancel pull" : "Request a pull"}
          </button>
          <button onClick={reorder}
            style={{
              padding: "10px 20px",
              background: C.accent,
              color: "#0a0a0a", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: C.font,
              minHeight: 44,
            }}>
            Add to reorder cart
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


      {pullDone && (
        <div style={{ marginTop: 16, padding: "10px 14px", background: pullDone.startsWith("Request received") ? C.greenBg : C.redBg, border: `1px solid ${pullDone.startsWith("Request received") ? C.greenBorder : C.redBorder}`, borderRadius: 8, color: pullDone.startsWith("Request received") ? C.green : C.red, fontSize: 12, fontWeight: 600 }}>
          {pullDone}
        </div>
      )}
      {pullOpen && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Request a pull</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 14px", marginBottom: 12 }}>
            {pullSizes.map(sz => (
              <label key={sz} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${C.border}`, padding: "4px 0" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, fontFamily: C.mono }}>{sz}</span>
                <input type="text" inputMode="numeric" value={pullQtys[sz] ?? ""} placeholder="0"
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => setPullQtys(prev => ({ ...prev, [sz]: e.target.value.replace(/[^0-9]/g, "") }))}
                  style={{ width: 52, padding: "7px 0", textAlign: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: C.mono, fontSize: 13, fontWeight: 700, outline: "none" }} />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={pullDest} onChange={e => setPullDest(e.target.value)} placeholder="Where's it going? (name + address or 'our office')"
              style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13, fontFamily: C.font, outline: "none" }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Need by</span>
              <input type="date" value={pullBy} onChange={e => setPullBy(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 12.5, fontFamily: C.font, outline: "none", colorScheme: "dark" }} />
            </div>
            <textarea value={pullNote} onChange={e => setPullNote(e.target.value)} rows={2} placeholder="Anything else we should know?"
              style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13, fontFamily: C.font, outline: "none", resize: "vertical" }} />
            <button onClick={submitPull} disabled={pullBusy}
              style={{ alignSelf: "flex-start", padding: "11px 22px", background: C.accent, color: "#0a0a0a", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: pullBusy ? "wait" : "pointer", fontFamily: C.font, opacity: pullBusy ? 0.6 : 1 }}>
              {pullBusy ? "Sending…" : "Send pull request"}
            </button>
          </div>
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

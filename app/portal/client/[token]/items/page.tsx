"use client";
import { useEffect, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate, fmtDateYear, daysUntil } from "../_shared/theme";
import { ItemState, STATE_LABELS } from "@/lib/item-status";

type Item = {
  id: string;
  name: string;
  garment_type: string | null;
  mockup_color: string | null;
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

// History bucket = archived or cancelled. Since the canonical lib
// already collapses Complete + 30d-grace into "archived" server-side,
// we just check the resolved state here.
function isItemArchived(it: Item): boolean {
  return it.status === "archived" || it.status === "cancelled";
}

// ETA resolver — manual override wins over job target ship date.
// Returns null if neither is set so callers can omit the line entirely.
function resolveItemEta(it: Item): { date: string; isOverride: boolean } | null {
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

// Filters mirror the internal Working Sheet — same 5 stage buckets,
// same default (In Production), no Active/All collapses. The client
// sees their items the same way Jon sees them in the worksheet.
const FILTERS: Array<{ key: string; label: string; matches: (s: ItemState) => boolean }> = [
  { key: "setup", label: "Setup", matches: s => s === "setup" },
  { key: "in_production", label: "In Production", matches: s => s === "in_production" },
  { key: "shipped", label: "Shipped", matches: s => s === "shipped" },
  { key: "in_stock", label: "In Stock", matches: s => s === "in_stock" },
  { key: "complete", label: "Complete", matches: s => s === "complete" },
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
  const [view, setView] = useState<"current" | "history">("current");

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
  const currentItems = all.filter(it => !isItemArchived(it));
  const inView = view === "history" ? historyItems : currentItems;

  const active = FILTERS.find(f => f.key === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  const filtered = inView.filter(it => {
    if (!active.matches(it.status)) return false;
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
    complete: rollup(inView.filter(it => it.status === "complete")),
    total: rollup(inView),
  };
  const ROLLUP_ROWS: { key: "setup"|"in_production"|"shipped"|"in_stock"|"complete"; color: string }[] = [
    { key: "setup", color: C.muted },
    { key: "in_production", color: C.blue },
    { key: "shipped", color: C.purple },
    { key: "in_stock", color: "#14b8a6" },
    { key: "complete", color: C.green },
  ];

  return (
    <div>
      {/* Top tabs: Current Orders vs History */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
        {(["current", "history"] as const).map(v => {
          const isActive = view === v;
          const count = v === "history" ? historyItems.length : currentItems.length;
          const label = v === "current" ? "Current Orders" : "History";
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
          if set, and profit per stage). Counts include only items in
          the active top-tab view (Current or History). */}
      {!loading && inView.length > 0 && (
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

      {/* Filters + search on one row — filters on the left (wrap on
          narrow screens), search input on the right with flex:1 so it
          fills remaining width. */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 6, alignItems: "center", marginBottom: 14 }}>
        {FILTERS.map(f => {
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
          placeholder={view === "history" ? "Search past orders…" : "Search items, garment, or project…"}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Column header — mirrors the worksheet's grid columns
              (thumb in the name cell, then qty / cost / retail /
              profit / status / eta / paid). */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 60px 80px 80px 84px 110px 78px 44px", gap: 8, padding: "4px 10px", fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            <div>Item</div>
            <div style={{ textAlign: "right" }}>Qty</div>
            <div style={{ textAlign: "right" }}>Cost</div>
            <div style={{ textAlign: "right" }}>Retail</div>
            <div style={{ textAlign: "right" }}>Profit</div>
            <div>Status</div>
            <div>ETA</div>
            <div style={{ textAlign: "center" }}>Paid</div>
          </div>
          {filtered.map(it => (
            <ItemRow key={it.id} item={it} onOpen={() => setDetail(it)} />
          ))}
        </div>
      )}

      {detail && <ItemDetail item={detail} token={token} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Row layout matches the internal Working Sheet exactly — same grid
// columns (Item / Qty / Cost / Retail / Profit / Status / ETA / Paid),
// same uppercase color-text status, same thumb in the name cell.
// Read-only on the client side; clicking opens the existing ItemDetail
// modal for fuller info + Reorder.
function ItemRow({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const status = STATUS_META[item.status];
  const cost = item.cost ?? null;
  const retail = item.retail ?? null;
  const profit = cost != null && retail != null ? (retail - cost) * item.qty : null;
  const eta = resolveItemEta(item);
  const cd = eta ? daysUntil(eta.date) : null;
  return (
    <button onClick={onOpen}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "10px 12px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 60px 80px 80px 84px 110px 78px 44px",
        gap: 8, alignItems: "center",
        cursor: "pointer", textAlign: "left", fontFamily: C.font,
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Item cell — thumb + name + job#/title meta */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
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
          <div style={{
            fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.3,
            display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
            overflow: "hidden", wordBreak: "break-word",
          }}>{item.name}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.job.job_number && <span style={{ fontFamily: C.mono }}>{item.job.job_number}</span>}
            {item.job.title && <> · {item.job.title}</>}
          </div>
        </div>
      </div>

      {/* Qty */}
      <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text, textAlign: "right" }}>
        {item.qty > 0 ? item.qty.toLocaleString() : "—"}
      </div>

      {/* Cost */}
      <div style={{ fontSize: 12, fontFamily: C.mono, color: cost != null ? C.text : C.faint, textAlign: "right" }}>
        {fmtMoney(cost)}
      </div>

      {/* Retail */}
      <div style={{ fontSize: 12, fontFamily: C.mono, color: retail != null ? C.text : C.faint, textAlign: "right" }}>
        {fmtMoney(retail)}
      </div>

      {/* Profit (derived) */}
      <div style={{ fontSize: 12, fontFamily: C.mono, fontWeight: 600, color: profit != null && profit > 0 ? C.green : C.faint, textAlign: "right" }}>
        {profit != null && profit !== 0 ? fmtMoneyShort(profit) : "—"}
      </div>

      {/* Status — uppercase color text, no pill */}
      <div style={{ fontSize: 10, fontWeight: 700, color: status.color, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
        {status.label}
      </div>

      {/* ETA */}
      <div style={{ fontSize: 11, fontFamily: C.mono, color: C.muted, textAlign: "left" }}>
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

      {/* Paid */}
      <div style={{ textAlign: "center", fontSize: 14, color: item.paid ? C.green : C.faint }}>
        {item.paid ? "✓" : "—"}
      </div>
    </button>
  );
}

function ItemDetail({ item, token, onClose }: { item: Item; token: string; onClose: () => void }) {
  const [reordering, setReordering] = useState(false);
  const [reorderResult, setReorderResult] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

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

  const status = STATUS_META[item.status];

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(12px, 3vw, 32px)", fontFamily: C.font,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 14,
          width: "min(720px, 100%)", maxHeight: "94vh", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.name}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {[item.garment_type, item.mockup_color].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
          <style>{`
            @media (min-width: 640px) {
              .item-detail-body { grid-template-columns: 240px 1fr !important; }
            }
          `}</style>
          <div className="item-detail-body" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
            {/* Thumb */}
            <div style={{
              aspectRatio: "1", background: "#fff", borderRadius: 10,
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {item.thumb_id ? (
                <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
                  alt="" referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  onError={(e: any) => { e.target.style.display = "none"; }} />
              ) : (
                <span style={{ color: C.faint, fontSize: 12 }}>No preview</span>
              )}
            </div>

            {/* Meta */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Status</div>
                <span style={{
                  color: status.color,
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {status.label}
                </span>
              </div>
              <Meta label="Quantity" value={item.qty ? `${item.qty} pcs` : "—"} />
              {(() => {
                // Estimated delivery — manual override wins. Countdown is
                // computed from today; the note is shown if the team set
                // one (e.g. "freight delay, rebooked").
                const eta = resolveItemEta(item);
                if (!eta) return null;
                const cd = daysUntil(eta.date);
                return (
                  <div>
                    <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                      Estimated delivery
                    </div>
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
              <Meta label="Project" value={item.job.title || "—"}
                sub={item.job.job_number ? `${item.job.job_number}${item.job.target_ship_date && !item.client_eta ? ` · ships ${fmtDate(item.job.target_ship_date)}` : ""}` : undefined}
              />
              {item.brief && (
                <Meta label="Design" value={item.brief.title || "—"} sub={item.brief.state?.replace(/_/g, " ")} />
              )}
            </div>
          </div>

          {reorderResult && (
            <div style={{
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
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "10px 16px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
            Close
          </button>
          <button onClick={reorder} disabled={reordering}
            style={{
              padding: "10px 20px",
              background: reordering ? C.border : C.text,
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: reordering ? "wait" : "pointer", fontFamily: C.font,
            }}>
            {reordering ? "Requesting…" : "Re-order this item"}
          </button>
        </div>
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

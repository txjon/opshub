"use client";
import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { DriveThumb } from "@/components/DriveThumb";
import { BoardFrame, ToggleSearch, KpiStrip, KpiBreakdownModal, ModalShell, Card, CardHeader, BoxHead, BoxMeta, GroupLabel, ItemRow, VariantChips, RouteTag, ItemThumb, SegmentControl, SliceSortRow } from "@/components/board-kit";
import { shipFromProduction } from "@/lib/production2-ship";
import { createPullRequest, PULL_KINDS } from "@/lib/handoff";
// @ts-ignore — plain JS component
import { NotifyShipmentDialog } from "@/components/NotifyShipmentDialog";
// @ts-ignore — plain JS helper
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import type { BoardStrip, BoardItem, ShippedBox } from "@/lib/item-state";

type SelItem = BoardItem & { strip: BoardStrip };
const TEST_JOBS = ["HPD-2605-054"]; // ship write limited here until Jon signs off

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);
const heldQty = (it: BoardItem) => it.pullRequests.reduce((a, p) => a + tQty(p.qtys), 0);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtShip(iso: string | null): { text: string; days: number | null } {
  if (!iso) return { text: "No ship date", days: null };
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const t1 = new Date(y, (m || 1) - 1, d || 1);
  const days = Math.round((t1.getTime() - t0.getTime()) / 86400000);
  return { text: `${MONTHS[(m || 1) - 1]} ${d}`, days };
}

type SortKey = "ship" | "client" | "vendor";
type MetricKey = "items" | "units" | "embellishments";
type Metric = { items: number; units: number; embellishments: number };
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "items", label: "Items" }, { key: "units", label: "Units" }, { key: "embellishments", label: "Embellishments" },
];
const nf = (n: number) => n.toLocaleString();

export default function Board({ strips, freightCarriers, shippedBoxes }: { strips: BoardStrip[]; freightCarriers: string[]; shippedBoxes: ShippedBox[] }) {
  const router = useRouter();
  const [view, setView] = useState<"production" | "shipped">("production");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [shipOpen, setShipOpen] = useState(false);
  const [pullFor, setPullFor] = useState<SelItem | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("ship");
  const [kpi, setKpi] = useState<MetricKey | null>(null);

  // KPI aggregates over the whole board (independent of the search filter).
  const agg = useMemo(() => {
    const total: Metric = { items: 0, units: 0, embellishments: 0 };
    const byVendor = new Map<string, Metric>();
    const byClient = new Map<string, Metric>();
    const bump = (m: Map<string, Metric>, k: string, it: BoardItem) => {
      const cur = m.get(k) || { items: 0, units: 0, embellishments: 0 };
      cur.items += 1; cur.units += it.orderedTotal; cur.embellishments += it.embellishments;
      m.set(k, cur);
    };
    for (const s of strips) for (const it of s.items) {
      total.items += 1; total.units += it.orderedTotal; total.embellishments += it.embellishments;
      bump(byVendor, s.decoratorName, it); bump(byClient, s.clientName, it);
    }
    return { total, byVendor, byClient };
  }, [strips]);

  const allItems = useMemo(() => {
    const m = new Map<string, BoardItem & { strip: BoardStrip }>();
    for (const s of strips) for (const it of s.items) m.set(it.itemId, { ...it, strip: s });
    return m;
  }, [strips]);

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = strips;
    if (q) out = strips.filter(s =>
      s.clientName.toLowerCase().includes(q) ||
      (s.invoiceNumber || "").toLowerCase().includes(q) ||
      s.jobNumber.toLowerCase().includes(q) ||
      s.decoratorName.toLowerCase().includes(q) ||
      s.items.some(it => it.name.toLowerCase().includes(q)));
    const byShip = (a: BoardStrip, b: BoardStrip) =>
      (a.shipDate || "9999").localeCompare(b.shipDate || "9999") || a.jobNumber.localeCompare(b.jobNumber);
    const sorted = [...out];
    if (sort === "ship") sorted.sort(byShip);
    else if (sort === "client") sorted.sort((a, b) => a.clientName.localeCompare(b.clientName) || byShip(a, b));
    else sorted.sort((a, b) => a.decoratorName.localeCompare(b.decoratorName) || byShip(a, b));
    return sorted;
  }, [strips, query, sort]);

  // Shipped view honors the same search box.
  const displayBoxes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shippedBoxes;
    return shippedBoxes.filter(b =>
      b.vendorName.toLowerCase().includes(q) ||
      (b.tracking || "").toLowerCase().includes(q) ||
      b.clients.some(c => c.toLowerCase().includes(q)) ||
      b.lines.some(l => l.itemName.toLowerCase().includes(q) || (l.invoiceNumber || "").toLowerCase().includes(q)));
  }, [shippedBoxes, query]);

  // A shipment is ONE vendor. Selection locks to the first picked item's vendor.
  const selVendor = useMemo(() => {
    for (const id of Array.from(sel)) { const it = allItems.get(id); if (it) return it.decoratorId; }
    return null;
  }, [sel, allItems]);

  const toggle = (it: BoardItem) => setSel(prev => {
    const next = new Set(prev);
    next.has(it.itemId) ? next.delete(it.itemId) : next.add(it.itemId);
    return next;
  });

  const selectedItems = useMemo<SelItem[]>(() => Array.from(sel).map(id => allItems.get(id)!).filter(Boolean), [sel, allItems]);
  const selUnits = selectedItems.reduce((a, it) => a + it.owedTotal, 0);
  const selVendorName = selectedItems[0]?.decoratorName ?? "";

  return (
    <BoardFrame title="Production">
        <ToggleSearch
          options={[["production", `In production${strips.length ? " · " + strips.reduce((a, s) => a + s.items.length, 0) : ""}`], ["shipped", `Shipped${shippedBoxes.length ? " · " + shippedBoxes.length : ""}`]]}
          value={view} onChange={setView} query={query} setQuery={setQuery} placeholder="Search client, invoice, vendor, or item…" />

        {view === "shipped" && <ShippedView boxes={displayBoxes} />}
        {view === "production" && (<>
        <KpiStrip metrics={METRICS} get={k => agg.total[k]} onClick={setKpi} />

        <div style={{ display: "flex", marginBottom: 18, justifyContent: "flex-end" }}>
          <SegmentControl label="Sort" options={[["ship", "Ship date"], ["client", "Client"], ["vendor", "Vendor"]]} value={sort} onChange={setSort} />
        </div>

        {display.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            {query ? "No strips match your search." : "Nothing in production to ship."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {display.map(strip => {
            const stripUnits = strip.items.reduce((a, i) => a + i.owedTotal, 0);
            const ship = fmtShip(strip.shipDate);
            const shipColor = ship.days == null ? T.faint : ship.days < 0 ? T.red : ship.days <= 3 ? "#a87b00" : T.text;
            return (
              <Card key={strip.key}>
                <CardHeader>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{strip.clientName}</span>
                  {strip.invoiceNumber
                    ? <Link href={`/jobs/${strip.jobId}`} style={{ fontFamily: mono, fontSize: 12, color: T.blue, textDecoration: "none", fontWeight: 600 }}>#{strip.invoiceNumber}</Link>
                    : <Link href={`/jobs/${strip.jobId}`} style={{ fontFamily: mono, fontSize: 12, color: T.faint, textDecoration: "none" }}>no invoice</Link>}
                  <RouteTag route={strip.jobRoute} />
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{strip.decoratorName}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{stripUnits}u</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: shipColor, minWidth: 78, textAlign: "right" }}>
                    {ship.text}{ship.days != null && ship.days < 0 ? " · late" : ""}
                  </span>
                </CardHeader>

                {/* items */}
                <div>
                  {strip.items.map((it, idx) => {
                    const checked = sel.has(it.itemId);
                    const blocked = selVendor !== null && it.decoratorId !== selVendor && !checked;
                    const dCol = it.daysInStage == null ? T.faint : it.daysInStage >= 7 ? T.red : it.daysInStage >= 3 ? "#a87b00" : T.faint;
                    return (
                      <label key={it.itemId}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: `1px solid ${T.border}`, cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.4 : 1, background: checked ? T.blueDim : "transparent" }}>
                        <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(it)}
                          style={{ width: 16, height: 16, accentColor: T.blue, cursor: blocked ? "not-allowed" : "pointer" }} />
                        <span style={{ width: 16, textAlign: "center", flex: "none", color: T.muted, fontWeight: 700, fontSize: 12, fontFamily: mono }}>{String.fromCharCode(65 + idx)}</span>
                        <ItemThumb fileId={it.mockupFileId} name={it.name} />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{it.name}</span>
                          {it.shippedTotal > 0 && (
                            <span style={{ fontSize: 11, color: T.muted }}>
                              {it.shippedTotal} of {it.orderedTotal} shipped · {it.shipWaves.length} wave{it.shipWaves.length > 1 ? "s" : ""}
                              {it.shipWaves.some(w => w.tracking) && (
                                <span style={{ fontFamily: mono, color: T.faint }}>{"  ·  " + it.shipWaves.map(w => w.tracking).filter(Boolean).join(", ")}</span>
                              )}
                            </span>
                          )}
                        </div>
                        {heldQty(it) > 0 && (
                          <span title={it.pullRequests.map(p => `${tQty(p.qtys)} ${p.kind || "pull"}`).join(", ")}
                            style={{ fontSize: 11, fontWeight: 600, color: T.purple }}>{heldQty(it)} held</span>
                        )}
                        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setPullFor({ ...it, strip }); }}
                          style={{ fontSize: 11, fontWeight: 600, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 7, padding: "5px 11px", cursor: "pointer" }}>Pull</button>
                        {it.daysInStage != null && (
                          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: dCol, minWidth: 26, textAlign: "right" }}>{it.daysInStage}d</span>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 56 }}>
                          <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700 }}>{it.owedTotal}</span>
                          {it.shippedTotal > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3 }}>owed</span>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
        </>)}

      {/* sticky ship bar */}
      {sel.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.card, borderTop: `1px solid ${T.border}`, boxShadow: "0 -4px 20px rgba(0,0,0,0.06)", padding: "14px 24px", zIndex: 40 }}>
          <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{sel.size} item{sel.size > 1 ? "s" : ""} selected</span>
            <span style={{ fontSize: 12, color: T.muted }}>{selVendorName} · {selUnits} units</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSel(new Set())} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", color: T.muted }}>Clear</button>
            <button onClick={() => setShipOpen(true)} style={{ fontSize: 13, fontWeight: 600, background: T.text, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer" }}>Ship {sel.size} selected →</button>
          </div>
        </div>
      )}

      {shipOpen && <ShipModal items={selectedItems} vendorName={selVendorName} decoratorId={selVendor} freightCarriers={freightCarriers}
        onClose={() => setShipOpen(false)}
        onDone={() => { setShipOpen(false); setSel(new Set()); router.refresh(); }} />}
      {pullFor && <PullModal item={pullFor} onClose={() => setPullFor(null)}
        onDone={() => { setPullFor(null); router.refresh(); }} />}
      {kpi && <KpiBreakdownModal label={METRICS.find(m => m.key === kpi)!.label} total={agg.total[kpi]} unit="total in production"
        cols={[{ title: "By vendor", rows: kpiRows(agg.byVendor, kpi) }, { title: "By client", rows: kpiRows(agg.byClient, kpi) }]}
        onClose={() => setKpi(null)} />}
    </BoardFrame>
  );
}

// Pull modal — production declares units held back (sample / photo / etc). Creates
// a pull request; receiving fulfills it, and pulled units don't carry downstream
// (they stack with any receiving pulls — H8). Per-size + kind + note (per spec).
function PullModal({ item, onClose, onDone }: { item: SelItem; onClose: () => void; onDone: () => void }) {
  const sizes = sortSizes(Object.keys(item.ordered));
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [kind, setKind] = useState<string>(PULL_KINDS[0].id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isTest = TEST_JOBS.includes(item.strip.jobNumber) || item.strip.clientName === "Playwright Test Co";
  const total = Object.values(qtys).reduce((a, n) => a + (Number(n) || 0), 0);
  const setQ = (sz: string, v: string) => setQtys(p => ({ ...p, [sz]: Math.max(0, Math.floor(Number(v) || 0)) }));

  async function confirm() {
    setBusy(true); setErr(null);
    const res = await createPullRequest(createClient(), {
      job_id: item.jobId, item_id: item.itemId, kind, qtys, reason: note.trim() || null,
    });
    setBusy(false);
    if (res) onDone(); else setErr("Pull failed.");
  }

  return (
    <ModalShell onClose={onClose} maxWidth={520} dismissable={false}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Pull from {item.name}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Hold units back — receiving keeps them out of what forwards to the client.</div>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {item.pullRequests.length > 0 && (
            <div style={{ fontSize: 12, color: T.purple, background: T.purpleDim, borderRadius: 8, padding: "8px 12px" }}>
              Already held: {item.pullRequests.map(p => `${tQty(p.qtys)} ${p.kind || "pull"}`).join(" · ")} <span style={{ color: T.faint }}>(new pulls stack)</span>
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Quantity to hold</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sizes.map(sz => (
                <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz}</span>
                  <input inputMode="numeric" value={qtys[sz] ?? 0} onChange={e => setQ(sz, e.target.value)} onFocus={e => e.target.select()}
                    style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 600, padding: "5px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Reason</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PULL_KINDS.map(k => (
                <button key={k.id} onClick={() => setKind(k.id)} style={{ fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${kind === k.id ? T.purple : T.border}`, background: kind === k.id ? T.purpleDim : T.card, color: kind === k.id ? T.purple : T.muted }}>{k.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Action — what happens to these</div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Ship to Andrew · hold for photoshoot"
              style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: font }} />
          </div>
        </div>
        <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Pull write is limited to the test job while we verify.</span>}
          {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
          <button onClick={confirm} disabled={!isTest || busy || total === 0 || !note.trim()}
            style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy || total === 0 || !note.trim()) ? "not-allowed" : "pointer", background: (!isTest || busy || total === 0 || !note.trim()) ? T.accentDim : T.purple, color: (!isTest || busy || total === 0 || !note.trim()) ? T.faint : "#fff" }}>
            {busy ? "Holding…" : total === 0 ? "Hold back" : !note.trim() ? "Add an action" : `Hold ${total} back`}
          </button>
        </div>
    </ModalShell>
  );
}

// Rows for the shared KPI breakdown modal — one metric, sorted desc.
function kpiRows(m: Map<string, Metric>, metric: MetricKey) {
  return Array.from(m.entries()).map(([name, v]) => ({ name, value: v[metric] })).filter(r => r.value > 0).sort((a, b) => b.value - a.value);
}

// Shipped view — recent boxes shipped from production, still un-received. Lets
// you notify the warehouse (or see the box) after the ship modal is long gone.
const shipHow = (box: ShippedBox) => box.pickup ? "Pickup" : [box.carrier, box.tracking].filter(Boolean).join(" · ") || "no tracking";
const routeLabel = (box: ShippedBox) => box.pickup ? "Pickup" : box.route === "stage" ? "Stage" : box.route === "drop_ship" ? "Drop-ship" : "Ship-through";
const WHEN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${WHEN_MONTHS[d.getMonth()]} ${d.getDate()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

// The Shipped view — mirrors receiving: KPIs + 3-view slice + sort, rendering the
// SAME shared box card / rows. These boxes ARE receiving's incoming shipments.
type ShippedSlice = "shipment" | "job" | "item";
type ShipSort = "date" | "vendor" | "client";
type ShipMetricKey = "boxes" | "units" | "items";
type ShipMetric = { boxes: number; units: number; items: number };
const SHIP_METRICS: { key: ShipMetricKey; label: string }[] = [{ key: "boxes", label: "Boxes" }, { key: "units", label: "Units" }, { key: "items", label: "Items" }];
type ShippedFlatLine = ShippedBox["lines"][number] & { box: ShippedBox };

function ShippedView({ boxes }: { boxes: ShippedBox[] }) {
  const [slice, setSlice] = useState<ShippedSlice>("shipment");
  const [sort, setSort] = useState<ShipSort>("date");
  const [kpi, setKpi] = useState<ShipMetricKey | null>(null);

  const agg = useMemo(() => {
    const total: ShipMetric = { boxes: boxes.length, units: 0, items: 0 };
    const byVendor = new Map<string, ShipMetric>(), byClient = new Map<string, ShipMetric>();
    const bump = (m: Map<string, ShipMetric>, k: string, units: number, isBox: boolean) => {
      const c = m.get(k) || { boxes: 0, units: 0, items: 0 }; c.units += units; c.items += 1; if (isBox) c.boxes += 1; m.set(k, c);
    };
    for (const b of boxes) { let first = true; for (const l of b.lines) { total.units += l.qty; total.items += 1; bump(byVendor, b.vendorName, l.qty, first); first = false; bump(byClient, l.client, l.qty, false); } }
    return { total, byVendor, byClient };
  }, [boxes]);

  const sorted = useMemo(() => {
    const out = [...boxes];
    const byDate = (a: ShippedBox, b: ShippedBox) => (b.createdAt || "").localeCompare(a.createdAt || "");
    if (sort === "date") out.sort(byDate);
    else if (sort === "vendor") out.sort((a, b) => a.vendorName.localeCompare(b.vendorName) || byDate(a, b));
    else out.sort((a, b) => (a.clients[0] || "").localeCompare(b.clients[0] || "") || byDate(a, b));
    return out;
  }, [boxes, sort]);

  const rows = (m: Map<string, ShipMetric>, metric: ShipMetricKey) =>
    Array.from(m.entries()).map(([name, v]) => ({ name, value: v[metric] })).filter(r => r.value > 0).sort((a, b) => b.value - a.value);

  if (!boxes.length) return (
    <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
      No shipped boxes waiting to be received.
    </div>
  );

  return (
    <>
      <KpiStrip metrics={SHIP_METRICS} get={k => agg.total[k]} onClick={setKpi} />
      <SliceSortRow>
        <SegmentControl options={[["shipment", "By shipment"], ["job", "By job"], ["item", "By item"]]} value={slice} onChange={setSlice} />
        <SegmentControl label="Sort" options={[["date", "Shipped"], ["vendor", "Vendor"], ["client", "Client"]]} value={sort} onChange={setSort} />
      </SliceSortRow>
      {slice === "shipment" && <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{sorted.map(b => <ShippedBoxCard key={b.id} box={b} />)}</div>}
      {slice === "job" && <ShippedJobView boxes={sorted} />}
      {slice === "item" && <ShippedItemView boxes={sorted} />}
      {kpi && <KpiBreakdownModal label={SHIP_METRICS.find(m => m.key === kpi)!.label} total={agg.total[kpi]} unit="shipped"
        cols={[{ title: "By vendor", rows: rows(agg.byVendor, kpi) }, { title: "By client", rows: rows(agg.byClient, kpi) }]}
        onClose={() => setKpi(null)} />}
    </>
  );
}

function ShippedBoxCard({ box }: { box: ShippedBox }) {
  const [notified, setNotified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const isTest = box.clients.every(c => c === "Playwright Test Co");
  const isDrop = box.route === "drop_ship";
  const byClient = new Map<string, ShippedBox["lines"]>();
  for (const l of box.lines) { const a = byClient.get(l.client) || []; a.push(l); byClient.set(l.client, a); }

  async function notify() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/production2/notify-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shipmentIds: [box.id], test: isTest }) });
      const d = await res.json();
      if (d.success) { setNotified(true); setTo(d.to || null); } else setErr(d.error || "Notify failed");
    } catch (e: any) { setErr(e?.message || "Notify failed"); }
    setBusy(false);
  }

  const canNotify = isTest && !busy && !notified;
  const action = isDrop
    ? <span style={{ fontSize: 12, color: T.faint }}>notify on job page</span>
    : <span onClick={canNotify ? notify : undefined}
        style={{ fontSize: 13, fontWeight: 700, cursor: canNotify ? "pointer" : "default", color: notified ? T.green : (!isTest ? T.faint : T.text) }}>
        {notified ? (to ? `✓ Sent to ${to}` : "✓ Notified") : busy ? "Sending…" : "Notify warehouse →"}
      </span>;

  const segs: { text: string; tone?: string }[] = [{ text: `${box.lines.length} item${box.lines.length > 1 ? "s" : ""} · ${box.totalUnits} units` }];
  if (!isTest && !isDrop) segs.push({ text: "Notify limited to the test job", tone: T.amber });
  if (err) segs.push({ text: err, tone: T.red });

  return (
    <Card>
      <BoxHead vendor={box.vendorName} tag={routeLabel(box)} tagColor={box.pickup ? "#a87b00" : T.blue} method={shipHow(box)}
        slips={box.hasSlip ? [{ name: "slip", url: "" }] : []} when={fmtWhen(box.createdAt)} units={box.totalUnits} action={action} />
      <BoxMeta segments={segs} />
      {Array.from(byClient.entries()).map(([client, lines]) => (
        <div key={client}>
          <GroupLabel label={client} sub={lines[0]?.invoiceNumber ? `#${lines[0].invoiceNumber}` : null} />
          {lines.map((l, i) => (
            <div key={i} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
              <ItemRow fileId={l.mockupFileId} name={l.itemName} route={box.route} variant={<VariantChips qtys={l.qtys} />} qty={l.qty} />
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}

function ShippedJobView({ boxes }: { boxes: ShippedBox[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { client: string; invoice: string | null; lines: ShippedFlatLine[] }>();
    for (const b of boxes) for (const l of b.lines) {
      const key = `${l.client}::${l.invoiceNumber || ""}`;
      const g = m.get(key) || { client: l.client, invoice: l.invoiceNumber, lines: [] };
      g.lines.push({ ...l, box: b }); m.set(key, g);
    }
    return Array.from(m.values());
  }, [boxes]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map((g, i) => (
        <Card key={i}>
          <CardHeader>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{g.client}</span>
            {g.invoice && <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>#{g.invoice}</span>}
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{g.lines.reduce((a, l) => a + l.qty, 0)}u</span>
          </CardHeader>
          {g.lines.map((l, j) => (
            <div key={j} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
              <ItemRow fileId={l.mockupFileId} name={l.itemName} route={l.box.route}
                sub={<div style={{ fontSize: 11, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.box.vendorName} · {shipHow(l.box)}</div>}
                variant={<VariantChips qtys={l.qtys} />} qty={l.qty} />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function ShippedItemView({ boxes }: { boxes: ShippedBox[] }) {
  const lines = useMemo(() => boxes.flatMap(b => b.lines.map(l => ({ ...l, box: b }))), [boxes]);
  return (
    <Card>
      {lines.map((l, i) => (
        <div key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.border}`, padding: "10px 16px" }}>
          <ItemRow fileId={l.mockupFileId} name={l.itemName} route={l.box.route}
            sub={<div style={{ fontSize: 11, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.client}{l.invoiceNumber ? ` · #${l.invoiceNumber}` : ""} · {l.box.vendorName}</div>}
            variant={<VariantChips qtys={l.qtys} />} qty={l.qty} />
        </div>
      ))}
    </Card>
  );
}

const PARCEL_CARRIERS = ["UPS", "DHL", "FedEx", "USPS"];

// Ship modal — writes the shipment. Per-item qty (default owed) + final flag,
// carrier + tracking/BOL/pickup, vendor packing slip. Confirm is gated to the
// test job. On success it flips to a done screen (Notify warehouse / Done).
function ShipModal({ items, vendorName, decoratorId, freightCarriers, onClose, onDone }:
  { items: SelItem[]; vendorName: string; decoratorId: string | null; freightCarriers: string[]; onClose: () => void; onDone: () => void }) {
  // The items in the CURRENT wave. After a partial ship, "Ship next wave" narrows
  // this to whatever still has units owed (computed locally so we don't need a
  // server round-trip mid-modal — the board refreshes to truth on close).
  const [activeItems, setActiveItems] = useState<SelItem[]>(items);
  const [method, setMethod] = useState<"tracking" | "bol" | "pickup">("tracking");
  const [ref, setRef] = useState("");
  const [parcelCarrier, setParcelCarrier] = useState(/one\s*stop/i.test(vendorName) ? "DHL" : "UPS");
  const [freightCarrier, setFreightCarrier] = useState("");
  const [note, setNote] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipDrag, setSlipDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const it of items) init[it.itemId] = { ...(Object.keys(it.owed).length ? it.owed : it.ordered) };
    return init;
  });
  const [final, setFinal] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Shipping…");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ shipped: number; boxes: number; boxIds: string[]; jobIds: string[] } | null>(null);
  const [notified, setNotified] = useState(false);
  const [notifyTo, setNotifyTo] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyErr, setNotifyErr] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [contacts, setContacts] = useState<{ name: string; email: string; role: string }[]>([]);

  // Notify branches on route: drop_ship → the client (the shared contact-picker
  // dialog), ship_through / stage → the warehouse via our own /production2 path
  // (no invoice gate; client → items → qtys + slip links).
  const primary = activeItems[0];
  const shipRoute = (primary?.route as string) || "ship_through";
  const isDrop = shipRoute === "drop_ship";

  async function openNotify() {
    if (isDrop) {
      if (primary) {
        const sb = createClient();
        const { data } = await sb.from("job_contacts").select("role_on_job, contacts(name, email)").eq("job_id", primary.jobId);
        setContacts(((data as any[]) || []).map(r => ({ name: r.contacts?.name || "Unnamed", email: r.contacts?.email || "", role: r.role_on_job || "" })).filter(c => c.email));
      }
      setNotifyOpen(true);
    } else {
      await notifyWarehouse();
    }
  }

  async function notifyWarehouse() {
    setNotifyBusy(true); setNotifyErr(null);
    try {
      const res = await fetch("/api/production2/notify-warehouse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentIds: done?.boxIds || [], note, test: isTest }),
      });
      const data = await res.json();
      if (data.success) { setNotified(true); setNotifyTo(data.to || null); } else setNotifyErr(data.error || "Notify failed");
    } catch (e: any) { setNotifyErr(e?.message || "Notify failed"); }
    setNotifyBusy(false);
  }

  const isTest = activeItems.every(it => TEST_JOBS.includes(it.strip.jobNumber) || it.strip.clientName === "Playwright Test Co");
  const itemTotal = (id: string) => Object.values(qtys[id] || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  const totalUnits = activeItems.reduce((a, it) => a + itemTotal(it.itemId), 0);

  // Compute what remains owed after the wave we just shipped (final-flagged items
  // close to 0). Drives the "N still in production" line + the Ship-next-wave set.
  function remainingAfterWave(): SelItem[] {
    return activeItems.map(it => {
      if (final[it.itemId]) return { ...it, owed: {}, owedTotal: 0 };
      const base = Object.keys(it.owed).length ? it.owed : it.ordered;
      const shipped = qtys[it.itemId] || {};
      const owed: Record<string, number> = {};
      for (const sz of Object.keys(base)) owed[sz] = Math.max(0, (base[sz] || 0) - (shipped[sz] || 0));
      return { ...it, owed, owedTotal: Object.values(owed).reduce((a, n) => a + n, 0) };
    }).filter(it => it.owedTotal > 0);
  }
  const setQ = (id: string, sz: string, v: string) =>
    setQtys(prev => ({ ...prev, [id]: { ...prev[id], [sz]: Math.max(0, Math.floor(Number(v) || 0)) } }));

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const sb = createClient();
      // upload the vendor packing slip first (if any)
      let packingSlipFileId: string | null = null;
      if (slipFile) {
        setBusyLabel("Uploading packing slip…");
        const up = await (uploadToDrive as any)({
          blob: slipFile, fileName: slipFile.name, mimeType: slipFile.type || "application/octet-stream",
          clientName: activeItems[0].strip.clientName, projectTitle: activeItems[0].strip.jobTitle, itemName: "Packing Slips",
        });
        for (const it of activeItems) {
          // registerFileInDb returns the item_files ROW; its .id (a UUID) is what
          // shipments.packing_slip_file_id expects — NOT the Drive file id.
          const reg: any = await registerFileInDb({
            fileId: up.fileId, webViewLink: up.webViewLink, folderLink: up.folderLink,
            fileName: slipFile.name, mimeType: slipFile.type, fileSize: slipFile.size,
            itemId: it.itemId, stage: "packing_slip", notes: up.folderLink,
          });
          if (!packingSlipFileId && reg?.id) packingSlipFileId = reg.id;
        }
      }
      setBusyLabel("Shipping…");
      const carrier = method === "tracking" ? parcelCarrier : method === "bol" ? freightCarrier.trim() || null : null;
      const res = await shipFromProduction(sb, {
        method, tracking: method === "tracking" ? ref : null, bol: method === "bol" ? ref : null,
        carrier, packingSlipFileId, note, decoratorId, decoratorName: vendorName,
        items: activeItems.map(it => ({ itemId: it.itemId, jobId: it.jobId, itemName: it.name, qtys: qtys[it.itemId] || {}, final: !!final[it.itemId] })),
      });
      setBusy(false); setBusyLabel("Shipping…");
      if (res.ok) setDone({ shipped: res.shipped, boxes: res.boxes, boxIds: res.boxIds, jobIds: res.jobIds });
      else setErr(res.error || "Ship failed.");
    } catch (e: any) { setBusy(false); setErr(e?.message || "Ship failed."); }
  }

  // Re-scope the modal to whatever still owes units and start a fresh wave.
  function shipNextWave() {
    const remaining = remainingAfterWave();
    if (!remaining.length) { onDone(); return; }
    const nextQ: Record<string, Record<string, number>> = {};
    for (const it of remaining) nextQ[it.itemId] = { ...it.owed };
    setActiveItems(remaining);
    setQtys(nextQ); setFinal({}); setRef(""); setSlipFile(null);
    setNotified(false); setNotifyTo(null); setNotifyErr(null); setDone(null);
  }

  // ── success screen ──
  if (done) {
    const stillOwed = remainingAfterWave();
    const stillOwedUnits = stillOwed.reduce((a, it) => a + it.owedTotal, 0);
    return (
      <>
      <ModalShell onClose={onDone} maxWidth={480}>
        <div style={{ padding: "28px 26px", textAlign: "center" }}>
          <div style={{ width: 46, height: 46, borderRadius: 999, background: T.greenDim, color: T.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 12px" }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Shipped {done.shipped} units</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 3 }}>{vendorName} · {done.boxes} box{done.boxes > 1 ? "es" : ""} → receiving</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 8 }}>
            {stillOwedUnits > 0
              ? <>This shipment is now in Receiving. <b style={{ color: T.text }}>{stillOwedUnits} still in production</b> for the next wave.</>
              : <>This shipment is now in Receiving. Everything selected is fully shipped.</>}
          </div>
          {notifyErr && <div style={{ fontSize: 12, color: T.red, fontWeight: 600, marginTop: 14 }}>{notifyErr}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: notifyErr ? 10 : 22, justifyContent: "center", flexWrap: "wrap" }}>
            {stillOwedUnits > 0 && (
              <button onClick={shipNextWave}
                style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "10px 18px", cursor: "pointer", border: `1px solid ${T.border}`, background: T.card, color: T.text }}>
                Ship next wave
              </button>
            )}
            <button onClick={openNotify} disabled={notified || notifyBusy}
              style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "10px 18px", cursor: (notified || notifyBusy) ? "default" : "pointer", border: `1px solid ${T.border}`, background: notified ? T.greenDim : T.card, color: notified ? T.green : T.text }}>
              {notified ? (notifyTo ? `✓ Sent to ${notifyTo}` : isDrop ? "✓ Client notified" : "✓ Warehouse notified") : notifyBusy ? "Sending…" : isDrop ? "Notify client" : "Notify warehouse"}
            </button>
            <button onClick={onDone} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "10px 22px", border: "none", cursor: "pointer", background: T.text, color: "#fff" }}>Done</button>
          </div>
        </div>
      </ModalShell>
      {notifyOpen && primary && (
        <NotifyShipmentDialog open={notifyOpen} onClose={() => setNotifyOpen(false)} onSent={() => { setNotified(true); setNotifyOpen(false); }}
          route={shipRoute} jobId={primary.jobId} decoratorId={decoratorId} decoratorName={vendorName}
          tracking={ref || null} qbInvoiceNumber={primary.strip.invoiceNumber || ""} clientName={primary.strip.clientName}
          jobTitle={primary.strip.jobTitle} contacts={contacts as any} initialMessage={note} />
      )}
      </>
    );
  }

  // ── ship form ── (backdrop click does NOT close — only Cancel, to avoid losing input)
  return (
    <ModalShell onClose={onClose} maxWidth={660} dismissable={false}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Ship from production</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{vendorName} · {activeItems.length} item{activeItems.length > 1 ? "s" : ""} · {totalUnits} units → one shipment</div>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* method */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>How it's leaving</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["tracking", "bol", "pickup"] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: "8px 0", borderRadius: 8, cursor: "pointer", border: `1px solid ${method === m ? T.text : T.border}`, background: method === m ? T.text : T.card, color: method === m ? "#fff" : T.muted }}>
                  {m === "tracking" ? "Tracking #" : m === "bol" ? "Freight BOL" : "Pickup"}
                </button>
              ))}
            </div>
            {/* tracking: carrier dropdown + tracking # */}
            {method === "tracking" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <select value={parcelCarrier} onChange={e => setParcelCarrier(e.target.value)}
                  style={{ fontSize: 13, padding: "9px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
                  {PARCEL_CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Tracking number"
                  style={{ flex: 1, boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: mono }} />
              </div>
            )}
            {/* BOL: freight carrier (learning datalist) + BOL # */}
            {method === "bol" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input value={freightCarrier} onChange={e => setFreightCarrier(e.target.value)} list="p2-freight-carriers" placeholder="Freight carrier"
                  style={{ width: 190, boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: font }} />
                <datalist id="p2-freight-carriers">{freightCarriers.map(c => <option key={c} value={c} />)}</datalist>
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="BOL number"
                  style={{ flex: 1, boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: mono }} />
              </div>
            )}
            {/* pickup: auto-stamp vendor + now (nothing to type) */}
            {method === "pickup" && (
              <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: T.green, background: T.greenDim, border: `1px solid ${T.green}`, borderRadius: 8, padding: "8px 12px", fontFamily: mono }}>
                Pickup · {vendorName} · {fmtWhen(new Date().toISOString())}
              </div>
            )}
          </div>

          {/* per-item qty + final */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeItems.map(it => {
              const sizes = sortSizes(Object.keys(it.owed).length ? Object.keys(it.owed) : Object.keys(it.ordered));
              const shippedNow = itemTotal(it.itemId);
              const remainAfter = it.owedTotal - shippedNow;
              const threshold = Math.max(1, Math.ceil(it.orderedTotal * 0.05));
              const nudge = !final[it.itemId] && shippedNow > 0 && remainAfter >= 0 && remainAfter <= threshold;
              return (
                <div key={it.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</span>
                    <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{itemTotal(it.itemId)}u</span>
                    <div style={{ flex: 1 }} />
                    <label style={{ fontSize: 11, color: final[it.itemId] ? T.text : T.muted, fontWeight: final[it.itemId] ? 600 : 400, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!final[it.itemId]} onChange={e => setFinal(p => ({ ...p, [it.itemId]: e.target.checked }))} style={{ accentColor: T.blue }} /> final shipment
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {sizes.map(sz => (
                      <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz}</span>
                        <input inputMode="numeric" value={qtys[it.itemId]?.[sz] ?? 0} onChange={e => setQ(it.itemId, sz, e.target.value)}
                          onFocus={e => e.target.select()}
                          style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 600, padding: "5px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
                      </label>
                    ))}
                  </div>
                  {nudge && (
                    <button onClick={() => setFinal(p => ({ ...p, [it.itemId]: true }))}
                      style={{ marginTop: 9, width: "100%", textAlign: "left", fontSize: 11.5, fontWeight: 600, color: "#a87b00", background: T.amberDim, border: `1px solid ${T.amber}`, borderRadius: 7, padding: "6px 10px", cursor: "pointer" }}>
                      Looks like this finishes the order — mark as final? {remainAfter > 0 ? `The remaining ${remainAfter} would close it out.` : "This closes it out."}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* vendor packing slip — drag & drop or click to browse */}
          <div
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setSlipDrag(true); }}
            onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setSlipDrag(true); }}
            onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setSlipDrag(false); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setSlipDrag(false); const f = Array.from(e.dataTransfer.files || [])[0]; if (f) setSlipFile(f as File); }}
            onClick={() => fileRef.current?.click()}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13, cursor: "pointer", border: `1.5px dashed ${slipDrag ? T.blue : T.border}`, borderRadius: 8, padding: "14px 12px", color: slipFile ? T.text : T.muted, background: slipDrag ? T.blueDim : "transparent", textAlign: "center" }}>
            <span style={{ fontWeight: 600 }}>{slipFile ? "📎 " + slipFile.name : "Drag vendor packing slip here, or click to browse"}</span>
            {slipFile && <span onClick={e => { e.stopPropagation(); setSlipFile(null); }} style={{ color: T.red, fontSize: 12 }}>remove</span>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={e => setSlipFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
          </div>

          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for the warehouse (optional)"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: font }} />
        </div>

        <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Ship write is limited to the test job while we verify.</span>}
          {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: busy ? "default" : "pointer", color: T.muted }}>Cancel</button>
          <button onClick={confirm} disabled={!isTest || busy || totalUnits === 0}
            style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy || totalUnits === 0) ? "not-allowed" : "pointer", background: (!isTest || busy || totalUnits === 0) ? T.accentDim : T.text, color: (!isTest || busy || totalUnits === 0) ? T.faint : "#fff" }}>
            {busy ? busyLabel : `Confirm ship · ${totalUnits}u`}
          </button>
        </div>
    </ModalShell>
  );
}

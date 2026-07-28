"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { parseDay, daysUntilDay } from "@/lib/dates";
import { BoardFrame, ToggleSearch, KpiStrip, KpiBreakdownModal, ModalShell, Card, CardHeader, ItemRow, RowMenu, VariantChips, RouteTag, ItemThumb, SegmentControl, SliceSortRow } from "@/components/board-kit";
import { receiveBox as receiveBoxAction, resolvePull, returnReceivedLine, editReceivedLine, editShippedLine, returnIncomingToProduction } from "@/lib/receiving2-receive";
import { PULL_KINDS } from "@/lib/handoff";
import LedgerHistory from "@/components/LedgerHistory";
import { TrackingLink } from "@/components/TrackingModal";
import type { ReceivingBox, ReceivingLine, HeldPull } from "@/lib/item-state";
import { v2WriteAllowed } from "@/lib/v2-flags";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const subQtys = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]))) {
    const v = (Number(a?.[k]) || 0) - (Number(b?.[k]) || 0);
    if (v > 0) out[k] = v;
  }
  return out;
};
const chunk = <T,>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const boxHow = (b: ReceivingBox) => b.pickup ? "Pickup" : [b.carrier, b.tracking].filter(Boolean).join(" · ") || "no tracking";
// where a received item goes next, by route
const destOf = (route: string) => route === "stage" ? "Fulfillment" : route === "drop_ship" ? "Client" : "Shipping";
// expected_arrival is a DATE column — bare new Date() parsed it as UTC
// midnight and showed the previous day (and disagreed with receiving v1).
function fmtDay(iso: string | null): string {
  const d = iso ? parseDay(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
// LineActions — row handlers threaded down. Received: Edit / Return-to-receiving /
// History. Incoming: Return-to-production / History.
type EditMode = "received" | "shipped";
type LineActions = { onEdit: (l: ReceivingLine, b: ReceivingBox) => void; onEditShipped: (l: ReceivingLine, b: ReceivingBox) => void; onReturn: (l: ReceivingLine, b: ReceivingBox) => void; onReturnProd: (l: ReceivingLine, b: ReceivingBox) => void; onHistory: (l: ReceivingLine) => void; busyKey: string | null };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MetricKey = "boxes" | "units" | "items";
type Metric = { boxes: number; units: number; items: number };
const METRICS: { key: MetricKey; label: string }[] = [{ key: "boxes", label: "Boxes" }, { key: "units", label: "Units" }, { key: "items", label: "Items" }];
type Status = "incoming" | "received" | "pulls";
type ViewKey = "shipment" | "job" | "item";
type FlatLine = ReceivingLine & { box: ReceivingBox };

// The qty a line shows depends on the tab: what to receive (shipped) vs what came in (received).
const qtyOf = (l: ReceivingLine, status: Status) => status === "received" ? l.receivedQtys : l.shipQtys;
const boxUnits = (b: ReceivingBox, status: Status) => status === "received" ? b.receivedUnits : b.totalUnits;

export default function Board({ boxes, pulls }: { boxes: ReceivingBox[]; pulls: HeldPull[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("incoming");
  const [view, setView] = useState<ViewKey>("shipment");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [query, setQuery] = useState("");
  const [kpi, setKpi] = useState<MetricKey | null>(null);
  const [receiveBox, setReceiveBox] = useState<ReceivingBox | null>(null);
  const [etaFor, setEtaFor] = useState<ReceivingBox | null>(null);
  const [editFor, setEditFor] = useState<{ line: ReceivingLine; box: ReceivingBox; mode: EditMode } | null>(null);
  const [historyFor, setHistoryFor] = useState<ReceivingLine | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function returnLine(l: ReceivingLine, b: ReceivingBox) {
    setBusyKey(`${b.id}:${l.itemId}`);
    const res = await returnReceivedLine(createClient(), { shipmentId: b.id, itemId: l.itemId, jobId: l.jobId, itemName: l.itemName });
    setBusyKey(null);
    if (res.ok) router.refresh();
  }
  async function returnToProd(l: ReceivingLine, b: ReceivingBox) {
    setBusyKey(`${b.id}:${l.itemId}`);
    const res = await returnIncomingToProduction(createClient(), { shipmentId: b.id, itemId: l.itemId, jobId: l.jobId, itemName: l.itemName });
    setBusyKey(null);
    if (res.ok) router.refresh();
  }
  // "box not found?" on a delivered-not-received card — carrier says delivered
  // but the box never appeared. A human flag (delivered_not_found_at), NOT a
  // receive: received_at stays human-only and untouched.
  async function flagNotFound(b: ReceivingBox, on: boolean) {
    await (createClient().from("shipments") as any).update({ delivered_not_found_at: on ? new Date().toISOString() : null }).eq("id", b.id);
    router.refresh();
  }
  const acts: LineActions = { onEdit: (line, box) => setEditFor({ line, box, mode: "received" }), onEditShipped: (line, box) => setEditFor({ line, box, mode: "shipped" }), onReturn: returnLine, onReturnProd: returnToProd, onHistory: setHistoryFor, busyKey };

  const incoming = useMemo(() => boxes.filter(b => !b.allReceived), [boxes]);
  const received = useMemo(() => boxes.filter(b => b.allReceived), [boxes]);
  const active = status === "incoming" ? incoming : status === "received" ? received : [];

  const vendorOptions = useMemo(() => Array.from(new Set(active.map(b => b.vendorName))).sort(), [active]);
  const clientOptions = useMemo(() => Array.from(new Set(active.flatMap(b => b.clients))).sort(), [active]);

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = active;
    if (filterVendor) out = out.filter(b => b.vendorName === filterVendor);
    if (filterClient) out = out.filter(b => b.clients.includes(filterClient));
    if (q) out = out.filter(b =>
      b.vendorName.toLowerCase().includes(q) || (b.tracking || "").toLowerCase().includes(q) ||
      b.clients.some(c => c.toLowerCase().includes(q)) ||
      b.lines.some(l => l.itemName.toLowerCase().includes(q) || (l.invoiceNumber || "").toLowerCase().includes(q)));
    out = [...out];
    // fixed sort: incoming = soonest ETA first (no ETA sinks, tie-break oldest
    // ship first); received = latest received first.
    if (status === "received") out.sort((a, b) => (b.receivedAt || b.createdAt || "").localeCompare(a.receivedAt || a.createdAt || ""));
    else out.sort((a, b) =>
      (a.expectedArrival || "9999").localeCompare(b.expectedArrival || "9999") ||
      (a.createdAt || "").localeCompare(b.createdAt || ""));
    return out;
  }, [active, query, filterVendor, filterClient, status]);

  // Delivered-not-received queue (D3/D4, locked 2026-07-16): carrier says
  // delivered, no human has received — pinned ABOVE incoming, newest-delivered
  // first ("annoying by design"). Splits AFTER filters/search so both halves
  // respect them. Received tab never queues.
  const [queue, inTransit] = useMemo(() => {
    if (status !== "incoming") return [[], display] as [ReceivingBox[], ReceivingBox[]];
    const q = display.filter(b => b.deliveredAt).sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || ""));
    return [q, display.filter(b => !b.deliveredAt)] as [ReceivingBox[], ReceivingBox[]];
  }, [display, status]);

  const agg = useMemo(() => {
    const total: Metric = { boxes: active.length, units: 0, items: 0 };
    const byVendor = new Map<string, Metric>(), byClient = new Map<string, Metric>();
    const bump = (m: Map<string, Metric>, k: string, units: number, isBox: boolean) => {
      const cur = m.get(k) || { boxes: 0, units: 0, items: 0 };
      cur.units += units; cur.items += 1; if (isBox) cur.boxes += 1; m.set(k, cur);
    };
    for (const b of active) {
      let first = true;
      for (const l of b.lines) {
        const u = tQty(qtyOf(l, status)); total.units += u; total.items += 1;
        bump(byVendor, b.vendorName, u, first); first = false;
        bump(byClient, l.client, u, false);
      }
    }
    return { total, byVendor, byClient };
  }, [active, status]);

  const rows = (m: Map<string, Metric>, metric: MetricKey) =>
    Array.from(m.entries()).map(([name, v]) => ({ name, value: v[metric] })).filter(r => r.value > 0).sort((a, b) => b.value - a.value);

  return (
    <BoardFrame title="Receiving">
      <ToggleSearch options={[["incoming", `Incoming · ${incoming.length}`], ["received", `Received · ${received.length}`], ["pulls", `Pulls · ${pulls.length}`]]}
        value={status} onChange={setStatus} query={query} setQuery={setQuery} placeholder="Search vendor, client, invoice, item, or tracking…" />

      {status === "pulls" ? (
        <PullsView pulls={pulls} query={query} onResolved={() => router.refresh()} />
      ) : (<>
        <KpiStrip metrics={METRICS} get={k => agg.total[k]} onClick={setKpi} />
        <SliceSortRow>
          <SegmentControl options={[["shipment", "By shipment"], ["job", "By job"], ["item", "By item"]]} value={view} onChange={setView} />
          <div style={{ display: "flex", gap: 8 }}>
            <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              style={{ padding: "9px 14px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: font, outline: "none", cursor: "pointer" }}>
              <option value="">All vendors</option>
              {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
              style={{ padding: "9px 14px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: font, outline: "none", cursor: "pointer" }}>
              <option value="">All clients</option>
              {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </SliceSortRow>

        {display.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            {query ? "No boxes match your search." : status === "incoming" ? "Nothing incoming to receive." : "Nothing received yet."}
          </div>
        )}

        {view === "shipment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {queue.length > 0 && (
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.red, marginBottom: -4 }}>
                Delivered — not received · {queue.length}
              </div>
            )}
            {queue.map(box => <BoxCard key={box.id} box={box} status={status} onReceive={() => setReceiveBox(box)} onAdjustEta={setEtaFor} onFlagNotFound={flagNotFound} acts={acts} />)}
            {queue.length > 0 && inTransit.length > 0 && (
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.faint, margin: "6px 0 -4px" }}>
                In transit · {inTransit.length}
              </div>
            )}
            {inTransit.map(box => <BoxCard key={box.id} box={box} status={status} onReceive={() => setReceiveBox(box)} onAdjustEta={setEtaFor} onFlagNotFound={flagNotFound} acts={acts} />)}
          </div>
        )}
        {view === "job" && <JobView boxes={display} status={status} onReceive={setReceiveBox} acts={acts} />}
        {view === "item" && <ItemView boxes={display} status={status} onReceive={setReceiveBox} acts={acts} />}
      </>)}

      {kpi && <KpiBreakdownModal label={METRICS.find(m => m.key === kpi)!.label} total={agg.total[kpi]} unit={status}
        cols={[{ title: "By vendor", rows: rows(agg.byVendor, kpi) }, { title: "By client", rows: rows(agg.byClient, kpi) }]}
        onClose={() => setKpi(null)} />}
      {receiveBox && <ReceiveModal box={receiveBox} onClose={() => setReceiveBox(null)}
        onDone={() => { setReceiveBox(null); router.refresh(); }} />}
      {etaFor && <AdjustEtaModal box={etaFor} onClose={() => setEtaFor(null)}
        onDone={() => { setEtaFor(null); router.refresh(); }} />}
      {editFor && <EditLineModal line={editFor.line} box={editFor.box} mode={editFor.mode} onClose={() => setEditFor(null)}
        onDone={() => { setEditFor(null); router.refresh(); }} />}
      {historyFor && <LedgerHistory itemId={historyFor.itemId} itemName={historyFor.itemName} onClose={() => setHistoryFor(null)} />}
    </BoardFrame>
  );
}


// Received-view row actions → overflow menu (History / Edit / ← Return-to-receiving).
function RowActions({ l, box, acts }: { l: ReceivingLine; box: ReceivingBox; acts: LineActions }) {
  const busy = acts.busyKey === `${box.id}:${l.itemId}`;
  return <RowMenu busy={busy} items={[
    { label: "History", onClick: () => acts.onHistory(l) },
    { label: "Edit received count", onClick: () => acts.onEdit(l, box) },
    // Unmanifested goods surface AFTER a box is received (13H fills, Jul 28) —
    // correcting the manifest must not require reopening the box.
    { label: "Edit shipped count", onClick: () => acts.onEditShipped(l, box) },
    { label: "← Return to receiving", danger: true, disabled: busy, onClick: () => acts.onReturn(l, box) },
  ]} />;
}

// Incoming-view row actions → overflow menu (History / Edit shipped / ← Return-to-production).
function IncomingActions({ l, box, acts }: { l: ReceivingLine; box: ReceivingBox; acts: LineActions }) {
  const busy = acts.busyKey === `${box.id}:${l.itemId}`;
  return <RowMenu busy={busy} items={[
    { label: "History", onClick: () => acts.onHistory(l) },
    { label: "Edit shipped count", onClick: () => acts.onEditShipped(l, box) },
    { label: "← Return to production", danger: true, disabled: busy, onClick: () => acts.onReturnProd(l, box) },
  ]} />;
}

// The received tally for a line: X/Y ✓ (green when met, amber when short) → destination.
function ReceivedTally({ l }: { l: ReceivingLine }) {
  const rec = tQty(l.receivedQtys), shp = tQty(l.shipQtys);
  const short = rec < shp;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: short ? T.red : T.green }}>{rec}/{shp}{short ? "" : " ✓"}</span>
      <span style={{ fontSize: 11, color: T.muted }}>→ {destOf(l.route)}</span>
    </div>
  );
}

// Receiving row → shared ItemRow. Actions differ by status (received: tally +
// menu; incoming: box-level Receive→, so just the ⋯ menu here).
function LineRow({ l, box, status, acts, showClient }: { l: ReceivingLine; box: ReceivingBox; status: Status; acts?: LineActions; showClient?: boolean }) {
  const received = status === "received";
  // partial wave: this box carries less than the item's full order and the
  // ship isn't final — more is coming. Shown per line (left of the qty)
  // instead of an aggregate "N partial" in the header.
  const partial = !received && l.orderedTotal > 0 && tQty(l.shipQtys) < l.orderedTotal && !l.shipFinal;
  const countedIn = !received ? tQty(l.receivedQtys) : 0; // partial receive in progress on this open line
  // cumulative shipped exceeds the order — likely a duplicate ship entry
  // (Tank Lock: 288/144 sat invisible 4 days). Shown regardless of status.
  const over = l.overShippedTotal > 0;
  // stopPropagation: the whole incoming card is click-to-receive — the row's
  // ⋯ menu and its actions must not also fire the card click.
  const actions = (
    <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {received
        ? <><ReceivedTally l={l} />{acts && <RowActions l={l} box={box} acts={acts} />}</>
        : (acts && <IncomingActions l={l} box={box} acts={acts} />)}
    </span>
  );
  return <ItemRow fileId={l.mockupFileId} name={l.itemName} lead={showClient ? l.client : undefined} route={l.route}
    variant={(partial || countedIn > 0 || over) ? (
      <div style={{ textAlign: "right", display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "baseline" }}>
        {countedIn > 0 && <span style={{ fontSize: 10, fontWeight: 800, fontFamily: mono, color: T.amber }} title="Counted in so far — the rest of this item is still coming in this box">{countedIn}/{tQty(l.shipQtys)} in</span>}
        {partial && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: T.amber }} title={`${tQty(l.shipQtys)} of ${l.orderedTotal} ordered in this box — more coming`}>partial</span>}
        {over && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: T.amber }} title={`Shipped ${l.overShippedTotal} more than the ${l.orderedTotal} ordered across all boxes — check for a duplicate ship entry`}>over-shipped +{l.overShippedTotal}</span>}
      </div>
    ) : undefined}
    qty={tQty(qtyOf(l, status))} actions={actions} />;
}

// Flat item rows. Item name leads; the client repeats on rows ONLY for a
// multi-client box (single-client boxes headline the client in the card).
function ClientGroups({ box, status, acts, multiClient }: { box: ReceivingBox; status: Status; acts?: LineActions; multiClient?: boolean }) {
  const lines = [...box.lines].sort((a, b) => a.client.localeCompare(b.client));
  return (
    <>
      {lines.map(l => (
        <div key={l.itemId} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          <LineRow l={l} box={box} status={status} acts={acts} showClient={multiClient} />
        </div>
      ))}
    </>
  );
}

// Box meta line under the header (mockup §1) — plain text, no pills.
// multi-project · partials · ETA · items·units · to-receive.
// Box summary segments — now shown IN the header (was its own strip).
function boxMetaSegs(box: ReceivingBox, status: Status): { text: string; tone?: string }[] {
  const jobs = new Set(box.lines.map(l => l.jobId)).size;
  // shipped < ordered splits by the final flag: NOT final = a real partial wave
  // (more coming), final = closed short → the gap is a SHORTAGE, not "more coming".
  const under = box.lines.filter(l => l.orderedTotal > 0 && tQty(l.shipQtys) < l.orderedTotal);
  const shorts = under.filter(l => l.shipFinal).length;
  const overs = box.lines.filter(l => l.overShippedTotal > 0).length;
  const toReceive = box.lines.filter(l => !l.received).length;
  const segs: { text: string; tone?: string }[] = [];
  if (jobs > 1) segs.push({ text: `${jobs} jobs`, tone: T.blue });
  if (shorts > 0) segs.push({ text: `${shorts} short`, tone: T.red });
  if (overs > 0) segs.push({ text: `${overs} over-shipped`, tone: T.amber });
  // ETA lives in the header chip; counts + to-receive left the header (locked
  // layout 2026-07-15 — "obvious when you look at the shipment"). Only the
  // flags above survive, as accents at the end of the detail line.
  void toReceive; void boxUnits;
  return segs;
}

// "Adjust ETA" modal (R3, locked 2026-07-15) — THE receiving-side edit point
// of the date chain, opened from the box card's ⋯ menu (same pattern as
// production2's Adjust date). Writes shipments.expected_arrival: a transit
// delay lands here; the vendor ship-by upstream never moves; client ETAs
// downstream re-derive. Clearing falls back to the derived schedule.
function AdjustEtaModal({ box, onClose, onDone }: { box: ReceivingBox; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(box.etaSource === "human" && box.expectedArrival ? box.expectedArrival : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(value: string | null) {
    setBusy(true); setErr(null);
    const { error } = await (createClient().from("shipments") as any).update({ expected_arrival: value, expected_arrival_edited_at: new Date().toISOString() }).eq("id", box.id);
    setBusy(false);
    if (error) setErr(error.message); else onDone();
  }
  return (
    <ModalShell onClose={onClose} maxWidth={440}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Adjust ETA — {box.vendorName}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Expected arrival for this box. The vendor ship-by upstream stays untouched; client ETAs downstream re-derive from here.</div>
      </div>
      <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4 }}>Expected arrival</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.text, width: 180 }} />
        <div style={{ fontSize: 11, color: T.muted }}>
          {box.etaSource === "derived"
            ? `Currently ~${fmtDay(box.expectedArrival)} — derived from ship day + the vendor's transit default.`
            : box.etaSource === "carrier"
              ? `Currently ${fmtDay(box.expectedArrival)} — live carrier estimate. Setting a date here overrides it until the next scan (freshest signal wins).`
              : box.expectedArrival ? `Currently ~${fmtDay(box.expectedArrival)} (set by hand on this box).` : "No ETA on this box yet."}
        </div>
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
      </div>
      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {box.etaSource === "human" && box.expectedArrival && (
          <button onClick={() => save(null)} disabled={busy}
            style={{ fontSize: 12, fontWeight: 600, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", color: T.muted, marginRight: "auto" }}>Clear — back to carrier / derived</button>
        )}
        <button onClick={onClose} disabled={busy}
          style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
        <button onClick={() => date && save(date)} disabled={busy || !date}
          style={{ fontSize: 13, fontWeight: 700, border: "none", borderRadius: 8, padding: "8px 18px", cursor: busy || !date ? "not-allowed" : "pointer", background: busy || !date ? T.accentDim : T.blue, color: busy || !date ? T.faint : "#fff" }}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </ModalShell>
  );
}

// Box card, laid out per Jon's mockup (locked 2026-07-15, layout artifact v3):
// CLIENT is the headline; "from <vendor> · shipped <day> · tracking · slips"
// is the quiet detail line; the right side stacks [ETA chip + ⋯] over a small
// Receive button; the warehouse note is an amber bar. Counts left the header —
// the rows say it. Operational flags (multi-job / partial / short) keep an
// amber accent at the end of the detail line.
const dayOf = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
function BoxCard({ box, status, onReceive, onAdjustEta, onFlagNotFound, acts }: { box: ReceivingBox; status: Status; onReceive: () => void; onAdjustEta?: (b: ReceivingBox) => void; onFlagNotFound?: (b: ReceivingBox, on: boolean) => void; acts?: LineActions }) {
  const received = status === "received";
  // Button-less card (locked mockup v4): the WHOLE incoming card is the tap
  // target — production's act-on-what-you-click gesture. ETA, slip links and
  // the line ⋯ menus eat their own clicks; everything else opens the receive
  // modal. Hover tints the card and brightens the flat "Receive →" cue (the
  // cue stays faintly visible for touch, where hover doesn't exist).
  const [hover, setHover] = useState(false);
  const clickable = !received;
  // delivered-not-received (D3): carrier delivered, humans haven't counted it
  // in. Aging escalates the card outline — amber past 24h, red past 48h
  // ("annoying by design"). Fresh (<24h) stays calm.
  const deliveredOpen = clickable && !!box.deliveredAt;
  const ageH = deliveredOpen ? (Date.now() - new Date(box.deliveredAt!).getTime()) / 36e5 : 0;
  const agingCol = ageH >= 48 ? T.red : ageH >= 24 ? T.amber : null;
  const tag = received ? "Received" : deliveredOpen ? "Delivered" : box.pickup ? "Pickup" : "Incoming";
  const tagColor = received ? T.green : deliveredOpen ? (agingCol || T.green) : T.blue; // blue = movement (incoming AND pickup)
  const multiClient = box.clients.length > 1;
  const headline = multiClient ? `${box.clients.length} clients` : (box.clients[0] || box.vendorName);
  const flags = boxMetaSegs(box, status).filter(s => s.tone === T.red || s.tone === T.blue);
  // stall watch (Phase 5): a tracked, undelivered box whose feed went quiet.
  // "no scan Nd" = moving box that stopped scanning (amber 3d / red 6d);
  // "label created — not picked up" = vendor printed a label and never handed
  // the box to the carrier (the sneakier stall).
  const stall = (() => {
    if (received || box.deliveredAt || !box.carrierStatus) return null;
    const daysSince = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null;
    if (box.carrierStatus === "pre_transit") {
      const d = daysSince(box.createdAt);
      return d != null && d >= 3 ? { text: `label created ${d}d ago — not picked up`, tone: d >= 6 ? T.red : T.amber } : null;
    }
    const d = daysSince(box.lastScan?.at || null);
    return d != null && d >= 3 ? { text: `no scan ${d}d`, tone: d >= 6 ? T.red : T.amber } : null;
  })();
  const sep = <span style={{ opacity: 0.6 }}>·</span>;
  return (
    <div onClick={clickable ? onReceive : undefined}
      onMouseEnter={() => clickable && setHover(true)} onMouseLeave={() => setHover(false)}
      style={clickable ? { cursor: "pointer", borderRadius: 12, outline: hover ? `2.5px solid ${T.text}` : agingCol ? `2px solid ${agingCol}` : "none", outlineOffset: -1 } : undefined}>
    <Card>
      {/* two columns, vertically centered: left = client line + detail line
          (tight); right = ETA + Receive cue. No dead vertical space. */}
      <div style={{ padding: "9px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{headline}</span>
            {/* flat uppercase color-text — Jon's standing rule: NO pill chips anywhere */}
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: tagColor }}>{tag}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, fontSize: 11.5, color: T.faint, flexWrap: "wrap" }}>
            <span>from <span style={{ color: T.muted, fontWeight: 700 }}>{box.vendorName}</span></span>
            {sep}<span>{received ? `received ${dayOf(box.receivedAt || box.createdAt)}` : `shipped ${dayOf(box.createdAt)}`}</span>
            {!box.pickup && (box.carrier || box.tracking) && <>{sep}<span style={{ fontFamily: mono }}>
              {box.carrier}{box.carrier && box.tracking ? " · " : ""}
              {box.tracking && <TrackingLink tracking={box.tracking} shipmentId={box.id} />}
            </span></>}
            {box.slips.map((s, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 7 }}>{sep}
                <a href={s.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title={s.name} style={{ color: T.blue, fontWeight: 600, textDecoration: "none" }}>📎 {box.slips.length > 1 ? `slip ${i + 1}` : "slip"}</a>
              </span>
            ))}
            {flags.map((f, i) => <span key={`f${i}`} style={{ display: "inline-flex", gap: 7 }}>{sep}<span style={{ color: f.tone, fontWeight: 800 }}>{f.text}</span></span>)}
            {stall && <span style={{ display: "inline-flex", gap: 7 }}>{sep}<span title="The carrier feed went quiet — check with the vendor/carrier" style={{ color: stall.tone, fontWeight: 800 }}>⚠ {stall.text}</span></span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {received ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ received</span>
          ) : deliveredOpen ? (
            // carrier says delivered — the ETA chip is moot; show the delivered
            // signal + aging, and the human "not found" flag (a dispute state,
            // NOT a receive — received_at stays human-only).
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <span title={`Carrier-reported delivery${box.lastScan?.location ? ` — ${box.lastScan.location}` : ""}. Not the same as received: find the box and count it in.`}
                style={{ fontSize: 12.5, fontWeight: 800, color: agingCol || T.green }}>
                ✓ delivered {dayOf(box.deliveredAt)} · {ageH < 1 ? "just now" : ageH < 24 ? `${Math.floor(ageH)}h ago` : `${Math.floor(ageH / 24)}d ago`}
              </span>
              {box.deliveredNotFoundAt ? (
                <span onClick={e => { e.stopPropagation(); onFlagNotFound && onFlagNotFound(box, false); }}
                  title="Flagged: carrier says delivered but the box never appeared — click to clear"
                  style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.red, cursor: "pointer" }}>
                  ⚑ not found — clear
                </span>
              ) : (
                <span onClick={e => { e.stopPropagation(); onFlagNotFound && onFlagNotFound(box, true); }}
                  title="Carrier says delivered but you can't find the box? Flag it — production follows up with the carrier/vendor"
                  style={{ fontSize: 10.5, fontWeight: 700, color: T.faint, cursor: "pointer", borderBottom: "1px dotted currentColor", paddingBottom: 1 }}>
                  box not found?
                </span>
              )}
            </div>
          ) : (<>
            {/* editable-value convention: dotted underline = "click to edit",
                visible on touch too. Eats the click — adjusts the date, not receive. */}
            {(() => {
              // urgency-coded (signal table): gray = calm, amber = inside 3 days,
              // red = past due. ~ = ANY estimate (human or transit math); a
              // plain date is carrier data only ("one mark, one meaning").
              const d = box.expectedArrival ? daysUntilDay(box.expectedArrival) : null;
              const col = !box.expectedArrival ? T.faint : d != null && d < 0 ? T.red : d != null && d <= 3 ? T.amber : T.muted;
              const label = box.expectedArrival
                ? `ETA ${box.etaSource !== "carrier" ? "~" : ""}${fmtDay(box.expectedArrival)}${d != null && d < 0 ? " · late" : ""}`
                : "set ETA";
              const title = box.etaSource === "carrier"
                ? "Live carrier estimate — updates with every scan. Click to override by hand."
                : box.etaSource === "human"
                  ? "~ set by hand (an estimate — a fresher carrier scan takes over). Click to adjust."
                  : "~ ship day + vendor transit (an estimate). Click to set a real date.";
              return (
                <span onClick={e => { e.stopPropagation(); onAdjustEta && onAdjustEta(box); }}
                  title={title}
                  style={{ fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: col, borderBottom: "1px dotted currentColor", paddingBottom: 1 }}>
                  {label}
                </span>
              );
            })()}
          </>)}
        </div>
      </div>
      {box.note && (
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "8px 16px", borderLeft: `3px solid ${T.purple}`, borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.text, lineHeight: 1.45 }}>
          <span style={{ fontWeight: 800, color: T.purple, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", flexShrink: 0 }}>Note</span>
          <span>{box.note}</span>
        </div>
      )}
      <ClientGroups box={box} status={status} acts={acts} multiClient={multiClient} />
    </Card>
    </div>
  );
}

function JobView({ boxes, status, onReceive, acts }: { boxes: ReceivingBox[]; status: Status; onReceive: (b: ReceivingBox) => void; acts?: LineActions }) {
  const groups = useMemo(() => {
    const m = new Map<string, { client: string; invoice: string | null; lines: FlatLine[] }>();
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
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{g.lines.reduce((a, l) => a + tQty(qtyOf(l, status)), 0)}u</span>
          </CardHeader>
          <div>
            {g.lines.map((l, j) => (
              <div key={j} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
                <FlatRow l={l} status={status} onReceive={() => onReceive(l.box)} acts={acts} showBox />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ItemView({ boxes, status, onReceive, acts }: { boxes: ReceivingBox[]; status: Status; onReceive: (b: ReceivingBox) => void; acts?: LineActions }) {
  const lines = useMemo(() => boxes.flatMap(b => b.lines.map(l => ({ ...l, box: b }))), [boxes]);
  return (
    <Card>
      {lines.map((l, i) => (
        <div key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.border}`, padding: "10px 16px" }}>
          <FlatRow l={l} status={status} onReceive={() => onReceive(l.box)} acts={acts} showBox showClient />
        </div>
      ))}
    </Card>
  );
}

function FlatRow({ l, status, onReceive, acts, showBox, showClient }: { l: FlatLine; status: Status; onReceive: () => void; acts?: LineActions; showBox?: boolean; showClient?: boolean }) {
  const received = status === "received";
  const ell: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const sub = showBox ? <div style={{ fontSize: 11, color: T.faint, ...ell }}>{l.box.vendorName} · {boxHow(l.box)}</div> : undefined;
  const actions = received
    ? <><ReceivedTally l={l} />{acts && <RowActions l={l} box={l.box} acts={acts} />}</>
    : <><span onClick={onReceive} style={{ fontSize: 12, fontWeight: 700, color: T.text, cursor: "pointer" }}>Receive →</span>{acts && <IncomingActions l={l} box={l.box} acts={acts} />}</>;
  return <ItemRow fileId={l.mockupFileId} name={l.itemName} lead={showClient ? l.client : undefined} sub={sub} route={l.route}
    qty={tQty(qtyOf(l, status))} actions={actions} />;
}

// Receive modal — counts the box in. Per-item per-variant delivered grid (default
// = shipped, under=amber/over=green). Production-declared pulls surface here to
// fulfil; receiving can add its own pull. Confirm writes via receiveBoxAction.
// Pulls tab — where pulled units land, with their action. Resolve = disposition.
function PullsView({ pulls, query, onResolved }: { pulls: HeldPull[]; query: string; onResolved: () => void }) {
  const q = query.trim().toLowerCase();
  const shown = q ? pulls.filter(p => p.itemName.toLowerCase().includes(q) || p.client.toLowerCase().includes(q) || (p.action || "").toLowerCase().includes(q) || (p.invoiceNumber || "").toLowerCase().includes(q)) : pulls;
  if (!shown.length) return (
    <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 16 }}>
      {query ? "No pulls match your search." : "No units held. Pulls from production or receiving land here."}
    </div>
  );
  return <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>{shown.map(p => <PullCard key={p.id} p={p} onResolved={onResolved} />)}</div>;
}

function PullCard({ p, onResolved }: { p: HeldPull; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isTest = v2WriteAllowed({ clientName: p.client });
  async function resolve(status: "shipped_out" | "returned" | "consumed") {
    setBusy(true); setErr(null);
    const res = await resolvePull(createClient(), { id: p.id, itemId: p.itemId, jobId: p.jobId, qtys: p.qtys }, status);
    setBusy(false);
    if (res.ok) onResolved(); else setErr(res.error || "Resolve failed.");
  }
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{p.itemName}</div>
          <div style={{ fontSize: 11, color: T.muted }}>{p.client}{p.invoiceNumber ? ` · #${p.invoiceNumber}` : ""}</div>
        </div>
        <div style={{ flex: 1 }}><VariantChips qtys={p.qtys} /></div>
        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{tQty(p.qtys)}u</span>
      </div>
      <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}`, background: T.purpleDim, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: T.purple, textTransform: "uppercase", letterSpacing: 0.4 }}>Action</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.action || "—"}</span>
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
        <div style={{ flex: 1 }} />
        {!isTest ? <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>test-job only</span> :
          ([["shipped_out", "Shipped out"], ["returned", "Return to stock"], ["consumed", "Consumed"]] as ["shipped_out" | "returned" | "consumed", string][]).map(([s, label]) => (
            <button key={s} onClick={() => resolve(s)} disabled={busy} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 7, cursor: busy ? "default" : "pointer", border: `1px solid ${T.border}`, background: T.card, color: T.text }}>{label}</button>
          ))}
      </div>
    </Card>
  );
}

const PULL_KIND_LABEL = (id: string) => PULL_KINDS.find(k => k.id === id)?.label || id;

// Receive modal — PER ITEM, per the approved mockup. Each item has its own
// Receive button; hitting it routes that item downstream (ship_through→Shipping,
// stage→Fulfillment) and CLEARS it from the modal, leaving only what's left.
// Grid = In box / Delivered. Anything held back (incl. samples) goes through +Pull.
// Over-one-size + short-another → flag.
function ReceiveModal({ box, onClose, onDone }: { box: ReceivingBox; onClose: () => void; onDone: () => void }) {
  const [delivered, setDelivered] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    // default = what's still OUTSTANDING on this line (a prior partial receive
    // leaves the line open with receivedQtys already counted)
    for (const l of box.lines) init[l.itemId] = subQtys(l.shipQtys, l.receivedQtys);
    return init;
  });
  const [fulfil, setFulfil] = useState<Record<string, boolean>>(() => {
    const f: Record<string, boolean> = {};
    for (const l of box.lines) for (const p of l.pullRequests) f[p.id] = true;
    return f;
  });
  const [extraPull, setExtraPull] = useState<Record<string, { qtys: Record<string, number>; kind: string; reason: string } | undefined>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set(box.lines.filter(l => l.received).map(l => l.itemId)));
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Attach packing slip(s) to an ALREADY-shipped box. Pure metadata (Drive
  // upload + item_files rows) — no ledger write, so it's left ungated. Mirrors
  // the ship modal's flow: upload each file once to the project's Packing Slips
  // folder, register it against EVERY item in the box so it surfaces regardless
  // of how the wave split. Newly-attached slips show immediately; the board
  // re-reads them from item_files on its next refresh.
  const [attached, setAttached] = useState<{ name: string; url: string }[]>([]);
  const [slipBusy, setSlipBusy] = useState(false);
  const [slipErr, setSlipErr] = useState<string | null>(null);
  const slipRef = useRef<HTMLInputElement>(null);

  async function attachSlips(files: File[]) {
    if (!files.length || !box.lines.length) return;
    setSlipBusy(true); setSlipErr(null);
    try {
      const first = box.lines[0];
      // project title isn't carried on the receive line — read it once so the
      // slip lands in the same .../{Client}/{Project}/Packing Slips folder the
      // ship-time slips use.
      const { data: job } = await createClient().from("jobs").select("title").eq("id", first.jobId).single();
      const projectTitle = (job as any)?.title || first.itemName;
      for (const file of files) {
        const up: any = await (uploadToDrive as any)({
          blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream",
          clientName: first.client, projectTitle, itemName: "Packing Slips",
        });
        for (const l of box.lines) {
          await registerFileInDb({
            fileId: up.fileId, webViewLink: up.webViewLink, folderLink: up.folderLink,
            fileName: file.name, mimeType: file.type, fileSize: file.size,
            itemId: l.itemId, stage: "packing_slip", notes: up.folderLink, preserveApproval: false,
          });
        }
        setAttached(prev => [...prev, { name: file.name, url: up.webViewLink }]);
      }
    } catch (e: any) { setSlipErr(e?.message || "Attach failed."); }
    setSlipBusy(false);
  }

  const isTest = box.clients.every(c => v2WriteAllowed({ clientName: c }));
  const remaining = box.lines.filter(l => !cleared.has(l.itemId));
  const doneCount = box.lines.length - remaining.length;

  const setD = (id: string, sz: string, v: string) => setDelivered(p => ({ ...p, [id]: { ...p[id], [sz]: Math.max(0, Math.floor(Number(v) || 0)) } }));
  const mutEP = (id: string, patch: Partial<{ qtys: Record<string, number>; kind: string; reason: string }>) =>
    setExtraPull(p => { const cur = p[id] || { qtys: {}, kind: PULL_KINDS[0].id, reason: "" }; return { ...p, [id]: { ...cur, ...patch } }; });
  const setEPQ = (id: string, sz: string, v: string) =>
    setExtraPull(p => { const cur = p[id] || { qtys: {}, kind: PULL_KINDS[0].id, reason: "" }; return { ...p, [id]: { ...cur, qtys: { ...cur.qtys, [sz]: Math.max(0, Math.floor(Number(v) || 0)) } } }; });

  // over on one size AND short on another → flag production to resolve w/ vendor (H6)
  const varianceFlag = (l: ReceivingLine) => {
    const d = delivered[l.itemId] || {}; let over = false, under = false;
    for (const sz of Object.keys(l.shipQtys)) { const got = d[sz] ?? 0, want = l.shipQtys[sz] ?? 0; if (got > want) over = true; if (got < want) under = true; }
    return over && under;
  };
  const pulledOf = (l: ReceivingLine) =>
    l.pullRequests.filter(p => fulfil[p.id]).reduce((a, p) => a + tQty(p.qtys), 0) + tQty(extraPull[l.itemId]?.qtys || {});
  const continuingOf = (l: ReceivingLine) => Math.max(0, tQty(delivered[l.itemId] || {}) - pulledOf(l));

  async function receiveOne(l: ReceivingLine, keepOpen = false) {
    setBusyItem(l.itemId); setErr(null);
    const newPulls: any[] = [];
    const ep = extraPull[l.itemId];
    if (ep && tQty(ep.qtys) > 0) newPulls.push({ itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, qtys: ep.qtys, kind: ep.kind, reason: (ep.reason || "").trim() || null });
    const res = await receiveBoxAction(createClient(), {
      shipmentId: box.id,
      items: [{ itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, cumReceived: l.cumReceived, deliveredQtys: delivered[l.itemId] || {}, keepOpen, lineReceived: l.receivedQtys }],
      fulfillPulls: l.pullRequests.filter(p => fulfil[p.id]).map(p => ({ pullId: p.id, itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, qtys: p.qtys })),
      newPulls,
    });
    setBusyItem(null);
    if (res.ok) {
      if (keepOpen) { onDone(); return; } // count booked, line stays open — refresh the board
      const n = new Set(cleared); n.add(l.itemId); setCleared(n);
      if (box.lines.every(x => n.has(x.itemId))) onDone();
    } else setErr(res.error || "Receive failed.");
  }

  return (
    <ModalShell onClose={onClose} maxWidth={640} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Receive box — {box.vendorName}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{boxHow(box)} · {box.totalUnits} units expected</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}><b style={{ color: T.text }}>{remaining.length}</b> left to receive{doneCount > 0 ? ` · ${doneCount} received` : ""}</div>
        {box.note && <div style={{ marginTop: 8, fontSize: 12.5, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 10px" }}><span style={{ fontWeight: 700, color: T.muted }}>Note from production: </span>{box.note}</div>}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {[...box.slips, ...attached].map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.name} style={{ fontSize: 12, color: T.blue, textDecoration: "none" }}>📎 {s.name}</a>
          ))}
          <span onClick={() => { if (!slipBusy) slipRef.current?.click(); }}
            style={{ fontSize: 11.5, fontWeight: 700, color: slipBusy ? T.faint : T.blue, cursor: slipBusy ? "default" : "pointer" }}>
            {slipBusy ? "Uploading…" : ((box.slips.length + attached.length) > 0 ? "+ Add slip" : "+ Attach packing slip")}
          </span>
          <input ref={slipRef} type="file" multiple accept="image/*,application/pdf"
            onChange={e => { const fs = Array.from(e.target.files || []) as File[]; e.currentTarget.value = ""; if (fs.length) attachSlips(fs); }}
            style={{ display: "none" }} />
          {slipErr && <span style={{ fontSize: 11.5, color: T.red, fontWeight: 600 }}>{slipErr}</span>}
        </div>
      </div>

      <div style={{ padding: "14px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* cleared items — faded, routed on */}
        {box.lines.filter(l => cleared.has(l.itemId)).map(l => (
          <div key={l.itemId} style={{ opacity: 0.45, border: `1px dashed ${T.border}`, borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: T.green, fontWeight: 700 }}>✓</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{l.itemName}</span>
            <span style={{ fontSize: 11, color: T.green }}>received · routed to {l.route === "stage" ? "Fulfillment" : l.route === "drop_ship" ? "client" : "Shipping"}</span>
          </div>
        ))}

        {remaining.length === 0 && <div style={{ fontSize: 13, color: T.green, fontWeight: 600, textAlign: "center", padding: 12 }}>All items received ✓</div>}

        {/* remaining — receive one at a time */}
        {remaining.map(l => {
          const ep = extraPull[l.itemId];
          const sizes = sortSizes(Object.keys(l.shipQtys));
          const busy = busyItem === l.itemId;
          // outstanding = this line's shipped minus what a prior partial
          // receive already counted (line left open via "more coming")
          const outstanding = subQtys(l.shipQtys, l.receivedQtys);
          const alreadyIn = tQty(l.receivedQtys);
          const shortNow = tQty(delivered[l.itemId] || {}) < tQty(outstanding);
          return (
            <div key={l.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 13px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                <ItemThumb fileId={l.mockupFileId} name={l.itemName} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.itemName}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{l.client}{l.invoiceNumber ? ` · #${l.invoiceNumber}` : ""}</div>
                  {alreadyIn > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginTop: 2 }}>{alreadyIn} already counted — {tQty(outstanding)} still due in this box</div>}
                  <div style={{ marginTop: 5 }}><RouteTag route={l.route} /></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                  {!shortNow ? (
                    <button onClick={() => receiveOne(l)} disabled={!isTest || busy}
                      style={{ background: (!isTest || busy) ? T.accentDim : T.green, color: (!isTest || busy) ? T.faint : "#fff", border: "none", borderRadius: 7, padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: (!isTest || busy) ? "not-allowed" : "pointer" }}>{busy ? "…" : "Receive"}</button>
                  ) : (
                    // counting short — mirror production's choice: is the rest
                    // still coming (line stays open, box stays Incoming) or is
                    // this everything (close short)?
                    <>
                      <button onClick={() => receiveOne(l, true)} disabled={!isTest || busy}
                        title="Book this count; the rest of this item is still coming in this box — it stays on Incoming"
                        style={{ background: T.card, color: T.amber, border: `1px solid ${T.amber}`, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: (!isTest || busy) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>{busy ? "…" : "Count in · more coming"}</button>
                      <button onClick={() => receiveOne(l)} disabled={!isTest || busy}
                        title="Book this count and close the line — the gap becomes a logged short"
                        style={{ background: T.card, color: T.red, border: `1px solid ${T.red}`, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: (!isTest || busy) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>{busy ? "…" : "Count in · close short"}</button>
                    </>
                  )}
                  <span onClick={() => setExtraPull(p => ({ ...p, [l.itemId]: p[l.itemId] ? undefined : { qtys: {}, kind: PULL_KINDS[0].id, reason: "" } }))}
                    style={{ fontSize: 11, fontWeight: 600, color: ep ? T.purple : T.amber, cursor: "pointer" }}>{ep ? "− cancel pull" : "+ Pull"}</span>
                </div>
              </div>

              {/* In box / Delivered grid — CHUNKED into rows of 8 sizes so a
                  dense variant matrix (FOG pants: 17 combos) wraps instead of
                  overflowing the modal. Each chunk repeats the row labels. */}
              {chunk(sizes, 8).map((szs, ci) => (
                <div key={ci} style={{ marginTop: ci === 0 ? 11 : 8, display: "grid", gridTemplateColumns: `auto repeat(${szs.length}, 50px)`, columnGap: 8, rowGap: 4, alignItems: "center", width: "fit-content" }}>
                  <div />{szs.map(sz => <div key={sz} style={{ fontSize: 10, fontWeight: 800, color: T.faint, textAlign: "center", textTransform: "uppercase" }}>{sz}</div>)}
                  <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>In box</div>
                  {szs.map(sz => <div key={sz} style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{outstanding[sz] ?? 0}</div>)}
                  <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>Delivered</div>
                  {szs.map(sz => { const got = delivered[l.itemId]?.[sz] ?? 0, want = outstanding[sz] ?? 0; const c = got === want ? T.text : got < want ? T.amber : T.green;
                    return <input key={sz} inputMode="numeric" value={got} onChange={e => setD(l.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                      style={{ width: 50, textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "5px 4px", borderRadius: 5, border: `1px solid ${got === want ? T.border : c}`, color: c, background: T.card }} />; })}
                </div>
              ))}

              {varianceFlag(l) && <div style={{ marginTop: 9, fontSize: 11, fontWeight: 700, color: T.red, background: T.redDim, border: `1px solid ${T.red}`, borderRadius: 7, padding: "6px 9px" }}>⚑ Over on one size and short on another — flag production to resolve with the vendor.</div>}

              {/* production-declared pulls */}
              {l.pullRequests.length > 0 && (
                <div style={{ marginTop: 9, padding: "8px 10px", background: T.purpleDim, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: T.purple, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>⚑ Production wants pulled</div>
                  {l.pullRequests.map(p => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", padding: "3px 0" }}>
                      <input type="checkbox" checked={!!fulfil[p.id]} onChange={e => setFulfil(f => ({ ...f, [p.id]: e.target.checked }))} style={{ accentColor: T.purple }} />
                      <span style={{ fontFamily: mono, fontWeight: 700 }}>{Object.entries(p.qtys).filter(([, n]) => n > 0).map(([s, n]) => `${s}·${n}`).join(" ")}</span>
                      <span style={{ color: T.muted }}>{PULL_KIND_LABEL(p.kind || "")}</span>
                      {p.reason && <span style={{ fontWeight: 600, color: T.purple }}>→ {p.reason}</span>}
                    </label>
                  ))}
                </div>
              )}

              {/* extra actioned pull */}
              {ep && (
                <div style={{ marginTop: 9, padding: "8px 10px", background: T.purpleDim, borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: T.purple, textTransform: "uppercase", letterSpacing: 0.4 }}>Pull back</span>
                    <select value={ep.kind} onChange={e => mutEP(l.itemId, { kind: e.target.value })} style={{ fontSize: 11, fontWeight: 600, padding: "3px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }}>
                      {PULL_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    {sizes.map(sz => (
                      <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 40 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: T.faint }}>{sz}</span>
                        <input inputMode="numeric" value={ep.qtys[sz] ?? 0} onChange={e => setEPQ(l.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                          style={{ width: 40, textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 700, padding: "4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
                      </label>
                    ))}
                  </div>
                  <input value={ep.reason} onChange={e => mutEP(l.itemId, { reason: e.target.value })} placeholder="Action — e.g. Ship to Andrew"
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontFamily: font }} />
                </div>
              )}

              {pulledOf(l) > 0 && <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>{tQty(delivered[l.itemId] || {})} received − {pulledOf(l)} pulled → <strong style={{ color: T.green }}>{continuingOf(l)} continuing downstream</strong></div>}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        {!isTest ? <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Receive write is limited to the test job.</span>
          : err ? <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>
            : <span style={{ fontSize: 11.5, color: T.muted }}>Receive each item as you count it — it routes on immediately.</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
      </div>
    </ModalShell>
  );
}

// Edit-line modal — fix a count in place. mode "received" corrects what was
// counted at receiving (vs shipped, for reference); mode "shipped" corrects what
// the vendor said they sent. Saving reverses this box's movement of that type and
// re-appends the corrected qty (both stay on the ledger). Gated to the test client.
function EditLineModal({ line, box, mode, onClose, onDone }: { line: ReceivingLine; box: ReceivingBox; mode: EditMode; onClose: () => void; onDone: () => void }) {
  const shipped = mode === "shipped";
  // Vendors sometimes include sizes that aren't on the wave's manifest at all
  // (13H shortage-fills, Jul 28). Edit-shipped can ADD a size from the item's
  // order — editShippedLine takes the corrected map wholesale, so a new size
  // rides the same reverse-and-reappend correction as a count change.
  const [added, setAdded] = useState<string[]>([]);
  const [orderedSizes, setOrderedSizes] = useState<string[]>([]);
  useEffect(() => {
    if (!shipped) return;
    createClient().from("buy_sheet_lines").select("size").eq("item_id", line.itemId)
      .then(({ data }: any) => setOrderedSizes((data || []).map((r: any) => r.size)));
  }, [shipped, line.itemId]);
  const baseSizes = Object.keys(line.shipQtys).length ? Object.keys(line.shipQtys) : Object.keys(line.receivedQtys);
  const sizes = sortSizes(Array.from(new Set([...baseSizes, ...added])));
  const addable = orderedSizes.filter(s => !sizes.includes(s));
  const [qtys, setQtys] = useState<Record<string, number>>({ ...(shipped ? line.shipQtys : line.receivedQtys) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isTest = v2WriteAllowed({ clientName: line.client });
  const total = tQty(qtys);
  const setQ = (sz: string, v: string) => setQtys(p => ({ ...p, [sz]: Math.max(0, Math.floor(Number(v) || 0)) }));

  async function save() {
    setBusy(true); setErr(null);
    const sb = createClient();
    const res = shipped
      ? await editShippedLine(sb, { shipmentId: box.id, itemId: line.itemId, jobId: line.jobId, itemName: line.itemName, newShipped: qtys })
      : await editReceivedLine(sb, { shipmentId: box.id, itemId: line.itemId, jobId: line.jobId, itemName: line.itemName, newReceived: qtys });
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error || "Edit failed.");
  }

  return (
    <ModalShell onClose={onClose} maxWidth={520} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Edit {shipped ? "shipped" : "received"} — {line.itemName}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{box.vendorName} · {shipped ? "correct the count the vendor said they sent" : "fix the counted quantity in place"}</div>
      </div>
      <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{shipped ? "Shipped" : "Received"}, per size</div>
          {chunk(sizes, 8).map((szs, ci) => (
            <div key={ci} style={{ marginTop: ci === 0 ? 0 : 8, display: "grid", gridTemplateColumns: `auto repeat(${szs.length}, 50px)`, columnGap: 8, rowGap: 4, alignItems: "center", width: "fit-content" }}>
              <div />{szs.map(sz => <div key={sz} style={{ fontSize: 10, fontWeight: 800, color: T.faint, textAlign: "center", textTransform: "uppercase" }}>{sz}</div>)}
              {!shipped && <>
                <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>Shipped</div>
                {szs.map(sz => <div key={sz} style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{line.shipQtys[sz] ?? 0}</div>)}
              </>}
              <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>{shipped ? "Shipped" : "Received"}</div>
              {szs.map(sz => { const got = qtys[sz] ?? 0, want = line.shipQtys[sz] ?? 0; const c = shipped ? T.text : got === want ? T.text : got < want ? T.amber : T.green;
                return <input key={sz} inputMode="numeric" value={got} onChange={e => setQ(sz, e.target.value)} onFocus={e => e.target.select()}
                  style={{ width: 50, textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "5px 4px", borderRadius: 5, border: `1px solid ${(shipped || got === want) ? T.border : c}`, color: c, background: T.card }} />; })}
            </div>
          ))}
          {shipped && addable.length > 0 && (
            <select value="" onChange={e => { const sz = e.target.value; if (sz) { setAdded(p => [...p, sz]); setQtys(p => ({ ...p, [sz]: 0 })); } }}
              style={{ marginTop: 10, padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, fontSize: 12, fontFamily: font, outline: "none", cursor: "pointer" }}>
              <option value="">+ Add a size in the box but not on the manifest…</option>
              {sortSizes(addable).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </div>
      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Edit is limited to the test job.</span>}
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
        <button onClick={save} disabled={!isTest || busy}
          style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy) ? "not-allowed" : "pointer", background: (!isTest || busy) ? T.accentDim : T.green, color: (!isTest || busy) ? T.faint : "#fff" }}>
          {busy ? "Saving…" : `Save · ${total}u`}
        </button>
      </div>
    </ModalShell>
  );
}

"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { parseDay } from "@/lib/dates";
import { BoardFrame, ToggleSearch, KpiStrip, KpiBreakdownModal, ModalShell, Card, CardHeader, BoxHead, ItemRow, RowMenu, VariantChips, RouteTag, ItemThumb, SegmentControl, SliceSortRow } from "@/components/board-kit";
import { receiveBox as receiveBoxAction, resolvePull, returnReceivedLine, editReceivedLine, editShippedLine, returnIncomingToProduction } from "@/lib/receiving2-receive";
import { PULL_KINDS } from "@/lib/handoff";
import LedgerHistory from "@/components/LedgerHistory";
import type { ReceivingBox, ReceivingLine, HeldPull } from "@/lib/item-state";
import { v2WriteAllowed } from "@/lib/v2-flags";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
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
function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

type MetricKey = "boxes" | "units" | "items";
type Metric = { boxes: number; units: number; items: number };
const METRICS: { key: MetricKey; label: string }[] = [{ key: "boxes", label: "Boxes" }, { key: "units", label: "Units" }, { key: "items", label: "Items" }];
type Status = "incoming" | "received" | "pulls";
type ViewKey = "shipment" | "job" | "item";
type SortKey = "date" | "vendor" | "client";
type FlatLine = ReceivingLine & { box: ReceivingBox };

// The qty a line shows depends on the tab: what to receive (shipped) vs what came in (received).
const qtyOf = (l: ReceivingLine, status: Status) => status === "received" ? l.receivedQtys : l.shipQtys;
const boxUnits = (b: ReceivingBox, status: Status) => status === "received" ? b.receivedUnits : b.totalUnits;

export default function Board({ boxes, pulls }: { boxes: ReceivingBox[]; pulls: HeldPull[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("incoming");
  const [view, setView] = useState<ViewKey>("shipment");
  const [sort, setSort] = useState<SortKey>("date");
  const [query, setQuery] = useState("");
  const [kpi, setKpi] = useState<MetricKey | null>(null);
  const [receiveBox, setReceiveBox] = useState<ReceivingBox | null>(null);
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
  const acts: LineActions = { onEdit: (line, box) => setEditFor({ line, box, mode: "received" }), onEditShipped: (line, box) => setEditFor({ line, box, mode: "shipped" }), onReturn: returnLine, onReturnProd: returnToProd, onHistory: setHistoryFor, busyKey };

  const incoming = useMemo(() => boxes.filter(b => !b.allReceived), [boxes]);
  const received = useMemo(() => boxes.filter(b => b.allReceived), [boxes]);
  const active = status === "incoming" ? incoming : status === "received" ? received : [];

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q ? active.filter(b =>
      b.vendorName.toLowerCase().includes(q) || (b.tracking || "").toLowerCase().includes(q) ||
      b.clients.some(c => c.toLowerCase().includes(q)) ||
      b.lines.some(l => l.itemName.toLowerCase().includes(q) || (l.invoiceNumber || "").toLowerCase().includes(q))) : active;
    const dateOf = (b: ReceivingBox) => (status === "received" ? b.receivedAt || b.createdAt : b.createdAt) || "";
    out = [...out];
    if (sort === "date") out.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    else if (sort === "vendor") out.sort((a, b) => a.vendorName.localeCompare(b.vendorName) || dateOf(b).localeCompare(dateOf(a)));
    else out.sort((a, b) => (a.clients[0] || "").localeCompare(b.clients[0] || "") || dateOf(b).localeCompare(dateOf(a)));
    return out;
  }, [active, query, sort, status]);

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
          <SegmentControl label="Sort" options={[["date", status === "received" ? "Received" : "Arrival"], ["vendor", "Vendor"], ["client", "Client"]]} value={sort} onChange={setSort} />
        </SliceSortRow>

        {display.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            {query ? "No boxes match your search." : status === "incoming" ? "Nothing incoming to receive." : "Nothing received yet."}
          </div>
        )}

        {view === "shipment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {display.map(box => <BoxCard key={box.id} box={box} status={status} onReceive={() => setReceiveBox(box)} acts={acts} />)}
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
      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: short ? "#a87b00" : T.green }}>{rec}/{shp}{short ? "" : " ✓"}</span>
      <span style={{ fontSize: 11, color: T.muted }}>→ {destOf(l.route)}</span>
    </div>
  );
}

// Receiving row → shared ItemRow. Actions differ by status (received: tally +
// menu; incoming: box-level Receive→, so just the ⋯ menu here).
function LineRow({ l, box, status, acts }: { l: ReceivingLine; box: ReceivingBox; status: Status; acts?: LineActions }) {
  const received = status === "received";
  const actions = received
    ? <><ReceivedTally l={l} />{acts && <RowActions l={l} box={box} acts={acts} />}</>
    : (acts && <IncomingActions l={l} box={box} acts={acts} />);
  return <ItemRow fileId={l.mockupFileId} name={l.itemName} lead={l.client} route={l.route}
    variant={<VariantChips qtys={qtyOf(l, status)} />} qty={tQty(qtyOf(l, status))} actions={actions} />;
}

// Flat item rows (client shown inline on each row — no separate client label strip).
function ClientGroups({ box, status, acts }: { box: ReceivingBox; status: Status; acts?: LineActions }) {
  const lines = [...box.lines].sort((a, b) => a.client.localeCompare(b.client));
  return (
    <>
      {lines.map(l => (
        <div key={l.itemId} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          <LineRow l={l} box={box} status={status} acts={acts} />
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
  const partials = under.filter(l => !l.shipFinal).length;
  const shorts = under.filter(l => l.shipFinal).length;
  const toReceive = box.lines.filter(l => !l.received).length;
  const segs: { text: string; tone?: string }[] = [];
  if (jobs > 1) segs.push({ text: `${jobs} jobs`, tone: T.blue });
  if (partials > 0 && status !== "received") segs.push({ text: `${partials} partial`, tone: "#a87b00" });
  if (shorts > 0) segs.push({ text: `${shorts} short`, tone: "#a87b00" });
  if (box.expectedArrival && status !== "received") segs.push({ text: `ETA ${fmtDay(box.expectedArrival)}` });
  segs.push({ text: `${box.lines.length} item${box.lines.length > 1 ? "s" : ""} · ${boxUnits(box, status)} units` });
  if (status === "incoming" && toReceive > 0) segs.push({ text: `${toReceive} to receive`, tone: "#a87b00" });
  return segs;
}

function BoxCard({ box, status, onReceive, acts }: { box: ReceivingBox; status: Status; onReceive: () => void; acts?: LineActions }) {
  const received = status === "received";
  const tag = received ? "Received" : box.pickup ? "Pickup" : "Incoming";
  const tagColor = received ? T.green : box.pickup ? "#a87b00" : T.blue;
  const action = received
    ? <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ received</span>
    : <span onClick={onReceive} style={{ fontSize: 13, fontWeight: 700, color: T.text, cursor: "pointer" }}>Receive →</span>;
  return (
    <Card>
      <BoxHead vendor={box.vendorName} tag={tag} tagColor={tagColor} method={boxHow(box)} slips={box.slips}
        when={fmtWhen(received ? box.receivedAt || box.createdAt : box.createdAt)} meta={boxMetaSegs(box, status)} action={action} />
      {box.note && <div style={{ padding: "8px 16px 0", fontSize: 12, color: T.muted }}><span style={{ fontWeight: 700 }}>Note:</span> {box.note}</div>}
      <ClientGroups box={box} status={status} acts={acts} />
    </Card>
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
    variant={<VariantChips qtys={qtyOf(l, status)} />} qty={tQty(qtyOf(l, status))} actions={actions} />;
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
    for (const l of box.lines) init[l.itemId] = { ...l.shipQtys };
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

  async function receiveOne(l: ReceivingLine) {
    setBusyItem(l.itemId); setErr(null);
    const newPulls: any[] = [];
    const ep = extraPull[l.itemId];
    if (ep && tQty(ep.qtys) > 0) newPulls.push({ itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, qtys: ep.qtys, kind: ep.kind, reason: (ep.reason || "").trim() || null });
    const res = await receiveBoxAction(createClient(), {
      shipmentId: box.id,
      items: [{ itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, cumReceived: l.cumReceived, deliveredQtys: delivered[l.itemId] || {} }],
      fulfillPulls: l.pullRequests.filter(p => fulfil[p.id]).map(p => ({ pullId: p.id, itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, qtys: p.qtys })),
      newPulls,
    });
    setBusyItem(null);
    if (res.ok) {
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
        {box.slips.length > 0 && <div style={{ marginTop: 6 }}>{box.slips.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.blue, textDecoration: "none", marginRight: 12 }}>📎 {s.name}</a>
        ))}</div>}
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
          return (
            <div key={l.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 13px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                <ItemThumb fileId={l.mockupFileId} name={l.itemName} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.itemName}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{l.client}{l.invoiceNumber ? ` · #${l.invoiceNumber}` : ""}</div>
                  <div style={{ marginTop: 5 }}><RouteTag route={l.route} /></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                  <button onClick={() => receiveOne(l)} disabled={!isTest || busy}
                    style={{ background: (!isTest || busy) ? T.accentDim : T.green, color: (!isTest || busy) ? T.faint : "#fff", border: "none", borderRadius: 7, padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: (!isTest || busy) ? "not-allowed" : "pointer" }}>{busy ? "…" : "Receive"}</button>
                  <span onClick={() => setExtraPull(p => ({ ...p, [l.itemId]: p[l.itemId] ? undefined : { qtys: {}, kind: PULL_KINDS[0].id, reason: "" } }))}
                    style={{ fontSize: 11, fontWeight: 600, color: ep ? T.purple : T.amber, cursor: "pointer" }}>{ep ? "− cancel pull" : "+ Pull"}</span>
                </div>
              </div>

              {/* In box / Delivered grid */}
              <div style={{ marginTop: 11, display: "grid", gridTemplateColumns: `auto repeat(${sizes.length}, 50px)`, columnGap: 8, rowGap: 4, alignItems: "center", width: "fit-content" }}>
                <div />{sizes.map(sz => <div key={sz} style={{ fontSize: 10, fontWeight: 800, color: T.faint, textAlign: "center", textTransform: "uppercase" }}>{sz}</div>)}
                <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>In box</div>
                {sizes.map(sz => <div key={sz} style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{l.shipQtys[sz] ?? 0}</div>)}
                <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>Delivered</div>
                {sizes.map(sz => { const got = delivered[l.itemId]?.[sz] ?? 0, want = l.shipQtys[sz] ?? 0; const c = got === want ? T.text : got < want ? "#a87b00" : T.green;
                  return <input key={sz} inputMode="numeric" value={got} onChange={e => setD(l.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                    style={{ width: 50, textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "5px 4px", borderRadius: 5, border: `1px solid ${got === want ? T.border : c}`, color: c, background: T.card }} />; })}
              </div>

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
  const sizes = sortSizes(Object.keys(line.shipQtys).length ? Object.keys(line.shipQtys) : Object.keys(line.receivedQtys));
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
          <div style={{ display: "grid", gridTemplateColumns: `auto repeat(${sizes.length}, 50px)`, columnGap: 8, rowGap: 4, alignItems: "center", width: "fit-content" }}>
            <div />{sizes.map(sz => <div key={sz} style={{ fontSize: 10, fontWeight: 800, color: T.faint, textAlign: "center", textTransform: "uppercase" }}>{sz}</div>)}
            {!shipped && <>
              <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>Shipped</div>
              {sizes.map(sz => <div key={sz} style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: "center" }}>{line.shipQtys[sz] ?? 0}</div>)}
            </>}
            <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3, paddingRight: 4 }}>{shipped ? "Shipped" : "Received"}</div>
            {sizes.map(sz => { const got = qtys[sz] ?? 0, want = line.shipQtys[sz] ?? 0; const c = shipped ? T.text : got === want ? T.text : got < want ? "#a87b00" : T.green;
              return <input key={sz} inputMode="numeric" value={got} onChange={e => setQ(sz, e.target.value)} onFocus={e => e.target.select()}
                style={{ width: 50, textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "5px 4px", borderRadius: 5, border: `1px solid ${(shipped || got === want) ? T.border : c}`, color: c, background: T.card }} />; })}
          </div>
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

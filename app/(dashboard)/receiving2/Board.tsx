"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, KpiBreakdownModal, ModalShell, Card, CardHeader, VariantChips, RouteTag, ItemThumb, SegmentControl, SliceSortRow } from "@/components/board-kit";
import { receiveBox as receiveBoxAction } from "@/lib/receiving2-receive";
import { PULL_KINDS } from "@/lib/handoff";
import type { ReceivingBox, ReceivingLine } from "@/lib/item-state";

const TEST_CLIENTS = ["Playwright Test Co"];

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const boxHow = (b: ReceivingBox) => b.pickup ? "Pickup" : [b.carrier, b.tracking].filter(Boolean).join(" · ") || "no tracking";
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
type Status = "incoming" | "received";
type ViewKey = "shipment" | "job" | "item";
type SortKey = "date" | "vendor" | "client";
type FlatLine = ReceivingLine & { box: ReceivingBox };

// The qty a line shows depends on the tab: what to receive (shipped) vs what came in (received).
const qtyOf = (l: ReceivingLine, status: Status) => status === "received" ? l.receivedQtys : l.shipQtys;
const boxUnits = (b: ReceivingBox, status: Status) => status === "received" ? b.receivedUnits : b.totalUnits;

export default function Board({ boxes }: { boxes: ReceivingBox[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("incoming");
  const [view, setView] = useState<ViewKey>("shipment");
  const [sort, setSort] = useState<SortKey>("date");
  const [query, setQuery] = useState("");
  const [kpi, setKpi] = useState<MetricKey | null>(null);
  const [receiveBox, setReceiveBox] = useState<ReceivingBox | null>(null);

  const incoming = useMemo(() => boxes.filter(b => !b.allReceived), [boxes]);
  const received = useMemo(() => boxes.filter(b => b.allReceived), [boxes]);
  const active = status === "incoming" ? incoming : received;

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
      <ToggleSearch options={[["incoming", `Incoming · ${incoming.length}`], ["received", `Received · ${received.length}`]]}
        value={status} onChange={setStatus} query={query} setQuery={setQuery} placeholder="Search vendor, client, invoice, item, or tracking…" />
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
          {display.map(box => <BoxCard key={box.id} box={box} status={status} onReceive={() => setReceiveBox(box)} />)}
        </div>
      )}
      {view === "job" && <JobView boxes={display} status={status} onReceive={setReceiveBox} />}
      {view === "item" && <ItemView boxes={display} status={status} onReceive={setReceiveBox} />}

      {kpi && <KpiBreakdownModal label={METRICS.find(m => m.key === kpi)!.label} total={agg.total[kpi]} unit={status}
        cols={[{ title: "By vendor", rows: rows(agg.byVendor, kpi) }, { title: "By client", rows: rows(agg.byClient, kpi) }]}
        onClose={() => setKpi(null)} />}
      {receiveBox && <ReceiveModal box={receiveBox} onClose={() => setReceiveBox(null)}
        onDone={() => { setReceiveBox(null); router.refresh(); }} />}
    </BoardFrame>
  );
}

function LineRow({ l, status, right }: { l: ReceivingLine; status: Status; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ItemThumb fileId={l.mockupFileId} name={l.itemName} size={36} />
      <span style={{ fontSize: 13, fontWeight: 500, minWidth: 150 }}>{l.itemName}</span>
      <RouteTag route={l.route} />
      <div style={{ flex: 1 }}><VariantChips qtys={qtyOf(l, status)} /></div>
      {right}
    </div>
  );
}

function ClientGroups({ lines, status }: { lines: ReceivingLine[]; status: Status }) {
  const byClient = new Map<string, ReceivingLine[]>();
  for (const l of lines) { const a = byClient.get(l.client) || []; a.push(l); byClient.set(l.client, a); }
  return (
    <>
      {Array.from(byClient.entries()).map(([client, ls]) => (
        <div key={client} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 8 }}>
            {client}{ls[0]?.invoiceNumber ? <span style={{ fontFamily: mono, color: T.faint, fontWeight: 500 }}> · #{ls[0].invoiceNumber}</span> : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ls.map(l => <LineRow key={l.itemId} l={l} status={status}
              right={<span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, minWidth: 40, textAlign: "right" }}>{tQty(qtyOf(l, status))}</span>} />)}
          </div>
        </div>
      ))}
    </>
  );
}

function BoxCard({ box, status, onReceive }: { box: ReceivingBox; status: Status; onReceive: () => void }) {
  const received = status === "received";
  return (
    <Card>
      <CardHeader>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{box.vendorName}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: received ? T.green : box.pickup ? "#a87b00" : T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{received ? "Received" : box.pickup ? "Pickup" : "Incoming"}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{boxHow(box)}</span>
        {box.slips.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue, textDecoration: "none" }}>📎 slip</a>)}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.faint }}>{fmtWhen(received ? box.receivedAt || box.createdAt : box.createdAt)}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{boxUnits(box, status)}u</span>
        {received
          ? <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ received</span>
          : <span onClick={onReceive} style={{ fontSize: 13, fontWeight: 700, color: T.text, cursor: "pointer" }}>Receive →</span>}
      </CardHeader>
      <ClientGroups lines={box.lines} status={status} />
    </Card>
  );
}

function JobView({ boxes, status, onReceive }: { boxes: ReceivingBox[]; status: Status; onReceive: (b: ReceivingBox) => void }) {
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
          <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {g.lines.map((l, j) => <FlatRow key={j} l={l} status={status} onReceive={() => onReceive(l.box)} showBox />)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ItemView({ boxes, status, onReceive }: { boxes: ReceivingBox[]; status: Status; onReceive: (b: ReceivingBox) => void }) {
  const lines = useMemo(() => boxes.flatMap(b => b.lines.map(l => ({ ...l, box: b }))), [boxes]);
  return (
    <Card>
      {lines.map((l, i) => (
        <div key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.border}`, padding: "10px 16px" }}>
          <FlatRow l={l} status={status} onReceive={() => onReceive(l.box)} showBox showClient />
        </div>
      ))}
    </Card>
  );
}

function FlatRow({ l, status, onReceive, showBox, showClient }: { l: FlatLine; status: Status; onReceive: () => void; showBox?: boolean; showClient?: boolean }) {
  const received = status === "received";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ItemThumb fileId={l.mockupFileId} name={l.itemName} size={36} />
      <div style={{ minWidth: 170 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{l.itemName}</div>
        {showClient && <div style={{ fontSize: 11, color: T.muted }}>{l.client}{l.invoiceNumber ? ` · #${l.invoiceNumber}` : ""}</div>}
        {showBox && <div style={{ fontSize: 11, color: T.faint }}>{l.box.vendorName} · {boxHow(l.box)}</div>}
      </div>
      <RouteTag route={l.route} />
      <div style={{ flex: 1 }}><VariantChips qtys={qtyOf(l, status)} /></div>
      {received
        ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green }}>✓ received</span>
        : <span onClick={onReceive} style={{ fontSize: 12, fontWeight: 700, color: T.text, cursor: "pointer" }}>Receive →</span>}
    </div>
  );
}

// Receive modal — counts the box in. Per-item per-variant delivered grid (default
// = shipped, under=amber/over=green). Production-declared pulls surface here to
// fulfil; receiving can add its own pull. Confirm writes via receiveBoxAction.
function ReceiveModal({ box, onClose, onDone }: { box: ReceivingBox; onClose: () => void; onDone: () => void }) {
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const l of box.lines) init[l.itemId] = { ...l.shipQtys };
    return init;
  });
  // production pulls default to "fulfil"; receiving-added pulls per item
  const [fulfil, setFulfil] = useState<Record<string, boolean>>(() => {
    const f: Record<string, boolean> = {};
    for (const l of box.lines) for (const p of l.pullRequests) f[p.id] = true;
    return f;
  });
  const [newPull, setNewPull] = useState<Record<string, { qtys: Record<string, number>; kind: string } | undefined>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isTest = box.clients.every(c => TEST_CLIENTS.includes(c));
  const setQ = (id: string, sz: string, v: string) =>
    setQtys(prev => ({ ...prev, [id]: { ...prev[id], [sz]: Math.max(0, Math.floor(Number(v) || 0)) } }));
  const setNP = (id: string, sz: string, v: string) =>
    setNewPull(prev => ({ ...prev, [id]: { kind: prev[id]?.kind || PULL_KINDS[0].id, qtys: { ...(prev[id]?.qtys || {}), [sz]: Math.max(0, Math.floor(Number(v) || 0)) } } }));
  const byClient = new Map<string, ReceivingLine[]>();
  for (const l of box.lines) { const a = byClient.get(l.client) || []; a.push(l); byClient.set(l.client, a); }

  async function confirm() {
    setBusy(true); setErr(null);
    const res = await receiveBoxAction(createClient(), {
      shipmentId: box.id, note,
      items: box.lines.map(l => ({ itemId: l.itemId, jobId: l.jobId, itemName: l.itemName, cumReceived: l.cumReceived, deliveredQtys: qtys[l.itemId] || {} })),
      fulfillPulls: box.lines.flatMap(l => l.pullRequests.filter(p => fulfil[p.id]).map(p => ({ pullId: p.id, itemId: l.itemId, jobId: l.jobId, qtys: p.qtys }))),
      newPulls: Object.entries(newPull).filter(([, np]) => np && tQty(np.qtys) > 0).map(([itemId, np]) => {
        const l = box.lines.find(x => x.itemId === itemId)!;
        return { itemId, jobId: l.jobId, qtys: np!.qtys, kind: np!.kind, reason: null };
      }),
    });
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error || "Receive failed.");
  }

  return (
    <ModalShell onClose={busy ? () => {} : onClose} maxWidth={680} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Receive box — {box.vendorName}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{boxHow(box)} · {box.totalUnits} units · count what actually arrived</div>
        {box.slips.length > 0 && <div style={{ marginTop: 8 }}>{box.slips.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.blue, textDecoration: "none", marginRight: 12 }}>📎 {s.name}</a>
        ))}</div>}
      </div>
      <div style={{ padding: "8px 22px 18px" }}>
        {Array.from(byClient.entries()).map(([client, ls]) => (
          <div key={client} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 8 }}>{client}{ls[0]?.invoiceNumber ? ` · #${ls[0].invoiceNumber}` : ""}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ls.map(l => {
                const np = newPull[l.itemId];
                return (
                  <div key={l.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{l.itemName}</span>
                      <div style={{ flex: 1 }} />
                      <span onClick={() => setNewPull(p => ({ ...p, [l.itemId]: p[l.itemId] ? undefined : { qtys: {}, kind: PULL_KINDS[0].id } }))}
                        style={{ fontSize: 11, fontWeight: 600, color: np ? T.purple : T.muted, cursor: "pointer" }}>{np ? "− cancel pull" : "＋ pull back"}</span>
                    </div>
                    {/* delivered grid */}
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Delivered</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {sortSizes(Object.keys(l.shipQtys)).map(sz => {
                        const got = qtys[l.itemId]?.[sz] ?? 0, want = l.shipQtys[sz] ?? 0;
                        const color = got === want ? T.text : got < want ? "#a87b00" : T.green;
                        return (
                          <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz} <span style={{ color: T.faint }}>/{want}</span></span>
                            <input inputMode="numeric" value={got} onChange={e => setQ(l.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                              style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 700, padding: "5px 4px", borderRadius: 6, border: `1px solid ${got === want ? T.border : color}`, color, background: T.card }} />
                          </label>
                        );
                      })}
                    </div>
                    {/* production-declared pulls to fulfil */}
                    {l.pullRequests.length > 0 && (
                      <div style={{ marginTop: 10, padding: "8px 10px", background: T.purpleDim, borderRadius: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: T.purple, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>⚑ Production wants pulled</div>
                        {l.pullRequests.map(p => (
                          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text, cursor: "pointer", padding: "2px 0" }}>
                            <input type="checkbox" checked={!!fulfil[p.id]} onChange={e => setFulfil(f => ({ ...f, [p.id]: e.target.checked }))} style={{ accentColor: T.purple }} />
                            <span style={{ fontFamily: mono }}>{Object.entries(p.qtys).filter(([, n]) => n > 0).map(([s, n]) => `${s}·${n}`).join(" ")}</span>
                            <span style={{ color: T.muted }}>{p.kind || "pull"}{p.reason ? ` — ${p.reason}` : ""}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {/* receiving-added pull */}
                    {np && (
                      <div style={{ marginTop: 10, padding: "8px 10px", background: T.purpleDim, borderRadius: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: T.purple, textTransform: "uppercase", letterSpacing: 0.4 }}>Pull back</span>
                          <select value={np.kind} onChange={e => setNewPull(p => ({ ...p, [l.itemId]: { ...(p[l.itemId] || { qtys: {} }), kind: e.target.value } as any }))}
                            style={{ fontSize: 11, fontWeight: 600, padding: "3px 6px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }}>
                            {PULL_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {sortSizes(Object.keys(l.shipQtys)).map(sz => (
                            <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 40 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: T.faint }}>{sz}</span>
                              <input inputMode="numeric" value={np.qtys[sz] ?? 0} onChange={e => setNP(l.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                                style={{ width: 40, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 700, padding: "4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note / condition (optional)"
          style={{ marginTop: 14, width: "100%", boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: font }} />
      </div>
      <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Receive write is limited to the test job while we verify.</span>}
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
        <button onClick={confirm} disabled={!isTest || busy}
          style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy) ? "not-allowed" : "pointer", background: (!isTest || busy) ? T.accentDim : T.text, color: (!isTest || busy) ? T.faint : "#fff" }}>
          {busy ? "Receiving…" : "Confirm receipt"}
        </button>
      </div>
    </ModalShell>
  );
}

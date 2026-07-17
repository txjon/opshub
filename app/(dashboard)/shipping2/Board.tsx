"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, KpiBreakdownModal, ModalShell, Card, CardHeader, BoxHead, ItemRow, RowMenu, VariantChips, SegmentControl, SliceSortRow } from "@/components/board-kit";
import { TrackingLink } from "@/components/TrackingModal";
import { forwardToClient, returnForwardedLine, editForwardedLine } from "@/lib/shipping2-forward";
import LedgerHistory from "@/components/LedgerHistory";
// @ts-ignore — plain JS component
import { NotifyShipmentDialog } from "@/components/NotifyShipmentDialog";
import type { ShippingJob, ShippingItem, ForwardedShipment, ForwardedLine } from "@/lib/item-state";
import { v2WriteAllowed } from "@/lib/v2-flags";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const CARRIERS = ["UPS", "DHL", "FedEx", "USPS"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

type Status = "to_forward" | "forwarded";
type FwdView = "shipment" | "job" | "item";
type MetricKey = "jobs" | "ready" | "coming";
const METRICS: { key: MetricKey; label: string }[] = [{ key: "jobs", label: "Orders" }, { key: "ready", label: "Ready units" }, { key: "coming", label: "Coming units" }];

export default function Board({ jobs, forwarded }: { jobs: ShippingJob[]; forwarded: ForwardedShipment[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("to_forward");
  const [fwdView, setFwdView] = useState<FwdView>("shipment");
  const [query, setQuery] = useState("");
  const [kpi, setKpi] = useState<MetricKey | null>(null);
  const [forwardFor, setForwardFor] = useState<ShippingJob | null>(null);
  const [editFor, setEditFor] = useState<{ line: ForwardedLine; shipmentId: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ itemId: string; itemName: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shownJobs = useMemo(() => !q ? jobs : jobs.filter(j =>
    j.clientName.toLowerCase().includes(q) || j.jobNumber.toLowerCase().includes(q) ||
    (j.invoiceNumber || "").toLowerCase().includes(q) || j.items.some(i => i.name.toLowerCase().includes(q))), [jobs, q]);
  const shownFwd = useMemo(() => !q ? forwarded : forwarded.filter(s =>
    s.clients.some(c => c.toLowerCase().includes(q)) || (s.tracking || "").toLowerCase().includes(q) ||
    s.jobNumbers.some(n => n.toLowerCase().includes(q)) || s.lines.some(l => l.itemName.toLowerCase().includes(q))), [forwarded, q]);

  const agg = useMemo(() => ({
    jobs: jobs.length,
    ready: jobs.reduce((a, j) => a + j.readyUnits, 0),
    coming: jobs.reduce((a, j) => a + j.comingUnits, 0),
  }), [jobs]);

  async function returnFwd(l: ForwardedLine, shipmentId: string) {
    setBusyKey(`${shipmentId}:${l.itemId}`);
    const res = await returnForwardedLine(createClient(), { shipmentId, itemId: l.itemId, jobId: l.jobId, itemName: l.itemName });
    setBusyKey(null);
    if (res.ok) router.refresh();
  }

  return (
    <BoardFrame title="Shipping">
      <ToggleSearch options={[["to_forward", `To forward · ${jobs.length}`], ["forwarded", `Forwarded · ${forwarded.length}`]]}
        value={status} onChange={setStatus} query={query} setQuery={setQuery} placeholder="Search client, invoice, item, or tracking…" />

      {status === "to_forward" ? (<>
        <KpiStrip metrics={METRICS} get={k => agg[k]} onClick={setKpi} />
        {shownJobs.length === 0 && <Empty>{q ? "No orders match your search." : "Nothing waiting to forward."}</Empty>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{shownJobs.map(j => <JobCard key={j.jobId} job={j} onForward={() => setForwardFor(j)} onHistory={(itemId, itemName) => setHistoryFor({ itemId, itemName })} />)}</div>
      </>) : (<>
        <SliceSortRow>
          <SegmentControl options={[["shipment", "By shipment"], ["job", "By job"], ["item", "By item"]]} value={fwdView} onChange={setFwdView} />
          <span />
        </SliceSortRow>
        {shownFwd.length === 0 && <Empty>{q ? "No forwarded shipments match." : "Nothing forwarded yet."}</Empty>}
        <ForwardedView shipments={shownFwd} view={fwdView} busyKey={busyKey}
          onEdit={(line, shipmentId) => setEditFor({ line, shipmentId })}
          onReturn={returnFwd} onHistory={(itemId, itemName) => setHistoryFor({ itemId, itemName })} />
      </>)}

      {kpi && <KpiBreakdownModal label={METRICS.find(m => m.key === kpi)!.label} total={agg[kpi]} unit="to forward"
        cols={[{ title: "By order", rows: jobs.map(j => ({ name: `${j.clientName}${j.invoiceNumber ? " · #" + j.invoiceNumber : ""}`, value: kpi === "jobs" ? 1 : kpi === "ready" ? j.readyUnits : j.comingUnits })).filter(r => r.value > 0).sort((a, b) => b.value - a.value) }]}
        onClose={() => setKpi(null)} />}
      {forwardFor && <ForwardModal job={forwardFor} onClose={() => setForwardFor(null)} onDone={() => { setForwardFor(null); router.refresh(); }} />}
      {editFor && <EditForwardedModal line={editFor.line} shipmentId={editFor.shipmentId} onClose={() => setEditFor(null)} onDone={() => { setEditFor(null); router.refresh(); }} />}
      {historyFor && <LedgerHistory itemId={historyFor.itemId} itemName={historyFor.itemName} onClose={() => setHistoryFor(null)} />}
    </BoardFrame>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>{children}</div>;
}

// Per-item status label + ⋯ History for the to-forward rows. Status sits in a
// FIXED-width span so the ⋯ (and therefore every column) lines up down the card.
function ToForwardActions({ it, onHistory }: { it: ShippingItem; onHistory: (itemId: string, itemName: string) => void }) {
  return (
    <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 168, textAlign: "right", fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {it.availableTotal > 0 && <span style={{ color: T.green }}>ready</span>}
        {it.comingTotal > 0 && <span style={{ color: "#a87b00" }}>{it.availableTotal > 0 ? " · " : ""}{it.comingTotal} coming</span>}
        {it.shortTotal > 0 && <span style={{ color: T.red }}>{(it.availableTotal > 0 || it.comingTotal > 0) ? " · " : ""}{it.shortTotal} short</span>}
        {it.pulledTotal > 0 && <span style={{ color: T.purple, fontWeight: 600 }}> · {it.pulledTotal} pulled</span>}
      </span>
      <RowMenu items={[{ label: "History", onClick: () => onHistory(it.itemId, it.name) }]} />
    </div>
  );
}

// ── To-forward: job card (ready vs awaiting — left border + text, no pills) ──
function JobCard({ job, onForward, onHistory }: { job: ShippingJob; onForward: () => void; onHistory: (itemId: string, itemName: string) => void }) {
  const ready = job.status === "ready";
  const color = ready ? T.green : "#a87b00";
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${color}`, borderRadius: 11, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 16px 4px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color }}>{ready ? "Ready to forward" : "Awaiting more"}</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{job.clientName}</span>
        {job.invoiceNumber && <span style={{ fontFamily: mono, fontSize: 12.5, color: T.muted }}>#{job.invoiceNumber}</span>}
      </div>
      {job.shipTo && <div style={{ padding: "0 16px 10px", fontSize: 11.5, color: T.faint }}><span style={{ fontWeight: 700 }}>Ship to:</span> {job.shipTo.replace(/\s*\n\s*/g, " · ")}</div>}
      <div>
        {job.items.map(it => (
          <div key={it.itemId} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
            <ItemRow fileId={it.mockupFileId} name={it.name} route="ship_through"
              variant={it.availableTotal > 0 ? <VariantChips qtys={it.available} /> : <span style={{ fontSize: 12, color: it.shortTotal > 0 ? T.red : "#a87b00", fontWeight: 600 }}>{it.comingTotal > 0 ? `${it.comingTotal} coming` : it.shortTotal > 0 ? `${it.shortTotal} short` : "—"}</span>}
              qty={it.availableTotal || ""}
              actions={<ToForwardActions it={it} onHistory={onHistory} />} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: `1px solid ${T.border}`, background: T.surface, flexWrap: "wrap" }}>
        {ready
          ? <><button onClick={onForward} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Forward order →</button>
              <span style={{ fontSize: 11.5, color: T.muted }}>All items in — {job.readyUnits} units ready to ship once.</span></>
          : <><span style={{ fontSize: 11.5, color: T.muted }}>Default: <b style={{ color: T.text }}>hold</b> until all in. Waiting on {job.comingUnits} units.</span>
              <div style={{ flex: 1 }} />
              {job.readyUnits > 0 && <button onClick={onForward} style={{ background: "transparent", color: "#a87b00", border: `1px solid #a87b00`, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Forward what's ready ({job.readyUnits})</button>}</>}
      </div>
    </div>
  );
}


// ── Forward modal — build the outbound shipment ──────────────────────────────
function ForwardModal({ job, onClose, onDone }: { job: ShippingJob; onClose: () => void; onDone: () => void }) {
  const items = job.items.filter(it => it.availableTotal > 0);
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const it of items) init[it.itemId] = { ...it.available };
    return init;
  });
  const [whole, setWhole] = useState(true);
  const [carrier, setCarrier] = useState("UPS");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ shipmentId: string; forwarded: number } | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notified, setNotified] = useState(false);
  const [contacts, setContacts] = useState<{ name: string; email: string; role: string }[]>([]);

  const isTest = v2WriteAllowed({ clientName: job.clientName });
  const setQ = (id: string, sz: string, v: string) => setQtys(p => ({ ...p, [id]: { ...p[id], [sz]: Math.max(0, Math.floor(Number(v) || 0)) } }));
  const itemTotal = (id: string) => tQty(qtys[id] || {});
  const total = items.reduce((a, it) => a + itemTotal(it.itemId), 0);

  async function confirm() {
    setBusy(true); setErr(null);
    const res = await forwardToClient(createClient(), {
      jobId: job.jobId, carrier, tracking: tracking.trim() || null,
      items: items.map(it => ({ itemId: it.itemId, jobId: job.jobId, itemName: it.name, qtys: qtys[it.itemId] || {} })),
    });
    setBusy(false);
    if (res.ok) {
      // fire-and-forget tracker registration (same as production2's ship path):
      // the outbound box gets a live carrier feed → Client Hub shipment status +
      // future outbound analytics. ensureTracker's guards make failures silent
      // and repeats free.
      fetch("/api/tracking/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentIds: [res.shipmentId] }),
      }).catch(() => {});
      setDone({ shipmentId: res.shipmentId!, forwarded: res.forwarded });
    } else setErr(res.error || "Forward failed.");
  }

  async function openNotify() {
    const sb = createClient();
    const { data } = await sb.from("job_contacts").select("role_on_job, contacts(name, email)").eq("job_id", job.jobId);
    setContacts(((data as any[]) || []).map(r => ({ name: r.contacts?.name || "Unnamed", email: r.contacts?.email || "", role: r.role_on_job || "" })).filter(c => c.email));
    setNotifyOpen(true);
  }

  if (done) {
    return (
      <>
        <ModalShell onClose={onDone} maxWidth={480}>
          <div style={{ padding: "28px 26px", textAlign: "center" }}>
            <div style={{ width: 46, height: 46, borderRadius: 999, background: T.greenDim, color: T.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 12px" }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Forwarded {done.forwarded} units</div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 3 }}>{job.clientName} · outbound to client</div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "center", flexWrap: "wrap" }}>
              <a href={`/api/pdf/packing-slip/${job.jobId}?shipment=${done.shipmentId}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "10px 16px", border: `1px solid ${T.border}`, color: T.text, textDecoration: "none" }}>Packing slip ↗</a>
              <button onClick={openNotify} disabled={notified} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "10px 16px", cursor: notified ? "default" : "pointer", border: `1px solid ${T.border}`, background: notified ? T.greenDim : T.card, color: notified ? T.green : T.text }}>{notified ? "✓ Client notified" : "Notify client"}</button>
              <button onClick={onDone} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "10px 22px", border: "none", cursor: "pointer", background: T.text, color: "#fff" }}>Done</button>
            </div>
          </div>
        </ModalShell>
        {notifyOpen && (
          // route="drop_ship" selects the dialog's CUSTOMER path (client contacts +
          // client template) — a forward notifies the client, not the warehouse.
          <NotifyShipmentDialog open={notifyOpen} onClose={() => setNotifyOpen(false)} onSent={() => { setNotified(true); setNotifyOpen(false); }}
            route="drop_ship" jobId={job.jobId} decoratorId={null} decoratorName="" tracking={tracking.trim() || null}
            qbInvoiceNumber={job.invoiceNumber || ""} clientName={job.clientName} jobTitle={job.jobTitle} contacts={contacts as any} initialMessage="" />
        )}
      </>
    );
  }

  return (
    <ModalShell onClose={onClose} maxWidth={600} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Forward to client · {job.jobNumber}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{job.clientName}</div>
        {job.shipTo && <div style={{ marginTop: 9, background: T.blueDim, border: `1px solid ${T.blue}`, borderRadius: 8, padding: "8px 11px", fontSize: 12, color: T.blue }}><b>Ship to:</b> {job.shipTo}</div>}
      </div>
      <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(it => {
            const sizes = sortSizes(Object.keys(it.available));
            return (
              <div key={it.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{itemTotal(it.itemId)}u</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>avail {it.availableTotal}{it.pulledTotal > 0 ? ` · ${it.pulledTotal} pulled` : ""}</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {sizes.map(sz => (
                    <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz}</span>
                      <input inputMode="numeric" value={qtys[it.itemId]?.[sz] ?? 0} onChange={e => setQ(it.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                        style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 600, padding: "5px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
                      <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, marginTop: 2 }}>/{it.available[sz] ?? 0}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Send as</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["whole", "Whole order"], ["partial", "Partial"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setWhole(k === "whole")} style={{ fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 8, cursor: "pointer", border: `1px solid ${(whole === (k === "whole")) ? T.text : T.border}`, background: (whole === (k === "whole")) ? T.text : T.card, color: (whole === (k === "whole")) ? "#fff" : T.muted }}>{lbl}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Outbound tracking (to the client)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={carrier} onChange={e => setCarrier(e.target.value)} style={{ fontSize: 13, padding: "9px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
              {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking number" style={{ flex: 1, boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: mono }} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: T.blue, background: T.blueDim, border: `1px dashed ${T.blue}`, borderRadius: 8, padding: "9px 11px" }}>
          A frozen client packing slip is created when you forward — referenceable later.
        </div>
      </div>
      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Forward is limited to the test job.</span>}
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
        <button onClick={confirm} disabled={!isTest || busy || total === 0}
          style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy || total === 0) ? "not-allowed" : "pointer", background: (!isTest || busy || total === 0) ? T.accentDim : T.green, color: (!isTest || busy || total === 0) ? T.faint : "#fff" }}>
          {busy ? "Forwarding…" : `Mark forwarded · ${total}u`}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Forwarded view — outbound shipments (shared BoxHead + ItemRow + RowMenu) ──
function ForwardedView({ shipments, view, busyKey, onEdit, onReturn, onHistory }: {
  shipments: ForwardedShipment[]; view: FwdView; busyKey: string | null;
  onEdit: (l: ForwardedLine, shipmentId: string) => void; onReturn: (l: ForwardedLine, shipmentId: string) => void; onHistory: (itemId: string, itemName: string) => void;
}) {
  const rowMenu = (l: ForwardedLine, shipmentId: string) => {
    const busy = busyKey === `${shipmentId}:${l.itemId}`;
    return <RowMenu busy={busy} items={[
      { label: "History", onClick: () => onHistory(l.itemId, l.itemName) },
      { label: "Edit forwarded count", onClick: () => onEdit(l, shipmentId) },
      { label: "← Return to received", danger: true, disabled: busy, onClick: () => onReturn(l, shipmentId) },
    ]} />;
  };

  if (view === "shipment") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {shipments.map(s => (
          <Card key={s.id}>
            <BoxHead vendor={`${s.clients.join(", ") || "—"}${s.lines[0]?.invoiceNumber ? " · #" + s.lines[0].invoiceNumber : ""}`} tag="Forwarded" tagColor={T.green}
              method={s.tracking
                ? <>{s.carrier ? `${s.carrier} · ` : ""}<TrackingLink tracking={s.tracking} shipmentId={s.id} /></>
                : (s.carrier || "no tracking")}
              slips={[{ name: "slip", url: `/api/pdf/packing-slip/${s.lines[0]?.jobId}?shipment=${s.id}` }]} when={fmtWhen(s.createdAt)}
              meta={[{ text: `${s.lines.length} item${s.lines.length > 1 ? "s" : ""} · ${s.totalUnits} units` }]} />
            {s.lines.map(l => (
              <div key={l.itemId} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
                <ItemRow fileId={l.mockupFileId} name={l.itemName} lead={l.client} route={l.route}
                  variant={<VariantChips qtys={l.qtys} />} qty={tQty(l.qtys)} actions={rowMenu(l, s.id)} />
              </div>
            ))}
          </Card>
        ))}
      </div>
    );
  }

  // by-job / by-item: flatten lines
  const lines = shipments.flatMap(s => s.lines.map(l => ({ l, s })));
  if (view === "item") {
    return <Card>{lines.map(({ l, s }, i) => (
      <div key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.border}`, padding: "10px 16px" }}>
        <ItemRow fileId={l.mockupFileId} name={l.itemName} lead={l.client} route={l.route}
          sub={<div style={{ fontSize: 11, color: T.faint }}>{[s.carrier, s.tracking].filter(Boolean).join(" · ")}</div>}
          variant={<VariantChips qtys={l.qtys} />} qty={tQty(l.qtys)} actions={rowMenu(l, s.id)} />
      </div>
    ))}</Card>;
  }
  // by-job
  const byJob = new Map<string, { l: ForwardedLine; s: ForwardedShipment }[]>();
  for (const row of lines) { const k = `${row.l.client}::${row.l.invoiceNumber || ""}`; const a = byJob.get(k) || []; a.push(row); byJob.set(k, a); }
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{Array.from(byJob.entries()).map(([k, rows], gi) => (
    <Card key={gi}>
      <CardHeader>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{rows[0].l.client}</span>
        {rows[0].l.invoiceNumber && <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>#{rows[0].l.invoiceNumber}</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{rows.reduce((a, r) => a + tQty(r.l.qtys), 0)}u</span>
      </CardHeader>
      {rows.map(({ l, s }, i) => (
        <div key={i} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          <ItemRow fileId={l.mockupFileId} name={l.itemName} route={l.route}
            sub={<div style={{ fontSize: 11, color: T.faint }}>{[s.carrier, s.tracking].filter(Boolean).join(" · ")}</div>}
            variant={<VariantChips qtys={l.qtys} />} qty={tQty(l.qtys)} actions={rowMenu(l, s.id)} />
        </div>
      ))}
    </Card>
  ))}</div>;
}

// ── Edit forwarded count ─────────────────────────────────────────────────────
function EditForwardedModal({ line, shipmentId, onClose, onDone }: { line: ForwardedLine; shipmentId: string; onClose: () => void; onDone: () => void }) {
  const sizes = sortSizes(Object.keys(line.qtys));
  const [qtys, setQtys] = useState<Record<string, number>>({ ...line.qtys });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isTest = v2WriteAllowed({ clientName: line.client });
  const total = tQty(qtys);
  const setQ = (sz: string, v: string) => setQtys(p => ({ ...p, [sz]: Math.max(0, Math.floor(Number(v) || 0)) }));

  async function save() {
    setBusy(true); setErr(null);
    const res = await editForwardedLine(createClient(), { shipmentId, itemId: line.itemId, jobId: line.jobId, itemName: line.itemName, newQtys: qtys });
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error || "Edit failed.");
  }

  return (
    <ModalShell onClose={onClose} maxWidth={520} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Edit forwarded — {line.itemName}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{line.client} · fix the forwarded quantity in place</div>
      </div>
      <div style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {sizes.map(sz => (
            <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz}</span>
              <input inputMode="numeric" value={qtys[sz] ?? 0} onChange={e => setQ(sz, e.target.value)} onFocus={e => e.target.select()}
                style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "5px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
            </label>
          ))}
        </div>
      </div>
      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Edit is limited to the test job.</span>}
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
        <button onClick={save} disabled={!isTest || busy} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy) ? "not-allowed" : "pointer", background: (!isTest || busy) ? T.accentDim : T.green, color: (!isTest || busy) ? T.faint : "#fff" }}>{busy ? "Saving…" : `Save · ${total}u`}</button>
      </div>
    </ModalShell>
  );
}

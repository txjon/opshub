"use client";
// The Staging surface (distro) — mirrored with the front-office E-Comm page: the
// SAME component, mounted at /staging2 and /ecomm/staging, sharing one state.
// stage-route items land here once received; "Enter into Shopify" is the END of
// OpsHub's road. Two views (Ready to enter / Entered), flat by-item + a by-client
// filter (the spec's exception to the 3-view pattern). Renders from board-kit.
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, KpiBreakdownModal, ModalShell, Card, CardHeader, ItemRow, RowMenu, VariantChips } from "@/components/board-kit";
import { enterIntoShopify, returnEntered, editEntered } from "@/lib/staging-enter";
import LedgerHistory from "@/components/LedgerHistory";
import type { StagingItem } from "@/lib/item-state";

const TEST_CLIENTS = ["Playwright Test Co"];
const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const blankLine = (it: StagingItem) => [it.blankVendor, it.blankSku, it.color].filter(Boolean).join(" · ");

type View = "ready" | "entered";
type MetricKey = "items" | "units" | "clients";
const METRICS: { key: MetricKey; label: string }[] = [{ key: "items", label: "Items" }, { key: "units", label: "Units" }, { key: "clients", label: "Clients" }];

export default function StagingBoard({ items, side }: { items: StagingItem[]; side: "distro" | "ecomm" }) {
  const router = useRouter();
  const [view, setView] = useState<View>("ready");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState<string>("all");
  const [kpi, setKpi] = useState<MetricKey | null>(null);
  const [enterFor, setEnterFor] = useState<StagingItem | null>(null);
  const [editFor, setEditFor] = useState<StagingItem | null>(null);
  const [historyFor, setHistoryFor] = useState<StagingItem | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const ready = useMemo(() => items.filter(it => it.availableTotal > 0), [items]);
  const entered = useMemo(() => items.filter(it => it.enteredTotal > 0), [items]);
  const active = view === "ready" ? ready : entered;
  const clients = useMemo(() => Array.from(new Set(items.map(it => it.client))).sort(), [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active.filter(it =>
      (client === "all" || it.client === client) &&
      (!q || it.name.toLowerCase().includes(q) || it.client.toLowerCase().includes(q) || (it.invoiceNumber || "").toLowerCase().includes(q) || blankLine(it).toLowerCase().includes(q)));
  }, [active, query, client]);

  const qtyOf = (it: StagingItem) => view === "ready" ? it.available : it.entered;
  const totalOf = (it: StagingItem) => view === "ready" ? it.availableTotal : it.enteredTotal;

  const agg = useMemo(() => ({
    items: shown.length,
    units: shown.reduce((a, it) => a + totalOf(it), 0),
    clients: new Set(shown.map(it => it.client)).size,
  }), [shown, view]);

  async function doReturn(it: StagingItem) {
    setBusyKey(it.itemId);
    const res = await returnEntered(createClient(), { itemId: it.itemId, jobId: it.jobId, itemName: it.name });
    setBusyKey(null);
    if (res.ok) router.refresh();
  }

  const otherName = side === "distro" ? "E-Comm" : "Staging";

  // Entered view = per-client buckets (the "end of the road" reference archive),
  // not a flat feed of every item.
  const clientBuckets = useMemo(() => {
    const m = new Map<string, StagingItem[]>();
    for (const it of shown) { const a = m.get(it.client) || []; a.push(it); m.set(it.client, a); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const renderRow = (it: StagingItem, i: number, inBucket: boolean) => {
    const busy = busyKey === it.itemId;
    const bl = blankLine(it);
    const isTest = TEST_CLIENTS.includes(it.client);
    const actions = view === "ready"
      ? <>
          <button onClick={() => setEnterFor(it)} disabled={!isTest}
            style={{ fontSize: 12, fontWeight: 700, color: isTest ? T.text : T.faint, background: "none", border: "none", cursor: isTest ? "pointer" : "default" }}>Enter into Shopify →</button>
          <RowMenu items={[{ label: "History", onClick: () => setHistoryFor(it) }]} />
        </>
      : <>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.green }}>entered ✓</span>
          <RowMenu busy={busy} items={[
            { label: "History", onClick: () => setHistoryFor(it) },
            { label: "Edit entered count", onClick: () => setEditFor(it) },
            { label: "← Return to received", danger: true, disabled: busy, onClick: () => doReturn(it) },
          ]} />
        </>;
    // In a client bucket the header already names the client → row lead = invoice/job.
    const lead = inBucket ? (it.invoiceNumber ? `#${it.invoiceNumber}` : it.jobNumber) : (it.invoiceNumber ? `${it.client} · #${it.invoiceNumber}` : it.client);
    return (
      <div key={it.itemId} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.border}`, padding: "10px 16px" }}>
        <ItemRow fileId={it.mockupFileId} name={it.name} lead={lead}
          sub={bl ? <div style={{ fontSize: 11, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bl}</div> : undefined}
          variant={<VariantChips qtys={qtyOf(it)} />} qty={totalOf(it)} actions={actions} />
      </div>
    );
  };

  return (
    <BoardFrame title="Staging">
      <div style={{ margin: "-6px 0 10px", fontSize: 11.5, color: T.muted }}>
        <span style={{ fontWeight: 700, color: T.text }}>{side === "distro" ? "Distro" : "Front office"}</span> · mirrors <span style={{ fontWeight: 700, color: T.text }}>{otherName}</span> · staged stock ready for Shopify
      </div>
      <ToggleSearch options={[["ready", `Ready to enter · ${ready.length}`], ["entered", `Entered · ${entered.length}`]]}
        value={view} onChange={setView} query={query} setQuery={setQuery} placeholder="Search client, item, invoice, or blank…" />

      <KpiStrip metrics={METRICS} get={k => agg[k]} onClick={setKpi} />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <select value={client} onChange={e => setClient(e.target.value)}
          style={{ fontSize: 12, fontWeight: 600, padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontFamily: font, cursor: "pointer" }}>
          <option value="all">All clients</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
          {query || client !== "all" ? "No items match." : view === "ready" ? "Nothing staged to enter." : "Nothing entered into Shopify yet."}
        </div>
      ) : view === "ready" ? (
        <Card>{shown.map((it, i) => renderRow(it, i, false))}</Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {clientBuckets.map(([cl, its]) => (
            <Card key={cl}>
              <CardHeader>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{cl}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: 0.4 }}>Entered</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: T.muted }}>{its.length} item{its.length > 1 ? "s" : ""}</span>
                <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{its.reduce((a, it) => a + it.enteredTotal, 0)}u</span>
              </CardHeader>
              {its.map((it, i) => renderRow(it, i, true))}
            </Card>
          ))}
        </div>
      )}

      {kpi && <KpiBreakdownModal label={METRICS.find(m => m.key === kpi)!.label} total={agg[kpi]} unit={view === "ready" ? "ready" : "entered"}
        cols={[{ title: "By client", rows: Array.from(new Set(shown.map(it => it.client))).map(c => ({ name: c, value: kpi === "clients" ? 1 : shown.filter(it => it.client === c).reduce((a, it) => a + (kpi === "items" ? 1 : totalOf(it)), 0) })).filter(r => r.value > 0).sort((a, b) => b.value - a.value) }]}
        onClose={() => setKpi(null)} />}
      {enterFor && <EnterModal item={enterFor} onClose={() => setEnterFor(null)} onDone={() => { setEnterFor(null); router.refresh(); }} />}
      {editFor && <EditEnteredModal item={editFor} onClose={() => setEditFor(null)} onDone={() => { setEditFor(null); router.refresh(); }} />}
      {historyFor && <LedgerHistory itemId={historyFor.itemId} itemName={historyFor.name} onClose={() => setHistoryFor(null)} />}
    </BoardFrame>
  );
}

// Enter-into-Shopify modal — per-variant qty (default = available), gated to test.
function EnterModal({ item, onClose, onDone }: { item: StagingItem; onClose: () => void; onDone: () => void }) {
  const sizes = sortSizes(Object.keys(item.available));
  const [qtys, setQtys] = useState<Record<string, number>>({ ...item.available });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isTest = TEST_CLIENTS.includes(item.client);
  const total = tQty(qtys);
  const setQ = (sz: string, v: string) => setQtys(p => ({ ...p, [sz]: Math.max(0, Math.floor(Number(v) || 0)) }));

  async function confirm() {
    setBusy(true); setErr(null);
    const res = await enterIntoShopify(createClient(), { itemId: item.itemId, jobId: item.jobId, itemName: item.name, qtys });
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error || "Enter failed.");
  }

  return (
    <ModalShell onClose={onClose} maxWidth={520} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Enter into Shopify — {item.name}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{item.client}{item.invoiceNumber ? ` · #${item.invoiceNumber}` : ""}{blankLine(item) ? ` · ${blankLine(item)}` : ""}</div>
      </div>
      <div style={{ padding: "18px 22px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Quantity per size</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {sizes.map(sz => (
            <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz}</span>
              <input inputMode="numeric" value={qtys[sz] ?? 0} onChange={e => setQ(sz, e.target.value)} onFocus={e => e.target.select()}
                style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "5px 4px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card }} />
              <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, marginTop: 2 }}>/{item.available[sz] ?? 0}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: "#b5892a", background: "#faf3e2", border: `1px dashed #b5892a`, borderRadius: 8, padding: "9px 11px" }}>
          Entering marks these units keyed into Shopify — the end of OpsHub's road for them.
        </div>
      </div>
      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        {!isTest && <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Entry is limited to the test job.</span>}
        {err && <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>{err}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} disabled={busy} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Cancel</button>
        <button onClick={confirm} disabled={!isTest || busy || total === 0}
          style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 20px", border: "none", cursor: (!isTest || busy || total === 0) ? "not-allowed" : "pointer", background: (!isTest || busy || total === 0) ? T.accentDim : T.text, color: (!isTest || busy || total === 0) ? T.faint : "#fff" }}>
          {busy ? "Entering…" : `Enter · ${total}u`}
        </button>
      </div>
    </ModalShell>
  );
}

// Edit-entered modal — fix the entered count in place.
function EditEnteredModal({ item, onClose, onDone }: { item: StagingItem; onClose: () => void; onDone: () => void }) {
  const sizes = sortSizes(Object.keys(item.entered));
  const [qtys, setQtys] = useState<Record<string, number>>({ ...item.entered });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isTest = TEST_CLIENTS.includes(item.client);
  const total = tQty(qtys);
  const setQ = (sz: string, v: string) => setQtys(p => ({ ...p, [sz]: Math.max(0, Math.floor(Number(v) || 0)) }));

  async function save() {
    setBusy(true); setErr(null);
    const res = await editEntered(createClient(), { itemId: item.itemId, jobId: item.jobId, itemName: item.name, newQtys: qtys });
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error || "Edit failed.");
  }

  return (
    <ModalShell onClose={onClose} maxWidth={520} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Edit entered — {item.name}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{item.client} · fix the entered quantity in place</div>
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

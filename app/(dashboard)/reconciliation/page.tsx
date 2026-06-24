"use client";

// Phase 1 — Cost Reconciliation Inbox (AP). Assistant enters a vendor invoice
// line (vendor, their invoice #, PO ref, amount, type); the PO ref auto-resolves
// the job + client and shows expected decorator cost vs actual (variance).
// Unmatched refs drop to a queue for a manual job-pick. No QB writes (Phase 3).
// See memory: opshub-cost-reconciliation.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { buildPoRefIndex, resolvePoRef, type JobLite } from "@/lib/po-ref-match";
import { buildPrintersMap, calcCostProduct } from "@/lib/pricing";
import { computeBillingQueue } from "@/lib/billing-queue";

const supabase = createClient();

const money0 = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

const CHARGE_TYPES = [
  { v: "production", label: "Production" },
  { v: "setup_mold", label: "Setup / Mold" },
  { v: "sample", label: "Sample" },
  { v: "freight", label: "Freight" },
  { v: "other", label: "Other" },
];

type Vendor = { id: string; name: string; kind: string; decorator_id: string | null; match_keys?: string[] | null };
type Entry = {
  id: string; vendor_id: string | null; vendor_name: string | null; vendor_invoice_number: string | null;
  po_ref: string | null; job_id: string | null; amount: number; expected_amount: number | null;
  charge_type: string; status: string; not_job_specific: boolean; notes: string | null; created_at: string;
};

// Disposition when marking a vendor fully billed — separates "$X to chase" from
// "$X that's fine" on the board.
const REASONS: { v: string; label: string }[] = [
  { v: "matches", label: "Fully billed — matches" },
  { v: "under", label: "Came in under (saved)" },
  { v: "over_accept", label: "Over — accepted" },
  { v: "over_dispute", label: "Over — disputing" },
  { v: "qb_addition", label: "Added in QB (pre-revise)" },
  { v: "costing_miss", label: "Costing miss" },
  { v: "other", label: "Other" },
];
const reasonLabel = (r: string | null) => REASONS.find(x => x.v === r)?.label || "Complete";
const autoReason = (billed: number, expected: number) => {
  const tol = Math.max(5, expected * 0.01);
  if (Math.abs(billed - expected) <= tol) return "matches";
  return billed > expected ? "over_accept" : "under";
};

const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Tolerate "$7,627.20" / "7,627.20" pasted straight from an invoice.
const parseAmount = (s: string) => parseFloat(String(s).replace(/[^0-9.]/g, "")) || 0;

export default function ReconciliationPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [decorators, setDecorators] = useState<any[]>([]);
  const [jobsRaw, setJobsRaw] = useState<Record<string, any>>({});
  const [marks, setMarks] = useState<{ job_id: string; vendor_id: string; reason: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  // add-form state
  const [vendorId, setVendorId] = useState("");
  const [invoiceNum, setInvoiceNum] = useState("");
  const [poRef, setPoRef] = useState("");
  const [amount, setAmount] = useState("");
  const [chargeType, setChargeType] = useState("production");
  const [saving, setSaving] = useState(false);

  // unmatched manual-assign search
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignQuery, setAssignQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // expanded job / job×vendor rows
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [qFilter, setQFilter] = useState<"open" | "complete" | "all">("open");
  const [showForm, setShowForm] = useState(false);
  const [showByVendor, setShowByVendor] = useState(false);
  const [search, setSearch] = useState("");
  // inline bill entry on a vendor row
  const [billFor, setBillFor] = useState<string | null>(null);
  const [billInv, setBillInv] = useState("");
  const [billAmt, setBillAmt] = useState("");
  const [billSaving, setBillSaving] = useState(false);

  async function loadAll() {
    const [v, j, e, d, m] = await Promise.all([
      supabase.from("ap_vendors").select("id, name, kind, decorator_id, match_keys").eq("active", true).order("name"),
      supabase.from("jobs").select("id, job_number, phase, type_meta, client_id, clients(name), costing_data, costing_summary").order("created_at", { ascending: false }),
      supabase.from("cost_entries").select("*").order("created_at", { ascending: false }),
      supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities"),
      supabase.from("cost_vendor_status").select("job_id, vendor_id, reason"),
    ]);
    setMarks((m.data as any) || []);
    setVendors((v.data as any) || []);
    const jl: JobLite[] = ((j.data as any) || []).map((x: any) => ({
      id: x.id, job_number: x.job_number, qb_invoice_number: x.type_meta?.qb_invoice_number || null,
      client_id: x.client_id, client_name: x.clients?.name || null,
    }));
    setJobs(jl);
    setJobsRaw(Object.fromEntries(((j.data as any) || []).map((x: any) => [x.id, x])));
    setEntries((e.data as any) || []);
    setDecorators((d.data as any) || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  const idx = useMemo(() => buildPoRefIndex(jobs), [jobs]);
  const printers = useMemo(() => buildPrintersMap(decorators), [decorators]);
  const jobById = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs]);
  // vendor_id → the costProd.printVendor key(s) this AP vendor's invoices cover.
  // One payable vendor can span several costing vendors (e.g. Teeland Screen +
  // Embroidery), so this is a SET of keys (from ap_vendors.match_keys; falls back
  // to the linked decorator's short_code||name for any vendor without keys set).
  const vendorKeys = useMemo(() => {
    const dById = Object.fromEntries(decorators.map(d => [d.id, d]));
    const m: Record<string, string[]> = {};
    for (const v of vendors) {
      if (v.match_keys && v.match_keys.length) { m[v.id] = v.match_keys.map(k => (k || "").toUpperCase()); continue; }
      const d = v.decorator_id ? dById[v.decorator_id] : null;
      if (d) m[v.id] = [(d.short_code || d.name || "").toUpperCase()];
    }
    return m;
  }, [vendors, decorators]);

  // Expected decorator cost for a job × vendor = sum of costProd.poTotal for that
  // vendor's items. poTotal is the decorator charge (independent of margin/ship).
  function expectedVendorCost(jobId: string, vId: string | null): number | null {
    if (!jobId || !vId) return null;
    const keys = vendorKeys[vId];
    const jr = jobsRaw[jobId];
    if (!keys || !keys.length || !jr?.costing_data?.costProds) return null;
    const keySet = new Set(keys);
    const cps = jr.costing_data.costProds;
    const margin = String(jr.costing_data?.margin ?? jr.costing_summary?.margin ?? 0);
    let total = 0; let hit = false;
    for (const cp of cps) {
      if (!keySet.has((cp.printVendor || "").toUpperCase())) continue;
      const r = calcCostProduct(cp, margin, false, false, cps, printers);
      if (r) { total += r.poTotal || 0; hit = true; }
    }
    return hit ? Math.round(total * 100) / 100 : null;
  }

  const resolved = useMemo(() => resolvePoRef(poRef, idx), [poRef, idx]);
  const formExpected = useMemo(() => resolved ? expectedVendorCost(resolved.id, vendorId) : null, [resolved, vendorId, jobsRaw, printers, vendorKeys]); // eslint-disable-line
  // already-entered total for this job × vendor, so the readout is cumulative
  const priorForForm = (resolved && vendorId)
    ? entries.filter(e => e.job_id === resolved.id && e.vendor_id === vendorId && !e.not_job_specific).reduce((s, e) => s + Number(e.amount || 0), 0)
    : 0;

  async function addEntry() {
    const amt = parseAmount(amount);
    if (!vendorId || !amt) return;
    setSaving(true);
    const job = resolved;
    const expected = job ? expectedVendorCost(job.id, vendorId) : null;
    const vendorName = vendors.find(v => v.id === vendorId)?.name || null;
    const { error } = await supabase.from("cost_entries").insert({
      source: chargeType === "freight" ? "freight" : "decorator_invoice",
      vendor_id: vendorId, vendor_name: vendorName,
      vendor_invoice_number: invoiceNum.trim() || null,
      po_ref: poRef.trim() || null,
      job_id: job?.id || null,
      amount: amt, expected_amount: expected,
      charge_type: chargeType,
      status: job ? "matched" : "unmatched",
    } as any);
    setSaving(false);
    if (!error) { setInvoiceNum(""); setPoRef(""); setAmount(""); loadAll(); }
  }

  async function assignJob(entryId: string, job: JobLite) {
    const e = entries.find(x => x.id === entryId);
    const expected = e ? expectedVendorCost(job.id, e.vendor_id) : null;
    await supabase.from("cost_entries").update({ job_id: job.id, status: "matched", expected_amount: expected }).eq("id", entryId);
    setAssignFor(null); setAssignQuery(""); loadAll();
  }
  async function markNotJobSpecific(entryId: string) {
    await supabase.from("cost_entries").update({ not_job_specific: true, status: "matched" }).eq("id", entryId);
    loadAll();
  }
  async function removeEntry(entryId: string) {
    await supabase.from("cost_entries").delete().eq("id", entryId);
    loadAll();
  }

  // Inline bill entry: "+ bill" reveals invoice # + total + Log — on a vendor row
  // (key = job::vendor, posts vs QB invoice #) OR a PO row (key = job::vendor::poRef,
  // posts vs that PO ref).
  function openInlineBill(key: string, prefillAmt: number) {
    if (billFor === key) { setBillFor(null); return; }
    setBillFor(key); setBillInv(""); setBillAmt(prefillAmt > 0 ? String(prefillAmt) : "");
  }
  async function logBill(jobId: string, apVendorId: string | null, poRefDefault: string) {
    const amt = parseAmount(billAmt);
    if (!apVendorId || !amt) return;
    setBillSaving(true);
    const vendorName = vendors.find(v => v.id === apVendorId)?.name || null;
    const expected = expectedVendorCost(jobId, apVendorId);
    const { error } = await supabase.from("cost_entries").insert({
      source: "decorator_invoice", vendor_id: apVendorId, vendor_name: vendorName,
      vendor_invoice_number: billInv.trim() || null, po_ref: poRefDefault,
      job_id: jobId, amount: amt, expected_amount: expected, charge_type: "production", status: "matched",
    } as any);
    setBillSaving(false);
    if (!error) { setBillFor(null); setBillInv(""); setBillAmt(""); loadAll(); }
  }
  function inlineBillRow(jobId: string, apVendorId: string | null, poRef: string, label: string) {
    const submit = () => logBill(jobId, apVendorId, poRef);
    return (
      <div onClick={ev => ev.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px 8px 62px", background: T.amberDim, borderBottom: `1px solid ${T.border}33` }}>
        <input autoFocus value={billInv} onChange={e => setBillInv(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="Vendor invoice #" style={{ padding: "5px 9px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 12, fontFamily: font, outline: "none", width: 150 }} />
        <input value={billAmt} onChange={e => setBillAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} inputMode="decimal" placeholder="Total" style={{ padding: "5px 9px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 12, fontFamily: mono, outline: "none", width: 110 }} />
        <button onClick={submit} disabled={billSaving || !parseAmount(billAmt)} style={{ background: parseAmount(billAmt) ? T.green : T.surface, color: parseAmount(billAmt) ? "#fff" : T.faint, border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: parseAmount(billAmt) ? "pointer" : "default", fontFamily: font }}>{billSaving ? "…" : "Log"}</button>
        <button onClick={() => setBillFor(null)} style={{ ...miniBtn(T.faint), width: 26 }}>×</button>
        <span style={{ fontSize: 10.5, color: T.faint }}>→ {poRef} · {label}</span>
      </div>
    );
  }

  const unmatched = entries.filter(e => e.status === "unmatched" && !e.not_job_specific);
  const notJobSpecific = entries.filter(e => e.not_job_specific);

  // BILLING QUEUE — the spine. Driven by costing + PO-sent (not by logged
  // invoices): every job × PO-sent vendor → expected (costing) vs billed (entries),
  // gap = outstanding; summed = OPEN PO COMMITMENT. See lib/billing-queue.ts.
  const queue = useMemo(() => computeBillingQueue({
    jobs: Object.values(jobsRaw), printers, apVendors: vendors as any, entries: entries as any, marks,
  }), [jobsRaw, printers, vendors, entries, marks]);
  const sq = search.trim().toLowerCase();
  const filteredQueue = queue.jobs
    .filter(j => qFilter === "all" ? true : qFilter === "complete" ? j.costComplete : !j.costComplete)
    .filter(j => !sq || (j.qb_invoice_number || "").toLowerCase().includes(sq) || (j.job_number || "").toLowerCase().includes(sq) || (j.client_name || "").toLowerCase().includes(sq) || j.vendors.some(v => v.name.toLowerCase().includes(sq)));
  // open PO broken down by vendor — "who do we owe"
  const openByVendor = (() => {
    const m: Record<string, { name: string; outstanding: number; jobs: number }> = {};
    for (const j of queue.jobs) for (const v of j.vendors) {
      if (v.outstanding <= 0) continue;
      (m[v.name] = m[v.name] || { name: v.name, outstanding: 0, jobs: 0 });
      m[v.name].outstanding += v.outstanding; m[v.name].jobs++;
    }
    return Object.values(m).sort((a, b) => b.outstanding - a.outstanding);
  })();
  // entries for a job × vendor, for the drill-down under a vendor row
  const entriesFor = (jobId: string, vId: string | null) => entries.filter(e => e.job_id === jobId && e.vendor_id === vId && !e.not_job_specific);
  const STATE_META: Record<string, { label: string; color: string }> = {
    awaiting: { label: "Awaiting invoice", color: T.faint },
    partial: { label: "Partial", color: T.amber },
    billed: { label: "Billed", color: T.green },
    over: { label: "Over", color: T.red },
    nobaseline: { label: "No baseline", color: T.faint },
    complete: { label: "✓ Complete", color: T.green },
  };
  async function markComplete(jobId: string, apVendorId: string | null, reason: string) {
    if (!apVendorId) return;
    await supabase.from("cost_vendor_status").upsert({ job_id: jobId, vendor_id: apVendorId, status: "complete", reason }, { onConflict: "job_id,vendor_id" } as any);
    loadAll();
  }
  async function reopenVendor(jobId: string, apVendorId: string | null) {
    if (!apVendorId) return;
    await supabase.from("cost_vendor_status").delete().eq("job_id", jobId).eq("vendor_id", apVendorId);
    loadAll();
  }

  const lbl = { fontSize: 9, fontWeight: 700 as const, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: T.faint };
  const inp = { padding: "7px 9px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none" };

  if (loading) return <div style={{ padding: 24, color: T.muted, fontFamily: font }}>Loading…</div>;

  return (
    <div style={{ padding: "22px 26px", fontFamily: font, maxWidth: 1180, margin: "0 auto" }}>
      <style>{`
        .bq-mono { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
        .bq-ghost { background: transparent; border: 1px solid ${T.border}; color: ${T.muted}; border-radius: 6px; padding: 4px 11px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: ${font}; transition: background .12s, color .12s, border-color .12s; white-space: nowrap; }
        .bq-ghost:hover { background: ${T.accent}; color: #fff; border-color: ${T.accent}; }
        .bq-ghost.on { background: ${T.green}; color: #fff; border-color: ${T.green}; }
        .bq-act { opacity: 0; transition: opacity .12s; }
        .bq-row:hover .bq-act { opacity: 1; }
        .bq-x { background: transparent; border: none; color: ${T.faint}; cursor: pointer; font-size: 14px; line-height: 1; padding: 3px 7px; border-radius: 5px; transition: background .12s, color .12s; }
        .bq-x:hover { background: ${T.redDim}; color: ${T.red}; }
      `}</style>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Billing Queue</h1>
        <button onClick={() => setShowForm(s => !s)} style={{ background: showForm ? T.surface : T.accent, color: showForm ? T.text : "#fff", border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{showForm ? "Close" : "+ Add bill"}</button>
      </div>

      {/* Open PO hero + stats */}
      <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: T.accent, color: "#fff", borderRadius: 12, padding: "16px 22px", minWidth: 240 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>Open PO Commitment</div>
          <div style={{ fontSize: 30, fontWeight: 800, fontFamily: mono, margin: "5px 0 3px" }}>{money0(queue.openPO)}</div>
          <div style={{ fontSize: 10.5, opacity: 0.75 }}>committed, not yet billed/paid · {queue.stats.openJobs} open job{queue.stats.openJobs !== 1 ? "s" : ""}</div>
        </div>
        {([
          ["Expected", money0(queue.stats.expected), T.text],
          ["Billed", money0(queue.stats.billed), T.green],
          ["Cost-complete", `${queue.stats.costComplete} / ${queue.stats.jobs}`, T.text],
          ["Awaiting invoices", String(queue.stats.awaitingVendors), T.faint],
        ] as const).map(([k, v, c]) => (
          <div key={k} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 18px", minWidth: 130 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.faint }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: mono, color: c, marginTop: 5 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Open PO by vendor */}
      {openByVendor.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => setShowByVendor(s => !s)} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: font, padding: 0 }}>{showByVendor ? "▾" : "▸"} Open PO by vendor ({openByVendor.length})</button>
          {showByVendor && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginTop: 8, display: "flex", flexDirection: "column", gap: 7 }}>
              {openByVendor.map(v => {
                const pct = Math.round((100 * v.outstanding) / (openByVendor[0].outstanding || 1));
                return (
                  <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                    <span style={{ width: 170, color: T.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</span>
                    <div style={{ flex: 1, height: 8, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: T.amber }} />
                    </div>
                    <span style={{ width: 50, textAlign: "right", color: T.faint, fontSize: 11 }}>{v.jobs} job{v.jobs !== 1 ? "s" : ""}</span>
                    <span style={{ width: 90, textAlign: "right", fontFamily: mono, fontWeight: 700, color: T.text }}>{money0(v.outstanding)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add form (collapsible) */}
      {showForm && <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 1fr", gap: 10, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Vendor</span>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} style={inp as any}>
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.kind !== "decorator" ? ` (${v.kind})` : ""}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Vendor Invoice #</span>
            <input value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="74579" style={inp as any} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>PO Ref</span>
            <input value={poRef} onChange={e => setPoRef(e.target.value)} placeholder="4308-A" style={{ ...inp, fontFamily: mono } as any} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Amount</span>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ ...inp, fontFamily: mono } as any} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Type</span>
            <select value={chargeType} onChange={e => setChargeType(e.target.value)} style={inp as any}>
              {CHARGE_TYPES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
        </div>
        {/* live resolution */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, minHeight: 24 }}>
          <div style={{ fontSize: 12 }}>
            {poRef.trim() === "" ? <span style={{ color: T.faint }}>Enter a PO ref to resolve the job.</span>
              : resolved ? <span style={{ color: T.text }}>→ <strong>{resolved.job_number}</strong> · {resolved.client_name || "—"}
                  {formExpected != null && (() => {
                    const running = priorForForm + parseAmount(amount);
                    const delta = running - formExpected;
                    const tol = Math.max(5, formExpected * 0.01);
                    const col = Math.abs(delta) <= tol ? T.green : delta > 0 ? T.red : T.amber;
                    return <span style={{ color: T.muted }}>  ·  {vendors.find(v => v.id === vendorId)?.name} expected {money(formExpected)}
                      {parseAmount(amount) > 0 && <> · <span style={{ color: col, fontWeight: 700 }}>{money(running)} of {money(formExpected)}{Math.abs(delta) <= tol ? " ✓" : delta > 0 ? ` (+${money(delta)} over)` : ` (${money(-delta)} to go)`}</span>{priorForForm > 0 && <span style={{ color: T.faint }}> · {money(priorForForm)} already entered</span>}</>}
                    </span>;
                  })()}
                  {formExpected == null && <span style={{ color: T.faint }}>  ·  no costing baseline</span>}
                </span>
              : <span style={{ color: T.amber }}>⚠ No job matched — will go to the unmatched queue.</span>}
          </div>
          <button onClick={addEntry} disabled={saving || !vendorId || !parseAmount(amount)}
            style={{ background: (!vendorId || !parseAmount(amount)) ? T.surface : T.accent, color: (!vendorId || !parseAmount(amount)) ? T.faint : "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: (!vendorId || !parseAmount(amount)) ? "default" : "pointer", fontFamily: font }}>
            {saving ? "Saving…" : "Add entry"}
          </button>
        </div>
      </div>}

      {/* Unmatched queue */}
      {unmatched.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ ...lbl, color: T.amber, marginBottom: 8 }}>Unmatched · {unmatched.length}</div>
          <div style={{ border: `1px solid ${T.amber}55`, borderRadius: 10, overflow: "hidden" }}>
            {unmatched.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: T.amberDim, borderBottom: `1px solid ${T.border}44`, fontSize: 12, position: "relative" }}>
                <span style={{ width: 130, color: T.text, fontWeight: 600 }}>{e.vendor_name || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.muted }}>{e.vendor_invoice_number || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.text }}>{e.po_ref || "—"}</span>
                <span style={{ flex: 1, fontFamily: mono, textAlign: "right", color: T.text }}>{money(e.amount)}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8, position: "relative" }}>
                  <button onClick={() => { setAssignFor(assignFor === e.id ? null : e.id); setAssignQuery(""); }} style={miniBtn(T.accent)}>Assign job</button>
                  <button onClick={() => markNotJobSpecific(e.id)} style={miniBtn(T.faint)}>Not job-specific</button>
                  <button onClick={() => removeEntry(e.id)} style={miniBtn(T.faint)}>✕</button>
                  {assignFor === e.id && (
                    <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginTop: 4, width: 280, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
                      <input autoFocus value={assignQuery} onChange={ev => setAssignQuery(ev.target.value)} placeholder="Search job # / client…" style={{ ...inp, width: "100%", border: "none", borderBottom: `1px solid ${T.border}`, borderRadius: 0 } as any} />
                      <div style={{ maxHeight: 220, overflowY: "auto" }}>
                        {jobs.filter(j => { const q = assignQuery.trim().toLowerCase(); return q && ((j.job_number || "").toLowerCase().includes(q) || (j.client_name || "").toLowerCase().includes(q) || String(j.qb_invoice_number || "").includes(q)); }).slice(0, 10).map(j => (
                          <div key={j.id} onClick={() => assignJob(e.id, j)} style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${T.border}44` }}
                            onMouseEnter={ev => ev.currentTarget.style.background = T.surface} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                            <strong>{j.job_number}</strong> <span style={{ color: T.muted }}>· {j.client_name}</span> {j.qb_invoice_number && <span style={{ color: T.faint, fontFamily: mono }}>· {j.qb_invoice_number}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing queue — job × PO-sent vendor */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO # / QB invoice · client · vendor…"
            style={{ width: "100%", padding: "7px 30px 7px 11px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer", padding: 0 }}>×</button>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {([["open", "Open", queue.stats.openJobs], ["complete", "Cost-complete", queue.stats.costComplete], ["all", "All", queue.stats.jobs]] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setQFilter(k)} style={{ background: qFilter === k ? T.accent : T.card, color: qFilter === k ? "#fff" : T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{label} · {n}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filteredQueue.length === 0 ? <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", color: T.faint, fontSize: 12 }}>No jobs in this view.</div> : filteredQueue.map(j => {
          const isOpen = expanded.has(j.id);
          return (
            <div key={j.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => toggle(j.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: "pointer", background: T.card }}>
                <span style={{ color: T.faint, fontSize: 10, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{j.qb_invoice_number ? <span style={{ fontFamily: mono }}>{j.qb_invoice_number}</span> : j.job_number} <span style={{ color: T.muted, fontWeight: 400 }}>· {j.client_name || "—"}</span></div>
                  <div style={{ fontSize: 11, color: T.faint, textTransform: "capitalize" }}>{j.vendors.length} vendor{j.vendors.length !== 1 ? "s" : ""} · {(j.phase || "—").replace(/_/g, " ")}{j.qb_invoice_number ? <span style={{ textTransform: "none" }}> · {j.job_number}</span> : ""}</div>
                </div>
                <div style={{ width: 80, height: 6, background: T.surface, borderRadius: 3, overflow: "hidden" }} title={`${j.billedPct}% billed`}>
                  <div style={{ width: `${j.billedPct}%`, height: "100%", background: j.costComplete ? T.green : T.amber }} />
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 12.5, color: T.text, width: 150 }}>
                  {money0(j.billed)} <span style={{ color: T.faint }}>of {money0(j.expected)}</span>
                </div>
                <div style={{ width: 120, display: "flex", justifyContent: "flex-end" }}>
                  {j.costComplete
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green, background: T.green + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>Cost-complete</span>
                    : <span style={{ fontSize: 11, fontWeight: 700, color: T.amber, background: T.amber + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>{money0(j.outstanding)} open</span>}
                </div>
              </div>
              {isOpen && (
                <div style={{ borderTop: `1px solid ${T.border}55`, background: T.surface }}>
                  {j.vendors.map(v => {
                    const vKey = `${j.id}::${v.apVendorId}`;
                    const vOpen = expanded.has(vKey);
                    const meta = STATE_META[v.state];
                    const lines = entriesFor(j.id, v.apVendorId);
                    const poRefSet = new Set(v.items.map(it => it.poRef));
                    const otherLines = lines.filter(e => !poRefSet.has(e.po_ref || "")); // vendor-level / not matched to a PO
                    const expandable = v.items.length > 0 || lines.length > 0;
                    return (
                      <div key={vKey}>
                        <div onClick={() => expandable && toggle(vKey)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px 9px 40px", fontSize: 12, borderBottom: `1px solid ${T.border}33`, cursor: expandable ? "pointer" : "default" }}>
                          <span style={{ color: T.faint, fontSize: 9, width: 8 }}>{expandable ? (vOpen ? "▾" : "▸") : ""}</span>
                          <span style={{ flex: 1, color: T.text, fontWeight: 600 }}>{v.name}{v.items.length > 1 ? <span style={{ color: T.faint, fontWeight: 400 }}> · {v.items.length} POs</span> : ""}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.color + "1f", padding: "2px 9px", borderRadius: 20 }}>{meta.label}</span>
                          <span style={{ width: 150, textAlign: "right", fontFamily: mono, color: T.text }}>{money(v.billed)} <span style={{ color: T.faint }}>of {money(v.expected)}</span></span>
                          <span style={{ width: 90, textAlign: "right", fontFamily: mono, fontWeight: 700, color: v.outstanding > 0 ? T.amber : T.green }}>{v.outstanding > 0 ? money(v.outstanding) : "—"}</span>
                          <button onClick={ev => { ev.stopPropagation(); openInlineBill(vKey, v.outstanding); }} title="Log a bill for this job + vendor" className={`bq-ghost${billFor === vKey ? " on" : ""}`}>+ bill</button>
                        </div>
                        {billFor === vKey && inlineBillRow(j.id, v.apVendorId, j.qb_invoice_number || j.job_number, v.name)}
                        {vOpen && (
                          <div style={{ background: T.bg }}>
                            {v.items.map(it => {
                              const poKey = `${vKey}::${it.poRef}`;
                              const poLines = lines.filter(e => (e.po_ref || "") === it.poRef);
                              const billedPo = Math.round(poLines.reduce((s, e) => s + Number(e.amount || 0), 0) * 100) / 100;
                              const isBilled = poLines.length > 0;
                              const exp = it.expected;
                              const diff = isBilled ? Math.round((billedPo - exp) * 100) / 100 : 0; // billed − projected
                              const tol = Math.max(5, exp * 0.01);
                              const state = !isBilled ? "await" : Math.abs(diff) <= tol ? "ok" : diff < 0 ? "under" : "over";
                              const dot = state === "await" ? T.border : state === "over" ? T.red : state === "under" ? T.amber : T.green;
                              const amtColor = state === "over" ? T.red : state === "under" ? T.amber : T.green;
                              return (
                                <div key={it.poRef}>
                                  <div className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 38, padding: "5px 16px 5px 22px", borderTop: `1px solid ${T.border}22`, borderLeft: `2px solid ${isBilled ? dot : "transparent"}` }}>
                                    <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: isBilled ? dot : "transparent", border: isBilled ? "none" : `1.5px solid ${T.border}` }} />
                                    <span className="bq-mono" style={{ width: 92, fontFamily: mono, fontSize: 12, color: T.text, fontWeight: 600 }}>{it.poRef}</span>
                                    <span style={{ flex: 1, fontSize: 12.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
                                    <div style={{ width: 170, textAlign: "right" }}>
                                      {!isBilled
                                        ? <span className="bq-mono" style={{ fontFamily: mono, fontSize: 12.5, color: T.muted }}>{money(exp)}</span>
                                        : <>
                                            <div className="bq-mono" style={{ fontFamily: mono, fontSize: 12.5, color: amtColor, fontWeight: 600, lineHeight: 1.25 }}>{money(billedPo)}</div>
                                            {diff !== 0 && <div className="bq-mono" style={{ fontFamily: mono, fontSize: 9.5, color: T.faint, lineHeight: 1.25 }}>proj {money(exp)} · <span style={{ color: diff > 0 ? T.red : T.muted, fontWeight: 600 }}>{diff < 0 ? "−" : "+"}{money(Math.abs(diff))}</span></div>}
                                          </>}
                                    </div>
                                    <span style={{ width: 50, display: "flex", justifyContent: "flex-end" }}>
                                      <button onClick={ev => { ev.stopPropagation(); openInlineBill(poKey, Math.max(0, it.expected - billedPo) || it.expected); }} className={`bq-ghost${billFor === poKey ? " on" : ""}`}>+ bill</button>
                                    </span>
                                  </div>
                                  {poLines.map(e => (
                                    <div key={e.id} className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, height: 28, padding: "0 16px 0 44px", borderTop: `1px solid ${T.border}14` }}>
                                      <span style={{ flex: 1, fontSize: 11.5, color: T.faint, fontFamily: mono }}>inv {e.vendor_invoice_number || "—"}</span>
                                      <span className="bq-mono" style={{ width: 150, textAlign: "right", fontFamily: mono, fontSize: 11.5, color: T.muted }}>{money(e.amount)}</span>
                                      <span className="bq-act" style={{ width: 50, display: "flex", justifyContent: "flex-end" }}>
                                        <button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} className="bq-x">×</button>
                                      </span>
                                    </div>
                                  ))}
                                  {billFor === poKey && inlineBillRow(j.id, v.apVendorId, it.poRef, it.name)}
                                </div>
                              );
                            })}
                            {otherLines.length > 0 && (
                              <div style={{ padding: "7px 16px 2px 22px", fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.faint }}>Other bills</div>
                            )}
                            {otherLines.map(e => (
                              <div key={e.id} className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, height: 30, padding: "0 16px 0 22px", borderTop: `1px solid ${T.border}14` }}>
                                <span style={{ width: 7, flexShrink: 0 }} />
                                <span className="bq-mono" style={{ width: 92, fontFamily: mono, fontSize: 12, color: T.text }}>{e.po_ref || "—"}</span>
                                <span style={{ flex: 1, fontSize: 11.5, color: T.faint, fontFamily: mono }}>inv {e.vendor_invoice_number || "—"}</span>
                                <span className="bq-mono" style={{ width: 150, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.text }}>{money(e.amount)}</span>
                                <span className="bq-act" style={{ width: 50, display: "flex", justifyContent: "flex-end" }}>
                                  <button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} className="bq-x">×</button>
                                </span>
                              </div>
                            ))}
                            {/* mark fully billed / reopen */}
                            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 10px 22px", borderTop: `1px solid ${T.border}33` }}>
                              {v.complete ? (
                                <>
                                  <span style={{ fontSize: 11.5, color: T.green, fontWeight: 700 }}>✓ Fully billed</span>
                                  <select value={v.reason || "other"} onChange={e => markComplete(j.id, v.apVendorId, e.target.value)} style={{ padding: "4px 8px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 11.5, fontFamily: font, outline: "none" }}>
                                    {REASONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                                  </select>
                                  <button onClick={() => reopenVendor(j.id, v.apVendorId)} className="bq-ghost">Reopen</button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => markComplete(j.id, v.apVendorId, autoReason(v.billed, v.expected))} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Mark fully billed</button>
                                  <span style={{ fontSize: 11, color: T.faint }}>confirm no more invoices coming{v.outstanding > 0 ? ` · clears ${money(v.outstanding)} from Open PO` : ""}</span>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {notJobSpecific.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ ...lbl, marginBottom: 8 }}>Not job-specific · {notJobSpecific.length}</div>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {notJobSpecific.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", fontSize: 12, borderBottom: `1px solid ${T.border}33` }}>
                <span style={{ width: 130, color: T.text, fontWeight: 600 }}>{e.vendor_name || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.muted }}>{e.vendor_invoice_number || "—"}</span>
                <span style={{ flex: 1, color: T.faint, textTransform: "capitalize" }}>{e.charge_type.replace(/_/g, " ")}</span>
                <span style={{ width: 90, textAlign: "right", fontFamily: mono, color: T.text }}>{money(e.amount)}</span>
                <button onClick={() => removeEntry(e.id)} style={{ ...miniBtn(T.faint), width: 28 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function miniBtn(color: string) {
  return { background: "none", border: `1px solid ${T.border}`, color, borderRadius: 5, padding: "4px 9px", fontSize: 11, fontWeight: 600 as const, cursor: "pointer", fontFamily: font };
}

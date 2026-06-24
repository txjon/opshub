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

const supabase = createClient();

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

const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Tolerate "$7,627.20" / "7,627.20" pasted straight from an invoice.
const parseAmount = (s: string) => parseFloat(String(s).replace(/[^0-9.]/g, "")) || 0;

export default function ReconciliationPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [decorators, setDecorators] = useState<any[]>([]);
  const [jobsRaw, setJobsRaw] = useState<Record<string, any>>({});
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // expanded job×vendor groups
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function loadAll() {
    const [v, j, e, d] = await Promise.all([
      supabase.from("ap_vendors").select("id, name, kind, decorator_id, match_keys").eq("active", true).order("name"),
      supabase.from("jobs").select("id, job_number, type_meta, client_id, clients(name), costing_data, costing_summary").order("created_at", { ascending: false }),
      supabase.from("cost_entries").select("*").order("created_at", { ascending: false }),
      supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities"),
    ]);
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

  const unmatched = entries.filter(e => e.status === "unmatched" && !e.not_job_specific);
  const notJobSpecific = entries.filter(e => e.not_job_specific);

  // Roll up matched entries by job × vendor — the meaningful unit. A vendor that
  // invoices in pieces (Icon per item, Teeland per service) only ties out at this
  // level: sum of its invoices for the job vs the expected vendor cost.
  const groups = (() => {
    const g: Record<string, { key: string; job_id: string; vendor_id: string | null; vendor_name: string | null; lines: Entry[] }> = {};
    for (const e of entries) {
      if (e.status === "unmatched" || e.not_job_specific || !e.job_id) continue;
      const key = `${e.job_id}::${e.vendor_id}`;
      (g[key] = g[key] || { key, job_id: e.job_id, vendor_id: e.vendor_id, vendor_name: e.vendor_name, lines: [] }).lines.push(e);
    }
    const arr = Object.values(g).map(gr => {
      const entered = gr.lines.reduce((s, e) => s + Number(e.amount || 0), 0);
      const expected = expectedVendorCost(gr.job_id, gr.vendor_id);
      const delta = expected != null ? Math.round((entered - expected) * 100) / 100 : null;
      const tol = expected != null ? Math.max(5, expected * 0.01) : 0;
      const status = expected == null ? "nobaseline" : Math.abs(delta!) <= tol ? "reconciled" : delta! > 0 ? "over" : "open";
      return { ...gr, entered, expected, delta, status };
    });
    const rank: Record<string, number> = { over: 0, open: 1, nobaseline: 2, reconciled: 3 };
    arr.sort((a, b) => (rank[a.status] - rank[b.status]) || (jobById[a.job_id]?.job_number || "").localeCompare(jobById[b.job_id]?.job_number || ""));
    return arr;
  })();
  const openCount = groups.filter(g => g.status === "open" || g.status === "over").length;

  const lbl = { fontSize: 9, fontWeight: 700 as const, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: T.faint };
  const inp = { padding: "7px 9px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none" };

  if (loading) return <div style={{ padding: 24, color: T.muted, fontFamily: font }}>Loading…</div>;

  return (
    <div style={{ padding: "22px 26px", fontFamily: font, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Cost Reconciliation</h1>
        <div style={{ fontSize: 11, color: T.faint }}>Phase 1 · vendor invoice entry + matching</div>
      </div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 18 }}>Enter a vendor invoice line — the PO ref resolves the job + client and compares to the expected decorator cost.</div>

      {/* Add form */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
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
      </div>

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

      {/* Reconciliation — rolled up by job × vendor */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={lbl}>Reconciliation · {groups.length} job{groups.length !== 1 ? "s" : ""}</div>
        {openCount > 0 && <div style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>{openCount} need{openCount === 1 ? "s" : ""} attention</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {groups.length === 0 ? <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", color: T.faint, fontSize: 12 }}>No matched entries yet.</div> : groups.map(g => {
          const job = jobById[g.job_id];
          const isOpen = expanded.has(g.key);
          const meta = g.status === "reconciled" ? { label: "Reconciled", color: T.green }
            : g.status === "over" ? { label: `Over ${money(g.delta!)}`, color: T.red }
            : g.status === "open" ? { label: `${money(-(g.delta!))} to go`, color: T.amber }
            : { label: "No baseline", color: T.faint };
          return (
            <div key={g.key} style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => toggle(g.key)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: "pointer", background: T.card }}>
                <span style={{ color: T.faint, fontSize: 10, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{job?.job_number || "—"} · {g.vendor_name}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{job?.client_name || ""} · {g.lines.length} invoice{g.lines.length !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 12.5, color: T.text }}>
                  {money(g.entered)} <span style={{ color: T.faint }}>of {g.expected != null ? money(g.expected) : "—"}</span>
                </div>
                <div style={{ width: 130, display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.color + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>{meta.label}</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ borderTop: `1px solid ${T.border}55`, background: T.surface }}>
                  {g.lines.map(e => (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px 8px 40px", fontSize: 12, borderBottom: `1px solid ${T.border}33` }}>
                      <span style={{ width: 90, fontFamily: mono, color: T.muted }}>{e.vendor_invoice_number || "—"}</span>
                      <span style={{ width: 110, fontFamily: mono, color: T.text }}>{e.po_ref || "—"}</span>
                      <span style={{ flex: 1, color: T.faint, textTransform: "capitalize" }}>{e.charge_type.replace(/_/g, " ")}</span>
                      <span style={{ width: 90, textAlign: "right", fontFamily: mono, color: T.text }}>{money(e.amount)}</span>
                      <button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} style={{ ...miniBtn(T.faint), width: 28 }}>✕</button>
                    </div>
                  ))}
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

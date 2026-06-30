"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { parseUpsCsv, aggregateShipments, matchShipments, calculatedShipping, FREIGHT_SOURCES } from "@/lib/ups-freight";
import { resolvePoRef, buildPoRefIndex, type JobLite } from "@/lib/po-ref-match";

// Inbound production freight (UPS). Upload CSV(s) → match by ref → IMPORT ALL
// (matched → jobs, unmatched → a persistent "Needs a match" queue) → reconcile the
// queue later by assigning each to a job. Then per-job ACTUAL vs CALCULATED.
// Outbound (distro) is a separate UPS account / feed.

type JobFull = JobLite & { costing_data: any };
type FreightEntry = { id: string; job_id: string | null; amount: number; ext_tracking: string | null; ext_date: string | null; vendor_invoice_number: string | null; vendor_name: string | null; po_ref: string | null; not_job_specific: boolean; created_at: string; source: string };
type Staged = { invoiceNumber: string; tracking: string; cost: number; ref: string; sender: string; date: string; sections: string[]; job: JobFull | null; dupe: boolean };

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const invoiceFromName = (name: string) => (name.match(/\d{5,}[A-Z][A-Z0-9]*\d+/i)?.[0]) || name.replace(/\.csv$/i, "");
const lbl = { fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.faint } as const;

export function ShippingView({ companyId, billingOnly = false }: { companyId: string; billingOnly?: boolean }) {
  const supabase = createClient();
  const [jobs, setJobs] = useState<JobFull[]>([]);
  const [existing, setExisting] = useState<FreightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [importing, setImporting] = useState(false);
  const [qSearch, setQSearch] = useState<Record<string, string>>({}); // queue-row job search
  const [showHistory, setShowHistory] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [selQ, setSelQ] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addPo, setAddPo] = useState("");
  const [addAmt, setAddAmt] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [{ data: js }, { data: es }] = await Promise.all([
      supabase.from("jobs").select("id, job_number, type_meta, costing_data, clients(name)").eq("company_id", companyId),
      supabase.from("cost_entries").select("id, job_id, amount, ext_tracking, ext_date, vendor_invoice_number, vendor_name, po_ref, not_job_specific, created_at, source").in("source", FREIGHT_SOURCES),
    ]);
    setJobs(((js as any[]) || []).map(j => ({ id: j.id, job_number: j.job_number, qb_invoice_number: j.type_meta?.qb_invoice_number ?? null, client_name: (j.clients as any)?.name ?? null, costing_data: j.costing_data })));
    setExisting((es as any[]) || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, [companyId]); // eslint-disable-line

  const jobById = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs]);
  const importedKeys = useMemo(() => new Set(existing.map(e => `${e.vendor_invoice_number || ""}::${e.ext_tracking || ""}`)), [existing]);

  // ── manual freight entry (LTL / CC) — type a PO, auto-resolve the job ──
  const poIndex = useMemo(() => buildPoRefIndex(jobs), [jobs]);
  const addResolved = addPo.trim() ? (resolvePoRef(addPo, poIndex) as JobFull | null) : null;
  async function saveManual() {
    const amt = parseFloat(addAmt.replace(/[$,]/g, "")) || 0;
    if (!amt) return;
    setAddSaving(true);
    const { error } = await supabase.from("cost_entries").insert({
      source: "manual_freight", charge_type: "freight", status: addResolved ? "matched" : "unmatched",
      job_id: addResolved?.id ?? null, vendor_name: "Freight (manual)", po_ref: addPo.trim() || null,
      ext_date: new Date().toISOString().slice(0, 10), amount: amt, not_job_specific: false, notes: "manual freight (CC)",
    } as any);
    setAddSaving(false);
    if (error) { alert("Save failed: " + error.message); return; }
    setShowAdd(false); setAddPo(""); setAddAmt(""); loadAll();
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const all: Staged[] = []; const seen = new Set<string>();
    for (const f of Array.from(files)) {
      const text = await f.text();
      const matched = matchShipments(aggregateShipments(parseUpsCsv(text, invoiceFromName(f.name))), jobs);
      for (const m of matched) {
        const k = `${m.invoiceNumber}::${m.tracking}`;
        if (seen.has(k)) continue; seen.add(k);
        all.push({ invoiceNumber: m.invoiceNumber, tracking: m.tracking, cost: m.cost, ref: m.ref, sender: m.sender, date: m.date, sections: m.sections, job: m.job as JobFull | null, dupe: importedKeys.has(k) });
      }
    }
    setStaged(all);
  }

  const fresh = staged.filter(s => !s.dupe);
  const matchedCount = fresh.filter(s => s.job).length;
  const needCount = fresh.length - matchedCount;
  const dupeCount = staged.length - fresh.length;

  async function doImport() {
    const rows = fresh.map(s => ({
      source: "ups_inbound", charge_type: "freight", status: s.job ? "matched" : "unmatched",
      job_id: s.job?.id ?? null, vendor_name: s.sender || "UPS", vendor_invoice_number: s.invoiceNumber,
      po_ref: s.ref || null, ext_tracking: s.tracking, ext_date: s.date || null, amount: s.cost,
      not_job_specific: false, notes: `UPS inbound${s.sections.length ? " · " + s.sections.join("/") : ""}`,
    }));
    if (!rows.length) return;
    setImporting(true);
    const { error } = await supabase.from("cost_entries").insert(rows as any);
    setImporting(false);
    if (error) { alert("Import failed: " + error.message); return; }
    setStaged([]); loadAll();
  }

  // ── reconcile the queue ──
  async function assignEntry(id: string, jobId: string) {
    await supabase.from("cost_entries").update({ job_id: jobId, status: "matched" } as any).eq("id", id);
    setQSearch(p => { const n = { ...p }; delete n[id]; return n; });
    loadAll();
  }
  async function ignoreEntry(id: string) {
    await supabase.from("cost_entries").update({ not_job_specific: true } as any).eq("id", id);
    loadAll();
  }
  async function removeManual(id: string) {
    await supabase.from("cost_entries").delete().eq("id", id);
    loadAll();
  }
  const toggleSel = (id: string) => setSelQ(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function ignoreSelected() {
    if (!selQ.size) return;
    await supabase.from("cost_entries").update({ not_job_specific: true } as any).in("id", [...selQ]);
    setSelQ(new Set()); loadAll();
  }
  const manualEntries = useMemo(() => existing.filter(e => e.source === "manual_freight").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), [existing]);
  function suggestions(sender: string | null, ref: string | null): JobFull[] {
    const digits = (String(ref || "").match(/\d{3,4}/) || [])[0];
    const sn = (sender || "").toLowerCase().split(" ")[0];
    return jobs.filter(j => (digits && (j.qb_invoice_number || "").includes(digits)) || (sn && (j.client_name || "").toLowerCase().includes(sn))).slice(0, 4);
  }
  function jobMatches(q: string): JobFull[] {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return jobs.filter(j => `${j.job_number || ""} ${j.client_name || ""} ${j.qb_invoice_number || ""}`.toLowerCase().includes(s)).slice(0, 6);
  }

  const queue = existing.filter(e => !e.job_id && !e.not_job_specific);
  const queueTotal = queue.reduce((a, e) => a + Number(e.amount || 0), 0);

  // ── per-job ledger (assigned only) ──
  const perJob = useMemo(() => {
    const m: Record<string, { actual: number; n: number }> = {};
    for (const e of existing) { if (!e.job_id) continue; (m[e.job_id] ??= { actual: 0, n: 0 }); m[e.job_id].actual += Number(e.amount || 0); m[e.job_id].n++; }
    return Object.entries(m).map(([id, v]) => {
      const job = jobById[id]; const calc = job ? calculatedShipping(job.costing_data) : 0;
      return { id, job, n: v.n, actual: Math.round(v.actual * 100) / 100, calc, variance: Math.round((v.actual - calc) * 100) / 100 };
    }).sort((a, b) => b.actual - a.actual);
  }, [existing, jobById]);
  const totalActual = perJob.reduce((a, r) => a + r.actual, 0);
  const totalCalc = perJob.filter(r => r.job).reduce((a, r) => a + r.calc, 0);

  // import history — grouped by UPS invoice #
  const importHistory = useMemo(() => {
    const m: Record<string, { invoice: string; imported: string; n: number; total: number; matched: number; unmatched: number }> = {};
    for (const e of existing) {
      if (e.source !== "ups_inbound") continue; // import history = UPS CSV uploads only
      const inv = e.vendor_invoice_number || "(no invoice #)";
      const g = (m[inv] ??= { invoice: inv, imported: e.created_at, n: 0, total: 0, matched: 0, unmatched: 0 });
      g.n++; g.total += Number(e.amount || 0);
      if (e.created_at && e.created_at < g.imported) g.imported = e.created_at;
      if (e.job_id) g.matched++; else if (!e.not_job_specific) g.unmatched++;
    }
    return Object.values(m).sort((a, b) => (b.imported || "").localeCompare(a.imported || ""));
  }, [existing]);

  return (
    <div>
      {/* Add freight cost (manual / LTL) — PO resolves the job */}
      {showAdd && (
        <div onClick={() => !addSaving && setShowAdd(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, width: 420, maxWidth: "92vw", padding: "18px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", fontFamily: font }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 2 }}>Add freight cost</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>LTL / credit-card freight booked outside UPS. Type the PO — it resolves the job.</div>
            <div style={{ ...lbl, marginBottom: 4 }}>PO number</div>
            <input autoFocus value={addPo} onChange={e => setAddPo(e.target.value)} placeholder="e.g. 4305" style={{ width: "100%", padding: "8px 11px", border: `1px solid ${T.border}`, borderRadius: 7, background: T.card, color: T.text, fontSize: 14, fontFamily: mono, outline: "none", boxSizing: "border-box" }} />
            <div style={{ minHeight: 22, marginTop: 6, fontSize: 12.5 }}>
              {addPo.trim() ? (addResolved ? <span style={{ color: T.green, fontWeight: 700 }}>✓ {addResolved.job_number} · {addResolved.client_name}</span> : <span style={{ color: T.amber }}>no job matched — saves to the Needs-a-match queue</span>) : null}
            </div>
            <div style={{ ...lbl, margin: "10px 0 4px" }}>Amount</div>
            <input value={addAmt} onChange={e => setAddAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && saveManual()} inputMode="decimal" placeholder="0.00" style={{ width: "100%", padding: "8px 11px", border: `1px solid ${T.border}`, borderRadius: 7, background: T.card, color: T.text, fontSize: 14, fontFamily: mono, outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
              <button onClick={saveManual} disabled={addSaving || !(parseFloat(addAmt.replace(/[$,]/g, "")) > 0)} style={{ background: parseFloat(addAmt.replace(/[$,]/g, "")) > 0 ? T.green : T.surface, color: parseFloat(addAmt.replace(/[$,]/g, "")) > 0 ? "#fff" : T.faint, border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: parseFloat(addAmt.replace(/[$,]/g, "")) > 0 ? "pointer" : "default", fontFamily: font }}>{addSaving ? "Saving…" : "Add freight cost"}</button>
              <button onClick={() => setShowAdd(false)} disabled={addSaving} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Upload */}
      <div style={{ border: `1px dashed ${T.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 18, background: T.surface, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Freight costs — UPS invoice upload + manual LTL/CC</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>UPS: 32-col Detail (preferred) or 10-col Summary; re-uploading is safe. Or "+ Add freight cost" to key in an LTL/CC charge by PO.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAdd(true)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, borderRadius: 7, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>+ Add freight cost</button>
          <label style={{ background: T.accent, color: "#fff", borderRadius: 7, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>
            Choose CSV(s)<input type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      {/* Review (read-only preview → Import all) */}
      {staged.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 24, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>Review — {fresh.length} new</span>
            <span style={{ fontSize: 11.5, color: T.green, fontWeight: 700 }}>{matchedCount} matched → jobs</span>
            {needCount > 0 && <span style={{ fontSize: 11.5, color: T.amber, fontWeight: 700 }}>{needCount} → Needs-a-match queue</span>}
            {dupeCount > 0 && <span style={{ fontSize: 11.5, color: T.faint }}>{dupeCount} already imported</span>}
            <span style={{ fontSize: 11.5, color: T.muted, fontFamily: mono }}>{money(fresh.reduce((a, s) => a + s.cost, 0))}</span>
            <button onClick={doImport} disabled={importing || !fresh.length} style={{ marginLeft: "auto", background: fresh.length ? T.green : T.surface, color: fresh.length ? "#fff" : T.faint, border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12.5, fontWeight: 700, cursor: fresh.length ? "pointer" : "default", fontFamily: font }}>{importing ? "Importing…" : `Import ${fresh.length}`}</button>
            <button onClick={() => setStaged([])} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Clear</button>
          </div>
          <div style={{ display: "flex", gap: 12, padding: "7px 16px", ...lbl, borderBottom: `1px solid ${T.border}55` }}>
            <span style={{ width: 150 }}>Tracking</span><span style={{ width: 78 }}>Date</span><span style={{ width: 190 }}>Sender</span>
            <span style={{ width: 90, textAlign: "right" }}>Cost</span><span style={{ width: 90 }}>Ref</span><span style={{ flex: 1 }}>Match</span>
          </div>
          <div style={{ maxHeight: 440, overflowY: "auto" }}>
            {staged.map((s, i) => (
              <div key={`${s.invoiceNumber}::${s.tracking}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 16px", borderTop: i ? `1px solid ${T.border}22` : "none", fontSize: 12, opacity: s.dupe ? 0.4 : 1 }}>
                <span style={{ width: 150, fontFamily: mono, fontSize: 10.5, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.tracking}>{s.tracking}</span>
                <span style={{ width: 78, fontFamily: mono, fontSize: 11, color: T.muted }}>{s.date || "—"}</span>
                <span style={{ width: 190, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.sender}>{s.sender || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.text, textAlign: "right" }}>{money(s.cost)}</span>
                <span style={{ width: 90, fontFamily: mono, fontSize: 11, color: T.faint }}>{s.ref || "no ref"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {s.dupe ? <span style={{ color: T.faint, fontStyle: "italic" }}>already imported</span>
                    : s.job ? <span><span style={{ color: T.green, fontWeight: 700 }}>✓ {s.job.job_number}</span> <span style={{ color: T.muted }}>{s.job.client_name}</span></span>
                      : <span style={{ color: T.amber, fontWeight: 600 }}>→ needs a match</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs a match — the persistent reconciliation queue */}
      {queue.length > 0 && (
        <div style={{ border: `1px solid ${T.amber}66`, borderRadius: 12, marginBottom: 24, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: T.amberDim, borderBottom: `1px solid ${T.amber}44` }}>
            <input type="checkbox" title="Select all" checked={selQ.size > 0 && selQ.size === queue.length} ref={el => { if (el) el.indeterminate = selQ.size > 0 && selQ.size < queue.length; }} onChange={e => setSelQ(e.target.checked ? new Set(queue.map(q => q.id)) : new Set())} style={{ cursor: "pointer", width: 15, height: 15 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>Needs a match — {queue.length}</span>
            <span style={{ fontSize: 11.5, color: T.muted, fontFamily: mono }}>{money(queueTotal)} unassigned</span>
            {selQ.size > 0
              ? <button onClick={ignoreSelected} style={{ marginLeft: "auto", background: T.faint, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Ignore {selQ.size} selected</button>
              : <span style={{ fontSize: 11, color: T.muted, marginLeft: "auto" }}>assign each to a job, or ignore (non-job charges)</span>}
          </div>
          {queue.map(e => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderTop: `1px solid ${T.border}22`, fontSize: 12 }}>
              <input type="checkbox" checked={selQ.has(e.id)} onChange={() => toggleSel(e.id)} style={{ cursor: "pointer", width: 14, height: 14, flexShrink: 0 }} />
              <span style={{ width: 140, fontFamily: mono, fontSize: 10.5, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={e.ext_tracking || ""}>{e.ext_tracking}</span>
              <span style={{ width: 78, fontFamily: mono, fontSize: 11, color: T.muted }}>{e.ext_date || "—"}</span>
              <span style={{ width: 180, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={e.vendor_name || ""}>{e.vendor_name || "—"}</span>
              <span style={{ width: 90, fontFamily: mono, color: T.text, textAlign: "right" }}>{money(Number(e.amount || 0))}</span>
              <span style={{ width: 80, fontFamily: mono, fontSize: 11, color: T.faint }}>{e.po_ref || "no ref"}</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {suggestions(e.vendor_name, e.po_ref).map(j => (
                  <button key={j.id} onClick={() => assignEntry(e.id, j.id)} style={{ background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}55`, borderRadius: 5, padding: "3px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{j.job_number} · {j.client_name}</button>
                ))}
                <div style={{ position: "relative" }}>
                  <input value={qSearch[e.id] || ""} onChange={ev => setQSearch(p => ({ ...p, [e.id]: ev.target.value }))} placeholder="search job…" style={{ padding: "4px 8px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.card, color: T.text, fontSize: 11.5, fontFamily: font, outline: "none", width: 150 }} />
                  {(qSearch[e.id] || "").trim() && (
                    <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, minWidth: 230, maxHeight: 200, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
                      {jobMatches(qSearch[e.id]).map(j => <div key={j.id} onClick={() => assignEntry(e.id, j.id)} style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", color: T.text }}>{j.job_number} · {j.client_name} {j.qb_invoice_number ? `· inv ${j.qb_invoice_number}` : ""}</div>)}
                      {jobMatches(qSearch[e.id]).length === 0 && <div style={{ padding: "6px 10px", fontSize: 11.5, color: T.faint }}>no match</div>}
                    </div>
                  )}
                </div>
                <button onClick={() => ignoreEntry(e.id)} style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, cursor: "pointer", textDecoration: "underline" }}>ignore</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-job ledger */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, color: T.text, margin: 0 }}>Freight by job</h2>
        {!billingOnly && perJob.length > 0 && (
          <span style={{ fontSize: 12, color: T.muted }}>actual <strong style={{ fontFamily: mono, color: T.text }}>{money(totalActual)}</strong> vs calculated <strong style={{ fontFamily: mono, color: T.text }}>{money(totalCalc)}</strong> · <strong style={{ fontFamily: mono, color: totalActual - totalCalc > 0 ? T.red : T.green }}>{totalActual - totalCalc >= 0 ? "+" : ""}{money(totalActual - totalCalc)}</strong> variance</span>
        )}
      </div>
      {loading ? <div style={{ color: T.muted, fontSize: 12, padding: 12 }}>Loading…</div>
        : perJob.length === 0 ? <div style={{ color: T.muted, fontSize: 12, padding: 12 }}>No freight assigned to jobs yet.</div>
          : (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 14px", background: T.surface, ...lbl }}>
                <span style={{ flex: 1 }}>Job</span><span style={{ width: 60, textAlign: "right" }}>Shp</span><span style={{ width: 110, textAlign: "right" }}>Actual</span>
                {!billingOnly && <><span style={{ width: 110, textAlign: "right" }}>Calculated</span><span style={{ width: 110, textAlign: "right" }}>Variance</span></>}
              </div>
              {perJob.map(r => (
                <div key={r.id} style={{ display: "flex", gap: 12, padding: "9px 14px", borderTop: `1px solid ${T.border}22`, fontSize: 12.5, alignItems: "center" }}>
                  <span style={{ flex: 1, color: T.text, fontWeight: 600 }}>{r.job ? `${r.job.job_number} · ${r.job.client_name}` : "(job not found)"}</span>
                  <span style={{ width: 60, textAlign: "right", fontFamily: mono, color: T.faint }}>{r.n}</span>
                  <span style={{ width: 110, textAlign: "right", fontFamily: mono, color: T.text }}>{money(r.actual)}</span>
                  {!billingOnly && <><span style={{ width: 110, textAlign: "right", fontFamily: mono, color: T.muted }}>{money(r.calc)}</span>
                    <span style={{ width: 110, textAlign: "right", fontFamily: mono, fontWeight: 700, color: r.variance > 20 ? T.red : r.variance < -20 ? T.amber : T.green }}>{r.variance >= 0 ? "+" : ""}{money(r.variance)}</span></>}
                </div>
              ))}
            </div>
          )}

      {/* Manual freight entries — keyed-in LTL/CC charges */}
      {manualEntries.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setShowManual(s => !s)} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: font, padding: 0 }}>{showManual ? "▾" : "▸"} Manual freight entries ({manualEntries.length})</button>
          {showManual && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 14px", background: T.surface, ...lbl }}>
                <span style={{ width: 100 }}>Date</span><span style={{ width: 90 }}>PO</span><span style={{ flex: 1 }}>Job</span><span style={{ width: 100, textAlign: "right" }}>Amount</span><span style={{ width: 40 }} />
              </div>
              {manualEntries.map(e => {
                const job = e.job_id ? jobById[e.job_id] : null;
                return (
                  <div key={e.id} style={{ display: "flex", gap: 12, padding: "9px 14px", borderTop: `1px solid ${T.border}22`, fontSize: 12.5, alignItems: "center" }}>
                    <span style={{ width: 100, fontSize: 11.5, color: T.muted }}>{e.ext_date || (e.created_at ? new Date(e.created_at).toLocaleDateString() : "—")}</span>
                    <span style={{ width: 90, fontFamily: mono, fontSize: 11, color: T.faint }}>{e.po_ref || "—"}</span>
                    <span style={{ flex: 1, color: job ? T.text : T.amber, fontWeight: 600 }}>{job ? `${job.job_number} · ${job.client_name}` : "⚠ Unassigned"}</span>
                    <span style={{ width: 100, textAlign: "right", fontFamily: mono, color: T.text }}>{money(Number(e.amount || 0))}</span>
                    <span style={{ width: 40, textAlign: "right" }}><button onClick={() => removeManual(e.id)} title="Remove" style={{ background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer", padding: "2px 6px" }}>×</button></span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Import history — what's been processed, grouped by UPS invoice # */}
      {importHistory.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setShowHistory(s => !s)} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: font, padding: 0 }}>{showHistory ? "▾" : "▸"} Import history ({importHistory.length} invoice{importHistory.length !== 1 ? "s" : ""})</button>
          {showHistory && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 14px", background: T.surface, ...lbl }}>
                <span style={{ flex: 1 }}>UPS Invoice</span><span style={{ width: 110 }}>Imported</span><span style={{ width: 70, textAlign: "right" }}>Shp</span><span style={{ width: 110, textAlign: "right" }}>Total</span><span style={{ width: 160, textAlign: "right" }}>Matched / Queue</span>
              </div>
              {importHistory.map(h => (
                <div key={h.invoice} style={{ display: "flex", gap: 12, padding: "9px 14px", borderTop: `1px solid ${T.border}22`, fontSize: 12.5, alignItems: "center" }}>
                  <span style={{ flex: 1, fontFamily: mono, color: T.text }}>{h.invoice}</span>
                  <span style={{ width: 110, fontSize: 11.5, color: T.muted }}>{h.imported ? new Date(h.imported).toLocaleDateString() : "—"}</span>
                  <span style={{ width: 70, textAlign: "right", fontFamily: mono, color: T.faint }}>{h.n}</span>
                  <span style={{ width: 110, textAlign: "right", fontFamily: mono, color: T.text }}>{money(h.total)}</span>
                  <span style={{ width: 160, textAlign: "right", fontSize: 11.5, fontFamily: mono }}>
                    <span style={{ color: T.green }}>{h.matched} matched</span>{h.unmatched > 0 && <span style={{ color: T.amber }}> · {h.unmatched} queue</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

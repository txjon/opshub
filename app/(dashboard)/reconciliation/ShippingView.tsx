"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { parseUpsCsv, aggregateShipments, matchShipments, calculatedShipping, type MatchedShipment } from "@/lib/ups-freight";
import type { JobLite } from "@/lib/po-ref-match";

// Inbound production freight (UPS) reconciliation. Upload UPS CSV(s) → match each
// shipment to a job by PO ref → review/assign → import as cost_entries
// (charge_type=freight, source=ups_inbound). Then per-job ACTUAL vs CALCULATED.
// Outbound (distro) is a separate UPS account / feed.

type JobFull = JobLite & { costing_data: any };
type FreightEntry = { id: string; job_id: string | null; amount: number; ext_tracking: string | null; vendor_invoice_number: string | null; vendor_name: string | null; po_ref: string | null };
// A staged shipment in the review step: a matched shipment + the user's assignment.
type Staged = MatchedShipment & { assignedJobId: string | null; dupe: boolean; ignore: boolean };

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Pull the UPS invoice id out of a 10-col filename ("…000000W28Y51176…"); 32-col
// carries it as a column so this is only a fallback.
const invoiceFromName = (name: string) => (name.match(/\d{5,}[A-Z][A-Z0-9]*\d+/i)?.[0]) || name.replace(/\.csv$/i, "");

export function ShippingView({ companyId, billingOnly = false }: { companyId: string; billingOnly?: boolean }) {
  const supabase = createClient();
  const [jobs, setJobs] = useState<JobFull[]>([]);
  const [existing, setExisting] = useState<FreightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [importing, setImporting] = useState(false);
  const [jobSearch, setJobSearch] = useState<Record<number, string>>({}); // per-row assign search text

  async function loadAll() {
    setLoading(true);
    const [{ data: js }, { data: es }] = await Promise.all([
      supabase.from("jobs").select("id, job_number, type_meta, costing_data, clients(name)").eq("company_id", companyId),
      supabase.from("cost_entries").select("id, job_id, amount, ext_tracking, vendor_invoice_number, vendor_name, po_ref").eq("source", "ups_inbound"),
    ]);
    setJobs(((js as any[]) || []).map(j => ({ id: j.id, job_number: j.job_number, qb_invoice_number: j.type_meta?.qb_invoice_number ?? null, client_name: (j.clients as any)?.name ?? null, costing_data: j.costing_data })));
    setExisting((es as any[]) || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, [companyId]); // eslint-disable-line

  const jobById = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs]);
  // already-imported keys (invoice#::tracking) for dedup
  const importedKeys = useMemo(() => new Set(existing.map(e => `${e.vendor_invoice_number || ""}::${e.ext_tracking || ""}`)), [existing]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const all: Staged[] = [];
    for (const f of Array.from(files)) {
      const text = await f.text();
      const charges = parseUpsCsv(text, invoiceFromName(f.name));
      const matched = matchShipments(aggregateShipments(charges), jobs);
      for (const m of matched) {
        all.push({ ...m, assignedJobId: m.job?.id || null, dupe: importedKeys.has(`${m.invoiceNumber}::${m.tracking}`), ignore: false });
      }
    }
    // keep new on top; de-dupe within the staged set too (same file twice)
    const seen = new Set<string>();
    setStaged(all.filter(s => { const k = `${s.invoiceNumber}::${s.tracking}`; if (seen.has(k)) return false; seen.add(k); return true; }));
  }

  const fresh = staged.filter(s => !s.dupe && !s.ignore);
  const matchedCount = fresh.filter(s => s.assignedJobId).length;
  const unassigned = fresh.filter(s => !s.assignedJobId);
  const dupeCount = staged.filter(s => s.dupe).length;
  const stagedTotal = fresh.reduce((a, s) => a + s.cost, 0);

  function setRow(i: number, patch: Partial<Staged>) { setStaged(p => p.map((s, j) => j === i ? { ...s, ...patch } : s)); }

  // ranked job suggestions for an unassigned row: sender→client/job name, ref digits
  function suggestions(s: Staged): JobFull[] {
    const out: JobFull[] = [];
    const sender = (s.sender || "").toLowerCase();
    const digits = (s.ref.match(/\d{3,4}/) || [])[0];
    for (const j of jobs) {
      const hay = `${j.job_number || ""} ${j.client_name || ""} ${j.qb_invoice_number || ""}`.toLowerCase();
      if (digits && (j.qb_invoice_number || "").includes(digits)) out.push(j);
      else if (sender && j.client_name && hay.includes(sender.split(" ")[0])) out.push(j);
    }
    return out.slice(0, 4);
  }
  function jobMatches(q: string): JobFull[] {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return jobs.filter(j => `${j.job_number || ""} ${j.client_name || ""} ${j.qb_invoice_number || ""}`.toLowerCase().includes(s)).slice(0, 6);
  }

  async function doImport() {
    const toInsert = fresh.map(s => ({
      source: "ups_inbound", charge_type: "freight", status: s.assignedJobId ? "matched" : "unassigned",
      job_id: s.assignedJobId, vendor_name: s.sender || "UPS", vendor_invoice_number: s.invoiceNumber,
      po_ref: s.ref || null, ext_tracking: s.tracking, amount: s.cost,
      not_job_specific: false, notes: `UPS inbound · ${s.matchMethod || "manual"}${s.sections.length ? " · " + s.sections.join("/") : ""}`,
    }));
    if (!toInsert.length) return;
    setImporting(true);
    const { error } = await supabase.from("cost_entries").insert(toInsert as any);
    setImporting(false);
    if (error) { alert("Import failed: " + error.message); return; }
    setStaged([]); loadAll();
  }

  // ── Per-job ledger (already imported) ──
  const perJob = useMemo(() => {
    const m: Record<string, { job: JobFull | null; actual: number; n: number }> = {};
    for (const e of existing) {
      const k = e.job_id || "__unassigned__";
      (m[k] ??= { job: e.job_id ? (jobById[e.job_id] || null) : null, actual: 0, n: 0 });
      m[k].actual += Number(e.amount || 0); m[k].n++;
    }
    return Object.entries(m).map(([k, v]) => {
      const calc = v.job ? calculatedShipping(v.job.costing_data) : 0;
      return { key: k, job: v.job, n: v.n, actual: Math.round(v.actual * 100) / 100, calc, variance: Math.round((v.actual - calc) * 100) / 100 };
    }).sort((a, b) => b.actual - a.actual);
  }, [existing, jobById]);
  const totalActual = perJob.reduce((a, r) => a + r.actual, 0);
  const totalCalc = perJob.filter(r => r.job).reduce((a, r) => a + r.calc, 0);
  const lbl = { fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.faint } as const;

  return (
    <div>
      {/* ── Upload ── */}
      <div style={{ border: `1px dashed ${T.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 18, background: T.surface }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Upload UPS invoice CSV(s) — inbound production freight</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>10-col Summary or 32-col Detail. Re-uploading is safe — already-imported charges are skipped.</div>
          </div>
          <label style={{ background: T.accent, color: "#fff", borderRadius: 7, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>
            Choose CSV(s)
            <input type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      {/* ── Review (staged) ── */}
      {staged.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 22, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>Review — {fresh.length} new shipment{fresh.length !== 1 ? "s" : ""}</span>
            <span style={{ fontSize: 11.5, color: T.green, fontWeight: 700 }}>{matchedCount} matched</span>
            {unassigned.length > 0 && <span style={{ fontSize: 11.5, color: T.amber, fontWeight: 700 }}>{unassigned.length} need a job</span>}
            {dupeCount > 0 && <span style={{ fontSize: 11.5, color: T.faint }}>{dupeCount} already imported (skipped)</span>}
            <span style={{ fontSize: 11.5, color: T.muted, fontFamily: mono }}>{money(stagedTotal)}</span>
            <button onClick={doImport} disabled={importing || !fresh.length} style={{ marginLeft: "auto", background: fresh.length ? T.green : T.surface, color: fresh.length ? "#fff" : T.faint, border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12.5, fontWeight: 700, cursor: fresh.length ? "pointer" : "default", fontFamily: font }}>
              {importing ? "Importing…" : `Import ${fresh.length}${unassigned.length ? ` (${unassigned.length} unassigned)` : ""}`}
            </button>
            <button onClick={() => setStaged([])} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Clear</button>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {staged.map((s, i) => {
              const job = s.assignedJobId ? jobById[s.assignedJobId] : null;
              return (
                <div key={`${s.invoiceNumber}::${s.tracking}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderTop: i ? `1px solid ${T.border}22` : "none", fontSize: 12, opacity: s.dupe || s.ignore ? 0.45 : 1 }}>
                  <span style={{ width: 130, fontFamily: mono, fontSize: 10.5, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.tracking}>{s.tracking}</span>
                  <span style={{ width: 96, fontFamily: mono, color: T.text, textAlign: "right" }}>{money(s.cost)}</span>
                  <span style={{ width: 130, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.sender}>{s.sender || "—"}</span>
                  <span style={{ width: 90, fontFamily: mono, fontSize: 11, color: T.faint }}>{s.ref || "no ref"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {s.dupe ? <span style={{ color: T.faint, fontStyle: "italic" }}>already imported</span>
                      : job ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: T.green, fontWeight: 700 }}>✓ {job.job_number}</span>
                          <span style={{ color: T.muted }}>{job.client_name}</span>
                          <button onClick={() => setRow(i, { assignedJobId: null })} style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, cursor: "pointer", textDecoration: "underline" }}>change</button>
                        </span>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {suggestions(s).map(j => (
                            <button key={j.id} onClick={() => setRow(i, { assignedJobId: j.id })} style={{ background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}55`, borderRadius: 5, padding: "3px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{j.job_number} · {j.client_name}</button>
                          ))}
                          <div style={{ position: "relative" }}>
                            <input value={jobSearch[i] || ""} onChange={e => setJobSearch(p => ({ ...p, [i]: e.target.value }))} placeholder="search job…" style={{ padding: "4px 8px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.card, color: T.text, fontSize: 11.5, fontFamily: font, outline: "none", width: 150 }} />
                            {(jobSearch[i] || "").trim() && (
                              <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, minWidth: 220, maxHeight: 200, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
                                {jobMatches(jobSearch[i]).map(j => (
                                  <div key={j.id} onClick={() => { setRow(i, { assignedJobId: j.id }); setJobSearch(p => ({ ...p, [i]: "" })); }} style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", color: T.text }}>{j.job_number} · {j.client_name} {j.qb_invoice_number ? `· inv ${j.qb_invoice_number}` : ""}</div>
                                ))}
                                {jobMatches(jobSearch[i]).length === 0 && <div style={{ padding: "6px 10px", fontSize: 11.5, color: T.faint }}>no match</div>}
                              </div>
                            )}
                          </div>
                          <button onClick={() => setRow(i, { ignore: true })} style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, cursor: "pointer", textDecoration: "underline" }}>ignore</button>
                        </div>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Per-job ledger: actual vs calculated ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, color: T.text, margin: 0 }}>Inbound freight by job</h2>
        {!billingOnly && (
          <span style={{ fontSize: 12, color: T.muted }}>
            actual <strong style={{ fontFamily: mono, color: T.text }}>{money(totalActual)}</strong> vs calculated <strong style={{ fontFamily: mono, color: T.text }}>{money(totalCalc)}</strong> ·
            <strong style={{ fontFamily: mono, color: totalActual - totalCalc > 0 ? T.red : T.green }}> {totalActual - totalCalc >= 0 ? "+" : ""}{money(totalActual - totalCalc)}</strong> variance
          </span>
        )}
      </div>
      {loading ? <div style={{ color: T.muted, fontSize: 12, padding: 12 }}>Loading…</div>
        : perJob.length === 0 ? <div style={{ color: T.muted, fontSize: 12, padding: 12 }}>No freight imported yet. Upload a UPS CSV above.</div>
          : (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 14px", background: T.surface, ...lbl }}>
                <span style={{ flex: 1 }}>Job</span><span style={{ width: 60, textAlign: "right" }}>Shp</span>
                <span style={{ width: 110, textAlign: "right" }}>Actual</span>
                {!billingOnly && <span style={{ width: 110, textAlign: "right" }}>Calculated</span>}
                {!billingOnly && <span style={{ width: 110, textAlign: "right" }}>Variance</span>}
              </div>
              {perJob.map(r => (
                <div key={r.key} style={{ display: "flex", gap: 12, padding: "9px 14px", borderTop: `1px solid ${T.border}22`, fontSize: 12.5, alignItems: "center" }}>
                  <span style={{ flex: 1, color: r.job ? T.text : T.amber, fontWeight: 600 }}>
                    {r.job ? `${r.job.job_number} · ${r.job.client_name}` : "⚠ Unassigned"}
                  </span>
                  <span style={{ width: 60, textAlign: "right", fontFamily: mono, color: T.faint }}>{r.n}</span>
                  <span style={{ width: 110, textAlign: "right", fontFamily: mono, color: T.text }}>{money(r.actual)}</span>
                  {!billingOnly && <span style={{ width: 110, textAlign: "right", fontFamily: mono, color: T.muted }}>{r.job ? money(r.calc) : "—"}</span>}
                  {!billingOnly && <span style={{ width: 110, textAlign: "right", fontFamily: mono, fontWeight: 700, color: !r.job ? T.faint : r.variance > 20 ? T.red : r.variance < -20 ? T.amber : T.green }}>{r.job ? `${r.variance >= 0 ? "+" : ""}${money(r.variance)}` : "—"}</span>}
                </div>
              ))}
            </div>
          )}
    </div>
  );
}

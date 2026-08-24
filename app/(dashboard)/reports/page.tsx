"use client";
import { useState, useEffect, useMemo } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { parseDay } from "@/lib/dates";
import { effectiveRevenue, effectiveCost, pnlJobs } from "@/lib/revenue";
import { ssRevCost, ssReportLabel, isInvoicedReport, ssShipments, RANGE_OPTIONS, resolveRange, inRange, type RangePreset } from "@/lib/analytics";

const fmtD = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const ratio = (rev: number, cost: number) => rev > 0 ? (rev - cost) / rev : 0;
const fmtPct = (r: number) => (r * 100).toFixed(1) + "%";
const marginColor = (r: number) => r >= 0.3 ? T.green : r >= 0.15 ? T.amber : T.red;
const fmtDate = (s: string | null | undefined) => s ? (s.includes("T") ? new Date(s) : (parseDay(s) as Date)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";
const jobUnits = (j: any) => (j.items || []).reduce((a: number, it: any) => a + (it.buy_sheet_lines || []).reduce((b: number, l: any) => b + (l.qty_ordered || 0), 0), 0);
// What the job was actually billed (tax-inclusive when QB has it, else
// pre-tax grossRev). Used to cap "paid" so duplicate/misallocated payment
// records (e.g. a lump QB payment stamped onto multiple jobs) can't inflate
// collected past the invoice. NOTE: the underlying duplicate data still needs
// cleanup — this only stops it from lying on the dashboard.
const billableOf = (j: any) => Number((j.type_meta || {}).qb_total_with_tax) || Number((j.costing_summary || {}).grossRev) || 0;
const cappedPaid = (j: any, inWindowOnly: (p: any) => boolean) => {
  const sum = (j.payment_records || []).filter((p: any) => p.status === "paid" && inWindowOnly(p)).reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const bill = billableOf(j);
  return bill > 0 ? Math.min(sum, bill) : sum;
};

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ReportKey = "client" | "month" | "project" | "payments" | "shipping";
const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "client", label: "By Client" },
  { key: "month", label: "By Month" },
  { key: "project", label: "By Project" },
  { key: "payments", label: "Payments" },
  { key: "shipping", label: "Shipping & Fulfillment" },
];

export default function ReportsPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [jobs, setJobs] = useState<any[]>([]);
  const [ssReports, setSsReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [report, setReport] = useState<ReportKey>("client");
  const [preset, setPreset] = useState<RangePreset>("ytd");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("jobs")
        .select("id, title, phase, job_type, job_number, priority, created_at, is_inventory, is_test, target_ship_date, clients(name), costing_summary, type_meta, items(id, buy_sheet_lines(qty_ordered)), payment_records(amount, status, type, due_date, paid_date, created_at, invoice_number)")
        .order("created_at", { ascending: false }),
      supabase.from("shipstation_reports")
        .select("id, client_id, report_type, postage_mode, period_label, totals, postage_totals, qb_invoice_number, qb_total_with_tax, paid_at, paid_amount, sent_at, created_at, clients(name)")
        .order("created_at", { ascending: false }),
    ]).then(([jRes, sRes]) => {
      setJobs(pnlJobs(jRes.data || [])); // one policy: cancelled + test + inventory jobs never count as revenue
      setSsReports(sRes.data || []);
      setLoading(false);
    });
  }, []);

  const range = useMemo(() => resolveRange(preset, customStart, customEnd), [preset, customStart, customEnd]);
  // pnlJobs() drops bulk inventory/stock-buy jobs — their cost rides the jobs
  // that sell the stock, so they never count toward revenue/cost/margin here.
  const rJobs = useMemo(() => pnlJobs(jobs).filter(j => inRange(j.created_at, range.start, range.end)), [jobs, range]);
  const rSs = useMemo(() => ssReports.filter(r => isInvoicedReport(r) && inRange(r.created_at, range.start, range.end)), [ssReports, range]);

  // KPI strip — revenue/cost booked in range (jobs + ShipStation), plus cash
  // collected in range (payments paid in-window + ShipStation paid in-window).
  const kpi = useMemo(() => {
    let rev = 0, cost = 0, units = 0;
    for (const j of rJobs) { rev += effectiveRevenue(j); cost += effectiveCost(j); units += jobUnits(j); }
    for (const r of rSs) { const x = ssRevCost(r); rev += x.revenue; cost += x.cost; }
    let collected = 0;
    for (const j of jobs) collected += cappedPaid(j, (p) => inRange(p.paid_date || p.created_at, range.start, range.end));
    for (const r of ssReports) if (r.paid_at && inRange(r.paid_at, range.start, range.end)) collected += (Number(r.paid_amount) || ssRevCost(r).revenue);
    return { rev, cost, units, collected, margin: ratio(rev, cost) };
  }, [rJobs, rSs, jobs, ssReports, range]);

  const byClient = useMemo(() => {
    const m: Record<string, any> = {};
    const get = (n: string) => (m[n] ||= { name: n, rev: 0, cost: 0, units: 0, jobs: 0, ssRev: 0, paid: 0 });
    for (const j of rJobs) { const g = get(j.clients?.name || "Unknown"); g.rev += effectiveRevenue(j); g.cost += effectiveCost(j); g.units += jobUnits(j); g.jobs++; g.paid += cappedPaid(j, () => true); }
    for (const r of rSs) { const g = get(r.clients?.name || "Unknown"); const x = ssRevCost(r); g.rev += x.revenue; g.cost += x.cost; g.ssRev += x.revenue; if (r.paid_at) g.paid += Number(r.paid_amount) || x.revenue; }
    return Object.values(m).sort((a: any, b: any) => b.rev - a.rev);
  }, [rJobs, rSs]);

  const byMonth = useMemo(() => {
    const m: Record<string, any> = {};
    const add = (dateStr: string, rev: number, cost: number, units: number) => {
      const d = new Date(dateStr);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      (m[key] ||= { key, label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), rev: 0, cost: 0, units: 0 });
      m[key].rev += rev; m[key].cost += cost; m[key].units += units;
    };
    for (const j of rJobs) add(j.created_at, effectiveRevenue(j), effectiveCost(j), jobUnits(j));
    for (const r of rSs) { const x = ssRevCost(r); add(r.created_at, x.revenue, x.cost, 0); }
    return Object.values(m).sort((a: any, b: any) => a.key.localeCompare(b.key));
  }, [rJobs, rSs]);

  const byProject = useMemo(() => rJobs
    .filter(j => effectiveRevenue(j) > 0)
    .map(j => ({ id: j.id, title: j.title, client: j.clients?.name || "", rev: effectiveRevenue(j), cost: effectiveCost(j), phase: j.phase }))
    .sort((a, b) => b.rev - a.rev), [rJobs]);

  const paymentRows = useMemo(() => {
    const rows: any[] = [];
    for (const j of jobs) for (const p of (j.payment_records || [])) {
      const dt = p.paid_date || p.due_date || p.created_at;
      if (inRange(dt, range.start, range.end)) rows.push({ client: j.clients?.name || "", project: j.title, type: p.type || "—", amount: p.amount || 0, status: p.status, due: p.due_date, paid: p.paid_date, jobId: j.id, reportId: null });
    }
    for (const r of ssReports) if (isInvoicedReport(r)) {
      const dt = r.paid_at || r.created_at;
      if (inRange(dt, range.start, range.end)) rows.push({ client: r.clients?.name || "", project: `${ssReportLabel(r.report_type)} · ${r.period_label || ""}`, type: "fulfillment", amount: Number(r.qb_total_with_tax) || ssRevCost(r).revenue, status: r.paid_at ? "paid" : "sent", due: null, paid: r.paid_at, jobId: null, reportId: r.id });
    }
    return rows.sort((a, b) => new Date(b.paid || b.due || 0).getTime() - new Date(a.paid || a.due || 0).getTime());
  }, [jobs, ssReports, range]);

  const shippingRows = useMemo(() => rSs.map(r => {
    const x = ssRevCost(r);
    return { reportId: r.id, client: r.clients?.name || "", period: r.period_label || "—", type: ssReportLabel(r.report_type), shipments: ssShipments(r), rev: x.revenue, cost: x.cost, profit: x.revenue - x.cost, margin: ratio(x.revenue, x.cost), paid: !!r.paid_at };
  }).sort((a, b) => b.rev - a.rev), [rSs]);

  function exportActive() {
    const tag = range.label.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    if (report === "client") downloadCsv(`reports-by-client-${tag}.csv`, byClient.map((c: any) => ({ client: c.name, revenue: c.rev.toFixed(2), cost: c.cost.toFixed(2), profit: (c.rev - c.cost).toFixed(2), margin_pct: (ratio(c.rev, c.cost) * 100).toFixed(2), units: c.units, projects: c.jobs, fulfillment_rev: c.ssRev.toFixed(2), paid: c.paid.toFixed(2) })));
    else if (report === "month") downloadCsv(`reports-by-month-${tag}.csv`, byMonth.map((mo: any) => ({ month: mo.label, revenue: mo.rev.toFixed(2), cost: mo.cost.toFixed(2), profit: (mo.rev - mo.cost).toFixed(2), margin_pct: (ratio(mo.rev, mo.cost) * 100).toFixed(2), units: mo.units })));
    else if (report === "project") downloadCsv(`reports-by-project-${tag}.csv`, byProject.map(p => ({ project: p.title, client: p.client, revenue: p.rev.toFixed(2), cost: p.cost.toFixed(2), margin_pct: (ratio(p.rev, p.cost) * 100).toFixed(2), phase: p.phase })));
    else if (report === "payments") downloadCsv(`reports-payments-${tag}.csv`, paymentRows.map(p => ({ client: p.client, project: p.project, type: p.type, amount: Number(p.amount).toFixed(2), status: p.status, due: p.due || "", paid: p.paid || "" })));
    else downloadCsv(`reports-shipping-${tag}.csv`, shippingRows.map(s => ({ client: s.client, period: s.period, type: s.type, shipments: s.shipments, revenue: s.rev.toFixed(2), cost: s.cost.toFixed(2), profit: s.profit.toFixed(2), margin_pct: (s.margin * 100).toFixed(2), paid: s.paid ? "yes" : "no" })));
  }

  const maxMonth = Math.max(...byMonth.map((m: any) => m.rev), 1);

  // ── styles ──
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 2px rgba(16,18,32,0.05)" };
  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "11px 12px", fontSize: 12.5, borderBottom: `1px solid ${T.surface}`, whiteSpace: "nowrap" };
  const chip = (activec: boolean): React.CSSProperties => ({ padding: "6px 13px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: `1px solid ${activec ? T.accent : T.border}`, background: activec ? T.accent : T.card, color: activec ? "#0a0a0a" : T.muted, cursor: "pointer", fontFamily: font });
  const selStyle: React.CSSProperties = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading reports…</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1320, margin: "0 auto", paddingBottom: 60 }}>
      {/* Header + date range */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Reports</h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{range.label} · {rJobs.length} project{rJobs.length !== 1 ? "s" : ""}{rSs.length ? ` · ${rSs.length} fulfillment invoice${rSs.length !== 1 ? "s" : ""}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={preset} onChange={e => setPreset(e.target.value as RangePreset)} style={selStyle}>
            {RANGE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={selStyle} />
              <span style={{ color: T.faint, fontSize: 12 }}>→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={selStyle} />
            </>
          )}
          <button onClick={exportActive} style={{ ...selStyle, background: T.surface, color: T.muted, fontWeight: 600 }}>Export CSV</button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: 10 }}>
        {[
          { label: "Revenue (booked)", value: fmtD(kpi.rev), color: T.text },
          { label: "Cost", value: fmtD(kpi.cost), color: T.muted },
          { label: "Profit", value: fmtD(kpi.rev - kpi.cost), color: T.green },
          { label: "Margin", value: fmtPct(kpi.margin), color: marginColor(kpi.margin) },
          { label: "Collected (incl. tax)", value: fmtD(kpi.collected), color: T.green },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 9.5, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 7 }}>{s.label}</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: s.color, fontFamily: mono, letterSpacing: "-0.02em" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Report selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {REPORTS.map(r => <button key={r.key} onClick={() => setReport(r.key)} style={chip(report === r.key)}>{r.label}</button>)}
      </div>

      {/* Active report */}
      <div style={card}>
        {report === "client" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>
                <th style={th}>Client</th>
                <th style={{ ...th, textAlign: "right" }}>Revenue</th>
                <th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>Margin</th>
                <th style={{ ...th, textAlign: "right" }}>Units</th>
                <th style={{ ...th, textAlign: "right" }}>Projects</th>
                <th style={{ ...th, textAlign: "right" }}>Fulfillment</th>
                <th style={{ ...th, textAlign: "right" }}>Paid</th>
              </tr></thead>
              <tbody>
                {byClient.map((c: any) => (
                  <tr key={c.name}>
                    <td style={{ ...td, fontWeight: 700 }}>{c.name}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{fmtD(c.rev)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.muted }}>{fmtD(c.cost)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 700, color: marginColor(ratio(c.rev, c.cost)) }}>{fmtPct(ratio(c.rev, c.cost))}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{c.units.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.muted }}>{c.jobs}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: c.ssRev > 0 ? T.text : T.faint }}>{c.ssRev > 0 ? fmtD(c.ssRev) : "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.green }}>{fmtD(c.paid)}</td>
                  </tr>
                ))}
                {byClient.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: T.muted, padding: 28 }}>No revenue in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {report === "month" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {byMonth.map((mo: any) => {
              const mg = ratio(mo.rev, mo.cost);
              return (
                <div key={mo.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 58, fontSize: 11.5, color: T.muted, flexShrink: 0, fontFamily: mono }}>{mo.label}</span>
                  <div style={{ flex: 1, height: 22, background: T.surface, borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <div style={{ height: "100%", width: (mo.rev / maxMonth * 100) + "%", background: T.accent, borderRadius: 5, transition: "width 0.4s" }} />
                    <span style={{ position: "absolute", right: 8, top: 3, fontSize: 11, fontFamily: mono, color: T.text, fontWeight: 700 }}>{fmtD(mo.rev)}</span>
                  </div>
                  <span style={{ width: 100, fontSize: 11, fontFamily: mono, color: T.muted, textAlign: "right", flexShrink: 0 }}>{mo.units.toLocaleString()}u · <span style={{ color: marginColor(mg) }}>{fmtPct(mg)}</span></span>
                </div>
              );
            })}
            {byMonth.length === 0 && <div style={{ textAlign: "center", color: T.muted, padding: 28, fontSize: 13 }}>No revenue in this period.</div>}
          </div>
        )}

        {report === "project" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead><tr>
                <th style={th}>Project</th><th style={th}>Client</th>
                <th style={{ ...th, textAlign: "right" }}>Revenue</th><th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>Margin</th><th style={th}>Phase</th>
              </tr></thead>
              <tbody>
                {byProject.map(p => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 700 }}><a href={`/jobs/${p.id}`} style={{ color: T.text, textDecoration: "none" }}>{p.title}</a></td>
                    <td style={{ ...td, color: T.muted }}>{p.client}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{fmtD(p.rev)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.muted }}>{fmtD(p.cost)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 700, color: marginColor(ratio(p.rev, p.cost)) }}>{fmtPct(ratio(p.rev, p.cost))}</td>
                    <td style={{ ...td, color: T.muted, textTransform: "capitalize" }}>{p.phase.replace(/_/g, " ")}</td>
                  </tr>
                ))}
                {byProject.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: T.muted, padding: 28 }}>No projects with revenue in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {report === "payments" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>Client</th><th style={th}>Project</th><th style={th}>Type</th>
                <th style={{ ...th, textAlign: "right" }}>Amount</th><th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Due</th><th style={{ ...th, textAlign: "right" }}>Paid</th>
              </tr></thead>
              <tbody>
                {paymentRows.map((p, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 700 }}>{p.client}</td>
                    <td style={{ ...td, color: T.muted }}>{p.reportId ? <a href={`/invoices/fulfillment/${p.reportId}`} style={{ color: T.muted, textDecoration: "none" }}>{p.project}</a> : <a href={`/jobs/${p.jobId}`} style={{ color: T.muted, textDecoration: "none" }}>{p.project}</a>}</td>
                    <td style={{ ...td, color: T.muted, textTransform: "capitalize" }}>{String(p.type).replace(/_/g, " ")}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{fmtD(p.amount)}</td>
                    <td style={{ ...td, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: p.status === "paid" ? T.green : p.status === "overdue" ? T.red : T.amber }}>{p.status}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.muted }}>{fmtDate(p.due)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: p.paid ? T.green : T.faint }}>{fmtDate(p.paid)}</td>
                  </tr>
                ))}
                {paymentRows.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: T.muted, padding: 28 }}>No payments in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {report === "shipping" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>Client</th><th style={th}>Period</th><th style={th}>Type</th>
                <th style={{ ...th, textAlign: "right" }}>Shipments</th>
                <th style={{ ...th, textAlign: "right" }}>Revenue</th><th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>Profit</th><th style={{ ...th, textAlign: "right" }}>Margin</th><th style={th}>Paid</th>
              </tr></thead>
              <tbody>
                {shippingRows.map(s => (
                  <tr key={s.reportId}>
                    <td style={{ ...td, fontWeight: 700 }}>{s.client}</td>
                    <td style={{ ...td, color: T.muted }}><a href={`/invoices/fulfillment/${s.reportId}`} style={{ color: T.muted, textDecoration: "none" }}>{s.period}</a></td>
                    <td style={{ ...td, color: T.muted }}>{s.type}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{s.shipments ? s.shipments.toLocaleString() : "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{fmtD(s.rev)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.muted }}>{fmtD(s.cost)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.green }}>{fmtD(s.profit)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 700, color: marginColor(s.margin) }}>{fmtPct(s.margin)}</td>
                    <td style={{ ...td, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: s.paid ? T.green : T.amber }}>{s.paid ? "paid" : "sent"}</td>
                  </tr>
                ))}
                {shippingRows.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: T.muted, padding: 28 }}>No fulfillment invoices in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, lineHeight: 1.6 }}>
        Revenue = effectiveRevenue (costing_summary.grossRev, QB fallback) for jobs + billed amount for ShipStation invoices · cost = effectiveCost + carrier postage · filtered by record date within {range.label}. Revenue is pre-tax; Collected is tax-inclusive cash received, so it can run above Revenue by sales tax. Bulk inventory purchases are excluded.
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useIsMobile } from "@/lib/useIsMobile";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { effectiveRevenue, effectiveCost } from "@/lib/revenue";

const fmtD = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtPct = (n: number) => n.toFixed(1) + "%";

type Job = {
  id: string; title: string; phase: string; job_type: string;
  created_at: string; target_ship_date: string | null;
  payment_terms: string | null;
  clients: { name: string } | null;
  costing_summary: any;
  phase_timestamps: Record<string, string> | null;
  items: { id: string; buy_sheet_lines: { qty_ordered: number }[] }[];
  payment_records: { amount: number; status: string }[];
};

function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type ShipstationReport = {
  id: string;
  client_id: string;
  period_label: string;
  created_at: string;
  totals: { qty: number; sales: number; profit: number } | null;
  clients: { name: string } | null;
};

export default function ReportsPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [shipReports, setShipReports] = useState<ShipstationReport[]>([]);

  useEffect(() => {
    supabase.from("jobs")
      .select("*, clients(name), costing_summary, type_meta, phase_timestamps, items(id, buy_sheet_lines(qty_ordered)), payment_records(amount, status)")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setJobs((data || []) as Job[]);
        setLoading(false);
      });
    supabase.from("shipstation_reports")
      .select("id, client_id, period_label, created_at, totals, clients(name)")
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => setShipReports((data || []) as any));
  }, []);

  // ── Revenue by month ──
  const revenueByMonth = useMemo(() => {
    const months: Record<string, { revenue: number; cost: number; units: number; count: number }> = {};
    for (const j of jobs) {
      const d = j.created_at ? new Date(j.created_at) : null;
      if (!d) continue;
      const key = d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
      if (!months[key]) months[key] = { revenue: 0, cost: 0, units: 0, count: 0 };
      months[key].revenue += effectiveRevenue(j);
      months[key].cost += effectiveCost(j);
      months[key].units += (j.items || []).reduce((a, it) => a + (it.buy_sheet_lines || []).reduce((b, l) => b + (l.qty_ordered || 0), 0), 0);
      months[key].count++;
    }
    return Object.entries(months).slice(0, 12).reverse();
  }, [jobs]);

  // ── Revenue by client ──
  const revenueByClient = useMemo(() => {
    const clients: Record<string, { revenue: number; cost: number; units: number; jobs: number; paid: number }> = {};
    for (const j of jobs) {
      const name = j.clients?.name || "Unknown";
      if (!clients[name]) clients[name] = { revenue: 0, cost: 0, units: 0, jobs: 0, paid: 0 };
      clients[name].revenue += effectiveRevenue(j);
      clients[name].cost += effectiveCost(j);
      clients[name].units += (j.items || []).reduce((a, it) => a + (it.buy_sheet_lines || []).reduce((b, l) => b + (l.qty_ordered || 0), 0), 0);
      clients[name].jobs++;
      clients[name].paid += (j.payment_records || []).filter(p => p.status === "paid").reduce((a, p) => a + p.amount, 0);
    }
    return Object.entries(clients).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [jobs]);

  // ── Margins by project ──
  const marginsByProject = useMemo(() => {
    return jobs
      .filter(j => effectiveRevenue(j) > 0)
      .map(j => {
        const rev = effectiveRevenue(j);
        const cost = effectiveCost(j);
        const margin = rev > 0 ? ((rev - cost) / rev * 100) : 0;
        return { title: j.title, client: j.clients?.name || "", revenue: rev, cost, margin, phase: j.phase };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [jobs]);

  // ── Turnaround time ──
  const turnaround = useMemo(() => {
    const completed = jobs.filter(j => j.phase === "complete" && j.phase_timestamps?.complete && j.phase_timestamps?.intake);
    if (completed.length === 0) return null;
    const days = completed.map(j => {
      const start = new Date(j.phase_timestamps!.intake!).getTime();
      const end = new Date(j.phase_timestamps!.complete!).getTime();
      return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    });
    return { avg: Math.round(days.reduce((a, d) => a + d, 0) / days.length), min: Math.min(...days), max: Math.max(...days), count: days.length };
  }, [jobs]);

  // ── KPIs ──
  const totalRevenue = jobs.reduce((a, j) => a + effectiveRevenue(j), 0);
  const totalCost = jobs.reduce((a, j) => a + effectiveCost(j), 0);
  const avgMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;
  const totalUnits = jobs.reduce((a, j) => a + (j.items || []).reduce((b, it) => b + (it.buy_sheet_lines || []).reduce((c, l) => c + (l.qty_ordered || 0), 0), 0), 0);
  const totalPaid = jobs.reduce((a, j) => a + (j.payment_records || []).filter(p => p.status === "paid").reduce((b, p) => b + p.amount, 0), 0);

  // ── CSV exports ──
  function exportProjects() {
    exportCsv("opshub-projects.csv",
      ["Quote #", "Invoice #", "Client", "Title", "Type", "Phase", "Priority", "Ship Date", "Revenue", "Cost", "Margin %", "Units", "Paid"],
      jobs.map(j => {
        const rev = effectiveRevenue(j);
        const cost = effectiveCost(j);
        const units = (j.items || []).reduce((a, it) => a + (it.buy_sheet_lines || []).reduce((b, l) => b + (l.qty_ordered || 0), 0), 0);
        const paid = (j.payment_records || []).filter(p => p.status === "paid").reduce((a, p) => a + p.amount, 0);
        return [(j as any).job_number || "", (j as any).type_meta?.qb_invoice_number || "", j.clients?.name || "", j.title, j.job_type, j.phase, (j as any).priority || "", j.target_ship_date || "", String(rev), String(cost), rev > 0 ? ((rev - cost) / rev * 100).toFixed(1) : "0", String(units), String(paid)];
      })
    );
  }

  function exportClients() {
    exportCsv("opshub-clients.csv",
      ["Client", "Revenue", "Cost", "Margin %", "Units", "Jobs", "Paid"],
      revenueByClient.map(([name, d]) => [name, String(d.revenue), String(d.cost), d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100).toFixed(1) : "0", String(d.units), String(d.jobs), String(d.paid)])
    );
  }

  function exportPayments() {
    const rows: string[][] = [];
    for (const j of jobs) {
      for (const p of (j.payment_records || [])) {
        rows.push([(j as any).job_number || "", j.clients?.name || "", j.title, (p as any).type || "", String(p.amount), p.status, (p as any).invoice_number || "", (p as any).due_date || ""]);
      }
    }
    exportCsv("opshub-payments.csv", ["Job #", "Client", "Project", "Type", "Amount", "Status", "Invoice #", "Due Date"], rows);
  }

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };
  const thStyle: React.CSSProperties = { padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}` };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading reports...</div>;

  const maxMonthRev = Math.max(...revenueByMonth.map(([, d]) => d.revenue), 1);

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header + exports */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Reports</h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{jobs.length} total projects</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href="/reports/shipstation/new" style={{ background: T.accent, border: "none", borderRadius: 6, color: "#0a0e1a", fontSize: 11, fontFamily: font, fontWeight: 700, padding: "6px 14px", cursor: "pointer", textDecoration: "none", display: "inline-block" }}>+ Create ShipStation Report</Link>
          <button onClick={exportProjects} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>Export Projects CSV</button>
          <button onClick={exportClients} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>Export Clients CSV</button>
          <button onClick={exportPayments} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>Export Payments CSV</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: 8 }}>
        {[
          { label: "Total Revenue", value: fmtD(totalRevenue), color: T.accent },
          { label: "Total Cost", value: fmtD(totalCost), color: T.muted },
          { label: "Avg Margin", value: fmtPct(avgMargin), color: avgMargin >= 30 ? T.green : avgMargin >= 20 ? T.amber : T.red },
          { label: "Total Units", value: totalUnits.toLocaleString(), color: T.text },
          { label: "Total Paid", value: fmtD(totalPaid), color: T.green },
        ].map(s => (
          <div key={s.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: mono }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>

        {/* Revenue by month */}
        <div style={card}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>Revenue by Month</div>
          {revenueByMonth.length === 0 ? (
            <div style={{ fontSize: 12, color: T.faint, padding: "16px 0", textAlign: "center" }}>No data yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {revenueByMonth.map(([month, d]) => {
                const margin = d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100) : 0;
                return (
                  <div key={month} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 60, fontSize: 11, color: T.muted, flexShrink: 0 }}>{month}</span>
                    <div style={{ flex: 1, height: 20, background: T.surface, borderRadius: 4, overflow: "hidden", position: "relative" }}>
                      <div style={{ height: "100%", width: (d.revenue / maxMonthRev * 100) + "%", background: T.accent, borderRadius: 4, transition: "width 0.3s" }} />
                      <span style={{ position: "absolute", right: 6, top: 2, fontSize: 10, fontFamily: mono, color: T.text, fontWeight: 600 }}>{fmtD(d.revenue)}</span>
                    </div>
                    <span style={{ width: 40, fontSize: 10, fontFamily: mono, color: margin >= 30 ? T.green : margin >= 20 ? T.amber : T.faint, textAlign: "right", flexShrink: 0 }}>{fmtPct(margin)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Turnaround + summary stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {turnaround && (
            <div style={card}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Average Turnaround</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: T.accent, fontFamily: mono }}>{turnaround.avg}d</div>
                  <div style={{ fontSize: 10, color: T.muted }}>Average</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: T.green, fontFamily: mono }}>{turnaround.min}d</div>
                  <div style={{ fontSize: 10, color: T.muted }}>Fastest</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: T.red, fontFamily: mono }}>{turnaround.max}d</div>
                  <div style={{ fontSize: 10, color: T.muted }}>Slowest</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: T.faint, marginTop: 6 }}>Based on {turnaround.count} completed project{turnaround.count !== 1 ? "s" : ""}</div>
            </div>
          )}

          {/* Units by month */}
          <div style={card}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Units by Month</div>
            {revenueByMonth.length === 0 ? (
              <div style={{ fontSize: 12, color: T.faint, padding: "16px 0", textAlign: "center" }}>No data yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {revenueByMonth.map(([month, d]) => (
                  <div key={month} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                    <span style={{ fontSize: 11, color: T.muted }}>{month}</span>
                    <span style={{ fontSize: 12, fontFamily: mono, fontWeight: 600, color: T.text }}>{d.units.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Revenue by client */}
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Revenue by Client</div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 600 : "auto" }}>
          <thead>
            <tr>
              {["Client", "Revenue", "Cost", "Margin", "Units", "Projects", "Paid"].map(h => (
                <th key={h} style={{ ...thStyle, textAlign: h === "Client" ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {revenueByClient.map(([name, d]) => {
              const margin = d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100) : 0;
              return (
                <tr key={name}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{name}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.accent }}>{fmtD(d.revenue)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.muted }}>{fmtD(d.cost)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: margin >= 30 ? T.green : margin >= 20 ? T.amber : T.red }}>{fmtPct(margin)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono }}>{d.units.toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono }}>{d.jobs}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.green }}>{fmtD(d.paid)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* ShipStation reports */}
      {shipReports.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>ShipStation Sales Reports</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 600 : "auto" }}>
              <thead>
                <tr>
                  {["Client", "Period", "Generated", "Qty", "Sales", "Net Profit", ""].map(h => (
                    <th key={h} style={{ ...thStyle, textAlign: ["Client", "Period"].includes(h) ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipReports.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.clients?.name || "—"}</td>
                    <td style={tdStyle}>{r.period_label}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono }}>{(r.totals?.qty || 0).toLocaleString()}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.accent }}>{fmtD(r.totals?.sales || 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.green }}>{fmtD(r.totals?.profit || 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <Link href={`/reports/shipstation/${r.id}`} style={{ color: T.accent, fontSize: 11, textDecoration: "none" }}>Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Margins by project */}
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Margins by Project</div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 600 : "auto" }}>
          <thead>
            <tr>
              {["Project", "Client", "Revenue", "Cost", "Margin", "Phase"].map(h => (
                <th key={h} style={{ ...thStyle, textAlign: ["Project", "Client", "Phase"].includes(h) ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {marginsByProject.map(p => (
              <tr key={p.title + p.client}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{p.title}</td>
                <td style={{ ...tdStyle, color: T.muted }}>{p.client}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.accent }}>{fmtD(p.revenue)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.muted }}>{fmtD(p.cost)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, fontWeight: 600, color: p.margin >= 30 ? T.green : p.margin >= 20 ? T.amber : T.red }}>{fmtPct(p.margin)}</td>
                <td style={{ ...tdStyle, textTransform: "capitalize", color: T.muted }}>{p.phase.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

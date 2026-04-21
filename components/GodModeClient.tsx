"use client";
import { useState } from "react";
import { T, font, mono } from "@/lib/theme";

// ── Types passed from the server page ──
export type ClientStat = {
  clientId: string;
  name: string;
  lifetimeRev: number;
  totalCost: number;
  avgMarginPct: number;
  daysSinceLastJob: number | null;
  activeJobs: number;
  ytdJobs: number;
  avgPayDelay: number | null;
  paidPaymentCount: number;
  healthScore: number;
  churnRisk: "high" | "medium" | "low" | "cold";
};
export type DecoratorStat = {
  id: string;
  name: string;
  shortCode: string;
  activeLoad: number;
  avgTurnaround: number | null;
  avgVariancePct: number | null;
  avgRevisions: number | null;
  completedCount: number;
};
export type CashRow = {
  jobId: string;
  jobTitle: string;
  clientName: string;
  amount: number;
  expectedIso: string;
  invoiceNum: string | null;
};
export type ParetoRow = { name: string; profit: number };
export type CategoryStat = {
  garmentType: string;
  revenue: number;
  cost: number;
  units: number;
  marginPct: number;
  jobCount: number;
  exactCostCoverage: number; // 0–1 — fraction of items with saved cost_per_unit_all_in
};

export type ClientJobDetail = {
  clientId: string;
  jobs: { jobId: string; title: string; phase: string; createdAt: string; grossRev: number; totalCost: number; marginPct: number; paid: number; outstanding: number }[];
};
export type DecoratorItemDetail = {
  decoratorId: string;
  items: { itemId: string; jobTitle: string; clientName: string; name: string; turnaroundDays: number | null; variancePct: number | null; revisionCount: number }[];
};
export type CashWeekDetail = {
  weekIdx: number;
  weekLabel: string;
  rows: CashRow[];
};
export type CategoryItemDetail = {
  garmentType: string;
  items: { itemId: string; jobTitle: string; clientName: string; name: string; units: number; revenue: number; cost: number; marginPct: number; exact: boolean }[];
};

type Props = {
  totalExpectedInflow: number;
  activeClientCount: number;
  activeProjectCount: number;
  clientStats: ClientStat[];
  decoratorStats: DecoratorStat[];
  weekBuckets: number[];
  weekLabels: string[];
  upcomingPayments: CashRow[];
  pareto: { top: ParetoRow[]; restCount: number; restProfit: number; totalProfit: number };
  categories: CategoryStat[];
  details: {
    clientJobs: Record<string, ClientJobDetail["jobs"]>;
    decoratorItems: Record<string, DecoratorItemDetail["items"]>;
    cashByWeek: Record<number, CashRow[]>;
    categoryItems: Record<string, CategoryItemDetail["items"]>;
  };
};

// ── Helpers ──
const fmtD = (n: number) => "$" + (Math.round(n) || 0).toLocaleString();
const fmtPct = (n: number) => (n * 100).toFixed(1) + "%";
const fmtDateIso = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
};
const garmentLabel = (g: string) => g === "uncategorized" ? "Uncategorized" : g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Modal ──
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 14,
        maxWidth: 1000, width: "100%", maxHeight: "90vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px" }}>×</button>
        </div>
        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Small components ──
const CsvBtn = ({ onClick }: { onClick: () => void }) => (
  <button onClick={onClick} style={{
    padding: "4px 10px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}`,
    color: T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font,
  }}>Export CSV</button>
);

const rowStyle = { cursor: "pointer" as const };
const rowHoverProps = {
  onMouseEnter: (e: any) => { e.currentTarget.style.background = T.surface; },
  onMouseLeave: (e: any) => { e.currentTarget.style.background = "transparent"; },
};
const tdBase = { padding: "10px", borderBottom: `1px solid ${T.surface}`, fontSize: 12 };
const thBase = { textAlign: "left" as const, padding: "8px 10px", borderBottom: `1px solid ${T.border}`, color: T.faint, fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 700 };

// ── Main ──
export function GodModeClient(props: Props) {
  const { clientStats, decoratorStats, weekBuckets, weekLabels, upcomingPayments, pareto, categories, details, totalExpectedInflow, activeClientCount, activeProjectCount } = props;

  const [modalClient, setModalClient] = useState<ClientStat | null>(null);
  const [modalDecorator, setModalDecorator] = useState<DecoratorStat | null>(null);
  const [modalCashWeek, setModalCashWeek] = useState<number | null>(null);
  const [modalCategory, setModalCategory] = useState<CategoryStat | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [backfillResult, setBackfillResult] = useState<string>("");

  async function runBackfill() {
    if (backfillStatus === "running") return;
    if (!confirm("Backfill per-item costs for every historical job? This re-runs CostingTab's calculation server-side and writes cost_per_unit_all_in on every item. Safe to re-run.")) return;
    setBackfillStatus("running");
    setBackfillResult("");
    try {
      const res = await fetch("/api/admin/backfill-item-costs", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Backfill failed");
      setBackfillStatus("done");
      setBackfillResult(`${data.itemsUpdated} items updated across ${data.jobsScanned} jobs${data.itemsSkipped ? ` · ${data.itemsSkipped} skipped` : ""}${data.totalErrors ? ` · ${data.totalErrors} errors` : ""}`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      setBackfillStatus("error");
      setBackfillResult(e.message || "Failed");
    }
  }

  const card: any = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 16 };
  const sectionHead: any = { display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${T.border}`, paddingBottom: 8, marginBottom: 16 };

  return (
    <div style={{ fontFamily: font, color: T.text, padding: "24px 28px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Hero */}
      <div style={{
        padding: "24px 28px", borderRadius: 14,
        background: `linear-gradient(135deg, ${T.card}, ${T.surface})`,
        border: `1px solid ${T.border}`, marginBottom: 32,
      }}>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", color: T.muted, textTransform: "uppercase", fontWeight: 700 }}>God Mode</div>
        <h1 style={{ margin: "6px 0 4px", fontSize: 28, fontWeight: 800 }}>Owner's Operational Intelligence</h1>
        <div style={{ color: T.muted, fontSize: 13 }}>
          {activeClientCount} clients · {activeProjectCount} active projects · {fmtD(totalExpectedInflow)} expected next 90 days
        </div>
        <div style={{ marginTop: 10, color: T.faint, fontSize: 11 }}>
          Click any row to drill into the underlying data · every section exports to CSV
        </div>
      </div>

      {/* 1. Client Health */}
      <section style={{ marginBottom: 32 }}>
        <div style={sectionHead}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Client Health</h2>
          <span style={{ color: T.muted, fontSize: 12 }}>{clientStats.length} clients with lifetime revenue</span>
          <div style={{ marginLeft: "auto" }}>
            <CsvBtn onClick={() => downloadCsv("god-mode-client-health.csv", clientStats.map(c => ({
              client: c.name, lifetime_rev: c.lifetimeRev.toFixed(2), total_cost: c.totalCost.toFixed(2),
              avg_margin_pct: (c.avgMarginPct * 100).toFixed(2), days_since_last_job: c.daysSinceLastJob ?? "",
              active_jobs: c.activeJobs, ytd_jobs: c.ytdJobs,
              avg_pay_delay_days: c.avgPayDelay === null ? "" : c.avgPayDelay.toFixed(1),
              paid_payment_count: c.paidPaymentCount, health_score: c.healthScore, churn_risk: c.churnRisk,
            })))} />
          </div>
        </div>
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thBase}>Client</th>
                  <th style={{...thBase, textAlign: "right"}}>Lifetime</th>
                  <th style={{...thBase, textAlign: "right"}}>Avg Margin</th>
                  <th style={{...thBase, textAlign: "right"}}>Last Job</th>
                  <th style={{...thBase, textAlign: "right"}}>Active</th>
                  <th style={{...thBase, textAlign: "right"}}>Pay Behavior</th>
                  <th style={{...thBase, textAlign: "right"}}>Health</th>
                  <th style={thBase}></th>
                </tr>
              </thead>
              <tbody>
                {clientStats.map(c => (
                  <tr key={c.clientId} onClick={() => setModalClient(c)} style={rowStyle} {...rowHoverProps}>
                    <td style={{...tdBase, fontWeight: 600}}>{c.name}</td>
                    <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{fmtD(c.lifetimeRev)}</td>
                    <td style={{...tdBase, textAlign: "right", fontFamily: mono,
                      color: c.avgMarginPct >= 0.3 ? T.green : c.avgMarginPct >= 0.15 ? T.amber : T.red }}>
                      {fmtPct(c.avgMarginPct)}
                    </td>
                    <td style={{...tdBase, textAlign: "right", color: T.muted}}>
                      {c.daysSinceLastJob === null ? "—" : c.daysSinceLastJob === 0 ? "today" : `${c.daysSinceLastJob}d ago`}
                    </td>
                    <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{c.activeJobs || "—"}</td>
                    <td style={{...tdBase, textAlign: "right"}}>
                      {c.avgPayDelay === null ? (
                        <span style={{ color: T.faint, fontSize: 11 }}>—</span>
                      ) : (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                          background: c.avgPayDelay <= 3 ? T.greenDim : c.avgPayDelay <= 15 ? "#3a2a0a" : "#3a0a0a",
                          color: c.avgPayDelay <= 3 ? T.green : c.avgPayDelay <= 15 ? T.amber : T.red,
                        }}>{c.avgPayDelay <= 0 ? "On time" : `+${Math.round(c.avgPayDelay)}d late`}</span>
                      )}
                    </td>
                    <td style={{...tdBase, textAlign: "right"}}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 6, background: T.surface, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${c.healthScore}%`,
                            background: c.healthScore >= 70 ? T.green : c.healthScore >= 40 ? T.amber : T.red }} />
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, minWidth: 22 }}>{c.healthScore}</span>
                      </div>
                    </td>
                    <td style={{...tdBase, textAlign: "right"}}>
                      {c.churnRisk === "high" && <span style={{ fontSize: 10, fontWeight: 700, color: T.red, padding: "2px 8px", borderRadius: 99, background: "#3a0a0a" }}>CHURN</span>}
                      {c.churnRisk === "medium" && <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, padding: "2px 8px", borderRadius: 99, background: "#3a2a0a" }}>COOLING</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clientStats.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>No clients with revenue yet.</div>
            )}
          </div>
          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.surface}` }}>
            reads: jobs · payment_records · costing_summary · clients · health = recency·0.4 + margin·0.3 + pay·0.2 + frequency·0.1
          </div>
        </div>
      </section>

      {/* 2. Decorator Scorecard */}
      <section style={{ marginBottom: 32 }}>
        <div style={sectionHead}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Decorator Scorecard</h2>
          <span style={{ color: T.muted, fontSize: 12 }}>Items shipped in the last 90 days</span>
          <div style={{ marginLeft: "auto" }}>
            <CsvBtn onClick={() => downloadCsv("god-mode-decorator-scorecard.csv", decoratorStats.map(d => ({
              decorator: d.shortCode, active_load: d.activeLoad,
              avg_turnaround_days: d.avgTurnaround === null ? "" : d.avgTurnaround.toFixed(1),
              avg_variance_pct: d.avgVariancePct === null ? "" : (d.avgVariancePct * 100).toFixed(2),
              avg_revisions: d.avgRevisions === null ? "" : d.avgRevisions.toFixed(2),
              completed_count_90d: d.completedCount,
            })))} />
          </div>
        </div>
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thBase}>Decorator</th>
                <th style={{...thBase, textAlign: "right"}}>Active Load</th>
                <th style={{...thBase, textAlign: "right"}}>Avg Turnaround</th>
                <th style={{...thBase, textAlign: "right"}}>Variance %</th>
                <th style={{...thBase, textAlign: "right"}}>Revision Rounds</th>
                <th style={{...thBase, textAlign: "right"}}>Completed 90d</th>
              </tr>
            </thead>
            <tbody>
              {decoratorStats.map(d => (
                <tr key={d.id} onClick={() => setModalDecorator(d)} style={rowStyle} {...rowHoverProps}>
                  <td style={{...tdBase, fontWeight: 600}}>{d.shortCode}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{d.activeLoad || <span style={{ color: T.faint }}>—</span>}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>
                    {d.avgTurnaround === null ? <span style={{ color: T.faint }}>—</span> : `${d.avgTurnaround.toFixed(1)}d`}
                  </td>
                  <td style={{...tdBase, textAlign: "right"}}>
                    {d.avgVariancePct === null ? <span style={{ color: T.faint, fontFamily: mono }}>—</span> : (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: d.avgVariancePct <= 0.02 ? T.greenDim : d.avgVariancePct <= 0.05 ? "#3a2a0a" : "#3a0a0a",
                        color: d.avgVariancePct <= 0.02 ? T.green : d.avgVariancePct <= 0.05 ? T.amber : T.red,
                      }}>{fmtPct(d.avgVariancePct)}</span>
                    )}
                  </td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>
                    {d.avgRevisions === null ? <span style={{ color: T.faint }}>—</span> : d.avgRevisions.toFixed(1)}
                  </td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: T.muted}}>{d.completedCount || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {decoratorStats.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>No decorator data yet.</div>
          )}
          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.surface}` }}>
            reads: decorator_assignments · items.pipeline_timestamps · items.ship_qtys vs buy_sheet_lines.qty_ordered · item_files (revision_requested)
          </div>
        </div>
      </section>

      {/* 3. Cash Flow 90d */}
      <section style={{ marginBottom: 32 }}>
        <div style={sectionHead}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Cash Flow — 90 Day Forecast</h2>
          <span style={{ color: T.muted, fontSize: 12 }}>Expected inflow from active projects</span>
          <div style={{ marginLeft: "auto" }}>
            <CsvBtn onClick={() => downloadCsv("god-mode-cashflow.csv", upcomingPayments.map(p => ({
              expected_date: p.expectedIso, client: p.clientName, project: p.jobTitle,
              amount: p.amount.toFixed(2), invoice_number: p.invoiceNum || "",
            })))} />
          </div>
        </div>
        <div style={card}>
          {(() => {
            const max = Math.max(...weekBuckets, 1);
            return (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                {weekBuckets.map((amt, i) => (
                  <div key={i} onClick={() => amt > 0 && setModalCashWeek(i)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: amt > 0 ? "pointer" : "default" }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: amt > 0 ? T.muted : T.faint }}>
                      {amt > 0 ? `$${Math.round(amt/1000)}k` : ""}
                    </div>
                    <div style={{
                      width: "100%", height: `${Math.max(2, (amt / max) * 120)}px`,
                      background: amt > 0 ? T.green : T.surface, borderRadius: "3px 3px 0 0", opacity: 0.9,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e: any) => { if (amt > 0) e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e: any) => { if (amt > 0) e.currentTarget.style.opacity = "0.9"; }} />
                    <div style={{ fontSize: 9, color: T.faint }}>{weekLabels[i]}</div>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 12 }}>
            <span style={{ color: T.muted }}>90-day expected inflow</span>
            <span style={{ fontFamily: mono, color: T.green, fontWeight: 700 }}>{fmtD(totalExpectedInflow)}</span>
          </div>

          {upcomingPayments.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
                Next 20 Expected Payments
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thBase}>Expected</th>
                    <th style={thBase}>Client</th>
                    <th style={thBase}>Project</th>
                    <th style={{...thBase, textAlign: "right"}}>Amount</th>
                    <th style={{...thBase, textAlign: "right"}}>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingPayments.map((p, i) => (
                    <tr key={i}>
                      <td style={{...tdBase, fontFamily: mono, color: T.muted}}>{fmtDateIso(p.expectedIso)}</td>
                      <td style={{...tdBase, fontWeight: 600}}>{p.clientName}</td>
                      <td style={{...tdBase, color: T.muted}}>{p.jobTitle}</td>
                      <td style={{...tdBase, textAlign: "right", fontFamily: mono, fontWeight: 700}}>{fmtD(p.amount)}</td>
                      <td style={{...tdBase, textAlign: "right", color: T.muted, fontFamily: mono}}>{p.invoiceNum ? `#${p.invoiceNum}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.surface}` }}>
            reads: jobs.target_ship_date · payment_terms · type_meta.qb_total_with_tax · costing_summary.grossRev · payment_records
          </div>
        </div>
      </section>

      {/* 4. Client 80/20 */}
      <section style={{ marginBottom: 32 }}>
        <div style={sectionHead}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Client 80/20</h2>
          <span style={{ color: T.muted, fontSize: 12 }}>
            {pareto.top.length} {pareto.top.length === 1 ? "client drives" : "clients drive"} 80% of profit
          </span>
          <div style={{ marginLeft: "auto" }}>
            <CsvBtn onClick={() => downloadCsv("god-mode-pareto.csv", [
              ...pareto.top.map((c, i) => ({ rank: i + 1, client: c.name, profit: c.profit.toFixed(2), pct_of_profit: pareto.totalProfit > 0 ? (c.profit / pareto.totalProfit * 100).toFixed(2) : "0", in_top_80_pct: "yes" })),
              ...(pareto.restCount > 0 ? [{ rank: "rest", client: `${pareto.restCount} other clients`, profit: pareto.restProfit.toFixed(2), pct_of_profit: pareto.totalProfit > 0 ? (pareto.restProfit / pareto.totalProfit * 100).toFixed(2) : "0", in_top_80_pct: "no" }] : []),
            ])} />
          </div>
        </div>
        <div style={card}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pareto.top.map((c, i) => {
              const pct = pareto.totalProfit > 0 ? (c.profit / pareto.totalProfit) * 100 : 0;
              const clientStat = clientStats.find(cs => cs.name === c.name);
              return (
                <div key={i} onClick={() => clientStat && setModalClient(clientStat)} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, cursor: clientStat ? "pointer" : "default", padding: "3px 0" }}>
                  <span style={{ width: 200, fontWeight: 600 }}>{c.name}</span>
                  <div style={{ flex: 1, height: 18, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #3b82f6, #8b5cf6)" }} />
                  </div>
                  <span style={{ fontFamily: mono, width: 140, textAlign: "right", color: T.muted }}>{fmtD(c.profit)} · {pct.toFixed(1)}%</span>
                </div>
              );
            })}
            {pareto.restCount > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, opacity: 0.6, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.surface}` }}>
                <span style={{ width: 200, color: T.muted }}>Next {pareto.restCount} {pareto.restCount === 1 ? "client" : "clients"}</span>
                <div style={{ flex: 1, height: 18, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pareto.totalProfit > 0 ? (pareto.restProfit / pareto.totalProfit) * 100 : 0}%`, background: T.faint }} />
                </div>
                <span style={{ fontFamily: mono, width: 140, textAlign: "right", color: T.muted }}>
                  {fmtD(pareto.restProfit)} · {pareto.totalProfit > 0 ? ((pareto.restProfit/pareto.totalProfit)*100).toFixed(1) : "0"}%
                </span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.surface}` }}>
            reads: costing_summary.grossRev − costing_summary.totalCost grouped by clients.id (cancelled jobs excluded)
          </div>
        </div>
      </section>

      {/* 5. Margin by Category */}
      <section style={{ marginBottom: 32 }}>
        <div style={sectionHead}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Margin by Category</h2>
          <span style={{ color: T.muted, fontSize: 12 }}>Revenue + cost per garment type</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {backfillResult && (
              <span style={{ fontSize: 10, color: backfillStatus === "error" ? T.red : T.green, marginRight: 4 }}>
                {backfillResult}
              </span>
            )}
            <button onClick={runBackfill} disabled={backfillStatus === "running"}
              style={{
                padding: "4px 10px", borderRadius: 6,
                background: backfillStatus === "running" ? T.surface : T.accent,
                border: "none", color: "#fff", fontSize: 11, fontWeight: 600,
                cursor: backfillStatus === "running" ? "wait" : "pointer", fontFamily: font,
                opacity: backfillStatus === "running" ? 0.5 : 1,
              }}>
              {backfillStatus === "running" ? "Backfilling…" : "Backfill exact costs"}
            </button>
            <CsvBtn onClick={() => downloadCsv("god-mode-margin-by-category.csv", categories.map(c => ({
              garment_type: c.garmentType, revenue: c.revenue.toFixed(2), cost: c.cost.toFixed(2),
              profit: (c.revenue - c.cost).toFixed(2), margin_pct: (c.marginPct * 100).toFixed(2),
              units: c.units, job_count: c.jobCount,
              exact_cost_coverage: (c.exactCostCoverage * 100).toFixed(0) + "%",
            })))} />
          </div>
        </div>
        <div style={card}>
          {categories.map(c => {
            const profit = c.revenue - c.cost;
            const total = c.revenue;
            const costPct = total > 0 ? (c.cost / total) * 100 : 0;
            const profitPct = total > 0 ? (profit / total) * 100 : 0;
            return (
              <div key={c.garmentType} onClick={() => setModalCategory(c)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.surface}`, cursor: "pointer" }}
                {...rowHoverProps}>
                <span style={{ width: 120, fontSize: 12, fontWeight: 600 }}>{garmentLabel(c.garmentType)}</span>
                <div style={{ flex: 1, height: 22, background: T.surface, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${costPct}%`, background: "#3a0a0a" }} title={`Cost: ${fmtD(c.cost)}`} />
                  <div style={{ width: `${profitPct}%`, background: "#0a3a26" }} title={`Profit: ${fmtD(profit)}`} />
                </div>
                <span style={{ fontFamily: mono, width: 220, textAlign: "right", color: T.muted, fontSize: 11 }}>
                  {fmtD(c.revenue)} · {fmtPct(c.marginPct)} · {c.units.toLocaleString()}u
                  {c.exactCostCoverage < 1 && (
                    <span style={{ color: T.amber, marginLeft: 6 }} title="Some items use proportional cost allocation">
                      ({Math.round(c.exactCostCoverage * 100)}% exact)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {categories.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>No category data yet.</div>
          )}
          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.surface}` }}>
            reads: items.garment_type · sell_per_unit × qty_ordered (revenue) · cost_per_unit_all_in when saved, else allocated from costing_summary.totalCost
          </div>
        </div>
      </section>

      {/* ── Modals ── */}
      {modalClient && (
        <Modal title={modalClient.name} subtitle={`${modalClient.ytdJobs} jobs YTD · health ${modalClient.healthScore}/100`} onClose={() => setModalClient(null)}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
            <CsvBtn onClick={() => downloadCsv(`${modalClient.name.replace(/\W+/g, "-")}-jobs.csv`, (details.clientJobs[modalClient.clientId] || []).map(j => ({
              job_title: j.title, phase: j.phase, created: j.createdAt,
              gross_rev: j.grossRev.toFixed(2), total_cost: j.totalCost.toFixed(2),
              margin_pct: (j.marginPct * 100).toFixed(2),
              paid: j.paid.toFixed(2), outstanding: j.outstanding.toFixed(2),
            })))} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thBase}>Job</th>
                <th style={thBase}>Phase</th>
                <th style={thBase}>Created</th>
                <th style={{...thBase, textAlign: "right"}}>Revenue</th>
                <th style={{...thBase, textAlign: "right"}}>Cost</th>
                <th style={{...thBase, textAlign: "right"}}>Margin</th>
                <th style={{...thBase, textAlign: "right"}}>Paid</th>
                <th style={{...thBase, textAlign: "right"}}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(details.clientJobs[modalClient.clientId] || []).map((j, i) => (
                <tr key={i}>
                  <td style={{...tdBase, fontWeight: 600}}><a href={`/jobs/${j.jobId}`} style={{ color: T.text, textDecoration: "none" }}>{j.title}</a></td>
                  <td style={{...tdBase, color: T.muted}}>{j.phase}</td>
                  <td style={{...tdBase, color: T.muted, fontFamily: mono}}>{fmtDateIso(j.createdAt)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{fmtD(j.grossRev)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: T.muted}}>{fmtD(j.totalCost)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: j.marginPct >= 0.3 ? T.green : j.marginPct >= 0.15 ? T.amber : T.red}}>{fmtPct(j.marginPct)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: T.green}}>{fmtD(j.paid)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: j.outstanding > 0 ? T.amber : T.muted}}>{fmtD(j.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modalDecorator && (
        <Modal title={modalDecorator.shortCode} subtitle={`${modalDecorator.activeLoad} active · ${modalDecorator.completedCount} shipped (90d)`} onClose={() => setModalDecorator(null)}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
            <CsvBtn onClick={() => downloadCsv(`${modalDecorator.shortCode.replace(/\W+/g, "-")}-items.csv`, (details.decoratorItems[modalDecorator.id] || []).map(it => ({
              item: it.name, project: it.jobTitle, client: it.clientName,
              turnaround_days: it.turnaroundDays ?? "",
              variance_pct: it.variancePct === null ? "" : (it.variancePct * 100).toFixed(2),
              revision_count: it.revisionCount,
            })))} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thBase}>Item</th>
                <th style={thBase}>Project</th>
                <th style={thBase}>Client</th>
                <th style={{...thBase, textAlign: "right"}}>Turnaround</th>
                <th style={{...thBase, textAlign: "right"}}>Variance</th>
                <th style={{...thBase, textAlign: "right"}}>Revisions</th>
              </tr>
            </thead>
            <tbody>
              {(details.decoratorItems[modalDecorator.id] || []).map((it, i) => (
                <tr key={i}>
                  <td style={{...tdBase, fontWeight: 600}}>{it.name}</td>
                  <td style={{...tdBase, color: T.muted}}>{it.jobTitle}</td>
                  <td style={{...tdBase, color: T.muted}}>{it.clientName}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{it.turnaroundDays === null ? "—" : `${it.turnaroundDays}d`}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{it.variancePct === null ? "—" : fmtPct(it.variancePct)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: T.muted}}>{it.revisionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modalCashWeek !== null && (
        <Modal title={`Cash Flow — ${weekLabels[modalCashWeek]}`} subtitle={`Expected inflow: ${fmtD(weekBuckets[modalCashWeek])}`} onClose={() => setModalCashWeek(null)}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
            <CsvBtn onClick={() => downloadCsv(`cashflow-${weekLabels[modalCashWeek!]}.csv`, (details.cashByWeek[modalCashWeek!] || []).map(p => ({
              expected_date: p.expectedIso, client: p.clientName, project: p.jobTitle,
              amount: p.amount.toFixed(2), invoice: p.invoiceNum || "",
            })))} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thBase}>Expected</th>
                <th style={thBase}>Client</th>
                <th style={thBase}>Project</th>
                <th style={{...thBase, textAlign: "right"}}>Amount</th>
                <th style={{...thBase, textAlign: "right"}}>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {(details.cashByWeek[modalCashWeek] || []).map((p, i) => (
                <tr key={i}>
                  <td style={{...tdBase, fontFamily: mono, color: T.muted}}>{fmtDateIso(p.expectedIso)}</td>
                  <td style={{...tdBase, fontWeight: 600}}><a href={`/jobs/${p.jobId}`} style={{ color: T.text, textDecoration: "none" }}>{p.clientName}</a></td>
                  <td style={{...tdBase, color: T.muted}}>{p.jobTitle}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, fontWeight: 700}}>{fmtD(p.amount)}</td>
                  <td style={{...tdBase, textAlign: "right", color: T.muted, fontFamily: mono}}>{p.invoiceNum ? `#${p.invoiceNum}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modalCategory && (
        <Modal title={garmentLabel(modalCategory.garmentType)} subtitle={`${modalCategory.units.toLocaleString()} units · ${fmtD(modalCategory.revenue)} revenue · ${fmtPct(modalCategory.marginPct)} margin`} onClose={() => setModalCategory(null)}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
            {modalCategory.exactCostCoverage < 1 && (
              <span style={{ fontSize: 10, color: T.amber }}>
                {Math.round(modalCategory.exactCostCoverage * 100)}% exact · rest allocated proportionally
              </span>
            )}
            <CsvBtn onClick={() => downloadCsv(`${modalCategory.garmentType}-items.csv`, (details.categoryItems[modalCategory.garmentType] || []).map(it => ({
              item: it.name, project: it.jobTitle, client: it.clientName,
              units: it.units, revenue: it.revenue.toFixed(2), cost: it.cost.toFixed(2),
              margin_pct: (it.marginPct * 100).toFixed(2), cost_source: it.exact ? "exact" : "proportional",
            })))} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thBase}>Item</th>
                <th style={thBase}>Project</th>
                <th style={thBase}>Client</th>
                <th style={{...thBase, textAlign: "right"}}>Units</th>
                <th style={{...thBase, textAlign: "right"}}>Revenue</th>
                <th style={{...thBase, textAlign: "right"}}>Cost</th>
                <th style={{...thBase, textAlign: "right"}}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {(details.categoryItems[modalCategory.garmentType] || []).map((it, i) => (
                <tr key={i}>
                  <td style={{...tdBase, fontWeight: 600}}>{it.name} {!it.exact && <span style={{ color: T.amber, fontSize: 9 }} title="Proportional allocation">~</span>}</td>
                  <td style={{...tdBase, color: T.muted}}>{it.jobTitle}</td>
                  <td style={{...tdBase, color: T.muted}}>{it.clientName}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{it.units.toLocaleString()}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono}}>{fmtD(it.revenue)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: T.muted}}>{fmtD(it.cost)}</td>
                  <td style={{...tdBase, textAlign: "right", fontFamily: mono, color: it.marginPct >= 0.3 ? T.green : it.marginPct >= 0.15 ? T.amber : T.red}}>{fmtPct(it.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

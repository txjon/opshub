"use client";
import { useState, useEffect } from "react";
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
  reportId?: string | null; // set when this row is a ShipStation invoice, not a job
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
  jobs: { jobId: string; reportId?: string; title: string; phase: string; createdAt: string; grossRev: number; totalCost: number; marginPct: number; paid: number; outstanding: number }[];
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
  costVariance: number; // net actual-vs-projected cost across reconciled jobs (− = under plan)
  activeClientCount: number;
  activeProjectCount: number;
  clientStats: ClientStat[];
  decoratorStats: DecoratorStat[];
  weekBuckets: number[];
  weekLabels: string[];
  upcomingPayments: CashRow[];
  pareto: { top: ParetoRow[]; restCount: number; restProfit: number; totalProfit: number };
  categories: CategoryStat[];
  operations: {
    arBuckets: { current: number; d30: number; d60: number; d90plus: number };
    production: {
      phaseCounts: Record<string, number>;
      avgPhaseTimes: Record<string, number>;
      avgCycleTime: number;
      bottleneck: { phase: string; days: number } | null;
      stalled: { itemId: string; name: string; jobId: string; jobTitle: string; clientName: string; stage: string; days: number }[];
    };
    payments: {
      overdue: { id: string; jobId: string; jobTitle: string; clientName: string; amount: number; dueDate: string; daysOver: number }[];
      upcoming: { id: string; jobId: string; jobTitle: string; clientName: string; amount: number; dueDate: string }[];
    };
  };
  details: {
    clientJobs: Record<string, ClientJobDetail["jobs"]>;
    decoratorItems: Record<string, DecoratorItemDetail["items"]>;
    cashByWeek: Record<number, CashRow[]>;
    categoryItems: Record<string, CategoryItemDetail["items"]>;
  };
};

// ── Helpers ──
const fmtD = (n: number) => "$" + (Math.round(n) || 0).toLocaleString();
const fmtDk = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return "$" + (n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + "M";
  if (a >= 1_000) return "$" + Math.round(n / 1000) + "k";
  return "$" + Math.round(n);
};
const fmtInt = (n: number) => Math.round(n).toLocaleString();
const fmtPct = (n: number) => (n * 100).toFixed(1) + "%";
const fmtDateIso = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
};
const garmentLabel = (g: string) => g === "uncategorized" ? "Uncategorized" : g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");
// ShipStation rows link to their report; job rows link to the job.
const detailHref = (row: { reportId?: string | null; jobId?: string }) => row.reportId ? `/reports/shipstation/${row.reportId}` : `/jobs/${row.jobId}`;
const marginColor = (m: number) => m >= 0.3 ? T.green : m >= 0.15 ? T.amber : T.red;
const varianceColor = (v: number) => v <= 0.02 ? T.green : v <= 0.05 ? T.amber : T.red;

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

// ── Count-up animation for the headline KPI numbers ──
function useCountUp(target: number, duration = 950) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") { setVal(target); return; }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce || !target) { setVal(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const v = useCountUp(value);
  return <>{format(v)}</>;
}

function KpiTile({ i, label, value, sub, accent }: { i: number; label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="gm-kpi" style={{ animationDelay: `${i * 55}ms` }}>
      <div className="gm-kpi-label">{label}</div>
      <div className="gm-kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="gm-kpi-sub">{sub}</div>}
    </div>
  );
}

// Sparkbars for the cash-flow nav card (tiny preview of the 13-week buckets).
function SparkBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="gm-spark">
      {data.map((d, i) => <div key={i} className="gm-spark-bar" style={{ height: `${Math.max(8, (d / max) * 100)}%`, background: color, opacity: d > 0 ? 0.9 : 0.25 }} />)}
    </div>
  );
}

// Clickable section selector ("chip"). The whole grid acts like a segmented
// control — only the active section's heavy table/chart renders below.
function NavCard({ active, accent, title, value, sub, subColor, mini, onClick }: {
  active: boolean; accent: string; title: string; value: React.ReactNode; sub?: string; subColor?: string; mini?: React.ReactNode; onClick: () => void;
}) {
  return (
    <button className={`gm-nav${active ? " active" : ""}`} onClick={onClick} style={{ ["--nav-accent" as any]: accent }}>
      <div className="gm-nav-title">{title}</div>
      <div className="gm-nav-value">{value}</div>
      {mini}
      {sub && <div className="gm-nav-sub" style={subColor ? { color: subColor } : undefined}>{sub}</div>}
    </button>
  );
}

type SectionKey = "clients" | "decorators" | "cash" | "pareto" | "margin" | "ar" | "production" | "paymentsAttn";

const PHASE_LABEL: Record<string, string> = {
  intake: "Intake", pending: "Pending", ready: "Ready", production: "Production",
  receiving: "Receiving", shipping: "Shipping", fulfillment: "Fulfillment", on_hold: "On Hold",
};
const phaseLabel = (p: string) => PHASE_LABEL[p] || (p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, " "));

// ── Modal ──
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} className="gm-modal-backdrop">
      <div onClick={e => e.stopPropagation()} className="gm-modal">
        <div className="gm-modal-head">
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: "-0.01em" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} className="gm-modal-x" aria-label="Close">×</button>
        </div>
        <div className="gm-modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── Small components ──
const CsvBtn = ({ onClick }: { onClick: () => void }) => (
  <button onClick={onClick} className="gm-csv">Export CSV</button>
);

function SectionHead({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="gm-sechead">
      <h2 className="gm-sectitle">{title}</h2>
      <span className="gm-sechint">{hint}</span>
      <div className="gm-secactions">{children}</div>
    </div>
  );
}

const Reads = ({ children }: { children: React.ReactNode }) => (
  <div className="gm-reads">{children}</div>
);

// ── Main ──
export function GodModeClient(props: Props) {
  const { clientStats, decoratorStats, weekBuckets, weekLabels, upcomingPayments, pareto, categories, operations, details, totalExpectedInflow, costVariance, activeClientCount, activeProjectCount } = props;

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

  // ── Headline aggregates (derived from the same props, no extra fetch) ──
  const totalRev = clientStats.reduce((a, c) => a + c.lifetimeRev, 0);
  const totalCostAll = clientStats.reduce((a, c) => a + c.totalCost, 0);
  const totalProfit = totalRev - totalCostAll;
  const blendedMargin = totalRev > 0 ? totalProfit / totalRev : 0;
  const openAR = Object.values(details.clientJobs).flat().reduce((a, j) => a + (j.outstanding > 0 ? j.outstanding : 0), 0);
  const atRisk = clientStats.filter(c => c.churnRisk === "high" || c.churnRisk === "medium").length;

  // Which section is expanded below the nav row.
  const [active, setActive] = useState<SectionKey>("cash");

  // Per-card summary previews (computed from the same props).
  const decoTurns = decoratorStats.map(d => d.avgTurnaround).filter((x): x is number => x != null);
  const avgDecoTurn = decoTurns.length ? decoTurns.reduce((a, b) => a + b, 0) / decoTurns.length : null;
  const totalClients = pareto.top.length + pareto.restCount;
  const ACCENT: Record<SectionKey, string> = {
    clients: T.blue, decorators: T.purple, cash: T.green, pareto: T.amber, margin: T.muted,
    ar: T.amber, production: T.blue, paymentsAttn: T.red,
  };
  // Operational previews.
  const ar = operations.arBuckets;
  const arTotal = ar.current + ar.d30 + ar.d60 + ar.d90plus;
  const overdueTotal = operations.payments.overdue.reduce((a, p) => a + p.amount, 0);
  const sortedActivePhases = Object.entries(operations.production.phaseCounts).sort((a, b) => b[1] - a[1]);
  const maxPhaseCount = Math.max(1, ...Object.values(operations.production.phaseCounts));

  // CSS custom properties so the <style> block can reference theme tokens.
  const rootVars = {
    ["--card" as any]: T.card, ["--border" as any]: T.border, ["--surface" as any]: T.surface,
    ["--text" as any]: T.text, ["--muted" as any]: T.muted, ["--faint" as any]: T.faint,
    ["--green" as any]: T.green, ["--red" as any]: T.red, ["--amber" as any]: T.amber,
    ["--blue" as any]: T.blue, ["--purple" as any]: T.purple, ["--accent" as any]: T.accent,
    ["--font" as any]: font, ["--mono" as any]: mono,
  };

  return (
    <div className="gm-root" style={rootVars}>
      {/* dangerouslySetInnerHTML (not a text child) so the quotes in the CSS
          — e.g. content: "" on the chip dot — aren't HTML-escaped on the
          server and left raw on the client, which trips a hydration mismatch. */}
      <style dangerouslySetInnerHTML={{ __html: GM_CSS }} />

      {/* ── Hero + headline KPIs ── */}
      <div className="gm-hero">
        <div className="gm-eyebrow">● God Mode · live</div>
        <h1 className="gm-title">Owner's Command</h1>
        <div className="gm-subtitle">
          {activeClientCount} active clients · {activeProjectCount} projects in flight · {fmtD(totalExpectedInflow)} expected in the next 90 days
        </div>
      </div>

      <div className="gm-kpis">
        <KpiTile i={0} label="Lifetime Revenue" value={<CountUp value={totalRev} format={fmtD} />} sub="all clients, all time" />
        <KpiTile i={1} label="Net Profit" value={<CountUp value={totalProfit} format={fmtD} />} sub={`${fmtPct(blendedMargin)} blended margin`} accent={T.green} />
        <KpiTile i={2} label="90-Day Cash" value={<CountUp value={totalExpectedInflow} format={fmtD} />} sub="expected inflow" accent={T.green} />
        <KpiTile i={3} label="Open AR" value={<CountUp value={openAR} format={fmtD} />} sub="awaiting payment" accent={openAR > 0 ? T.amber : T.muted} />
        <KpiTile i={4} label="Cost vs Plan" value={<CountUp value={Math.abs(costVariance)} format={fmtDk} />} sub={costVariance <= 0 ? "under projection" : "over projection"} accent={costVariance > 0 ? T.red : T.green} />
        <KpiTile i={5} label="At-Risk Clients" value={<CountUp value={atRisk} format={fmtInt} />} sub="cooling or churning" accent={atRisk > 0 ? T.red : T.green} />
      </div>

      {/* ── Section selector (chips), grouped Financial + Operations ── */}
      <div className="gm-navgroup-label">Financial</div>
      <div className="gm-nav-grid">
        <NavCard active={active === "clients"} accent={ACCENT.clients} title="Client Health" onClick={() => setActive("clients")}
          value={fmtInt(clientStats.length)} sub={atRisk > 0 ? `${atRisk} at risk` : "all healthy"} subColor={atRisk > 0 ? T.red : T.green} />
        <NavCard active={active === "decorators"} accent={ACCENT.decorators} title="Decorators" onClick={() => setActive("decorators")}
          value={fmtInt(decoratorStats.length)} sub={avgDecoTurn === null ? "no 90d data" : `${avgDecoTurn.toFixed(1)}d avg turnaround`} />
        <NavCard active={active === "cash"} accent={ACCENT.cash} title="Cash Flow" onClick={() => setActive("cash")}
          value={fmtDk(totalExpectedInflow)} mini={<SparkBars data={weekBuckets} color={T.green} />} />
        <NavCard active={active === "pareto"} accent={ACCENT.pareto} title="Client 80/20" onClick={() => setActive("pareto")}
          value={fmtInt(pareto.top.length)} sub={`drive 80% · of ${totalClients} total`} />
        <NavCard active={active === "margin"} accent={ACCENT.margin} title="Margin / Category" onClick={() => setActive("margin")}
          value={fmtPct(blendedMargin)} sub={`${categories.length} categories`} subColor={marginColor(blendedMargin)} />
      </div>
      <div className="gm-navgroup-label">Operations</div>
      <div className="gm-nav-grid gm-nav-ops">
        <NavCard active={active === "ar"} accent={ACCENT.ar} title="AR Aging" onClick={() => setActive("ar")}
          value={fmtDk(arTotal)} sub={ar.d90plus > 0 ? `${fmtDk(ar.d90plus)} over 60d` : "nothing 60d+"} subColor={ar.d90plus > 0 ? T.red : T.green} />
        <NavCard active={active === "production"} accent={ACCENT.production} title="Production" onClick={() => setActive("production")}
          value={`${operations.production.avgCycleTime}d`} sub={`${operations.production.stalled.length} stalled · avg cycle`} subColor={operations.production.stalled.length > 0 ? T.amber : T.muted} />
        <NavCard active={active === "paymentsAttn"} accent={ACCENT.paymentsAttn} title="Payments" onClick={() => setActive("paymentsAttn")}
          value={fmtInt(operations.payments.overdue.length)} sub={overdueTotal > 0 ? `${fmtDk(overdueTotal)} overdue` : `${operations.payments.upcoming.length} due soon`} subColor={overdueTotal > 0 ? T.red : T.green} />
      </div>

      {/* ── 1. Client Health ── */}
      {active === "clients" && (
      <section className="gm-section">
        <SectionHead title="Client Health" hint={`${clientStats.length} clients with lifetime revenue`}>
          <CsvBtn onClick={() => downloadCsv("god-mode-client-health.csv", clientStats.map(c => ({
            client: c.name, lifetime_rev: c.lifetimeRev.toFixed(2), total_cost: c.totalCost.toFixed(2),
            avg_margin_pct: (c.avgMarginPct * 100).toFixed(2), days_since_last_job: c.daysSinceLastJob ?? "",
            active_jobs: c.activeJobs, ytd_jobs: c.ytdJobs,
            avg_pay_delay_days: c.avgPayDelay === null ? "" : c.avgPayDelay.toFixed(1),
            paid_payment_count: c.paidPaymentCount, health_score: c.healthScore, churn_risk: c.churnRisk,
          })))} />
        </SectionHead>
        <div className="gm-card">
          <div style={{ overflowX: "auto" }}>
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="r">Lifetime</th>
                  <th className="r">Avg Margin</th>
                  <th className="r">Last Job</th>
                  <th className="r">Active</th>
                  <th className="r">Pay Behavior</th>
                  <th>Health</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clientStats.map(c => (
                  <tr key={c.clientId} className="gm-row" onClick={() => setModalClient(c)}>
                    <td style={{ fontWeight: 700 }}>{c.name}</td>
                    <td className="r" style={{ fontFamily: mono }}>{fmtD(c.lifetimeRev)}</td>
                    <td className="r" style={{ fontFamily: mono, fontWeight: 700, color: marginColor(c.avgMarginPct) }}>{fmtPct(c.avgMarginPct)}</td>
                    <td className="r" style={{ color: T.muted }}>
                      {c.daysSinceLastJob === null ? "—" : c.daysSinceLastJob === 0 ? "today" : `${c.daysSinceLastJob}d ago`}
                    </td>
                    <td className="r" style={{ fontFamily: mono }}>{c.activeJobs || <span style={{ color: T.faint }}>—</span>}</td>
                    <td className="r">
                      {c.avgPayDelay === null ? (
                        <span style={{ color: T.faint }}>—</span>
                      ) : (
                        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", color: c.avgPayDelay <= 3 ? T.green : c.avgPayDelay <= 15 ? T.amber : T.red }}>
                          {c.avgPayDelay <= 0 ? "ON TIME" : `+${Math.round(c.avgPayDelay)}d LATE`}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="gm-meter">
                          <div className="gm-meter-fill" style={{ width: `${c.healthScore}%`, background: c.healthScore >= 70 ? T.green : c.healthScore >= 40 ? T.amber : T.red }} />
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, minWidth: 22 }}>{c.healthScore}</span>
                      </div>
                    </td>
                    <td className="r">
                      {c.churnRisk === "high" && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: T.red }}>CHURN</span>}
                      {c.churnRisk === "medium" && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: T.amber }}>COOLING</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clientStats.length === 0 && <div className="gm-empty">No clients with revenue yet.</div>}
          </div>
          <Reads>jobs · payment_records · costing_summary · clients · health = recency·0.4 + margin·0.3 + pay·0.2 + frequency·0.1</Reads>
        </div>
      </section>

      )}

      {/* ── 2. Decorator Scorecard ── */}
      {active === "decorators" && (
      <section className="gm-section">
        <SectionHead title="Decorator Scorecard" hint="Items shipped in the last 90 days">
          <CsvBtn onClick={() => downloadCsv("god-mode-decorator-scorecard.csv", decoratorStats.map(d => ({
            decorator: d.shortCode, active_load: d.activeLoad,
            avg_turnaround_days: d.avgTurnaround === null ? "" : d.avgTurnaround.toFixed(1),
            avg_variance_pct: d.avgVariancePct === null ? "" : (d.avgVariancePct * 100).toFixed(2),
            avg_revisions: d.avgRevisions === null ? "" : d.avgRevisions.toFixed(2),
            completed_count_90d: d.completedCount,
          })))} />
        </SectionHead>
        <div className="gm-card">
          <div style={{ overflowX: "auto" }}>
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Decorator</th>
                  <th className="r">Active Load</th>
                  <th className="r">Avg Turnaround</th>
                  <th className="r">Variance %</th>
                  <th className="r">Revision Rounds</th>
                  <th className="r">Completed 90d</th>
                </tr>
              </thead>
              <tbody>
                {decoratorStats.map(d => (
                  <tr key={d.id} className="gm-row" onClick={() => setModalDecorator(d)}>
                    <td style={{ fontWeight: 700 }}>{d.shortCode}</td>
                    <td className="r" style={{ fontFamily: mono }}>{d.activeLoad || <span style={{ color: T.faint }}>—</span>}</td>
                    <td className="r" style={{ fontFamily: mono }}>{d.avgTurnaround === null ? <span style={{ color: T.faint }}>—</span> : `${d.avgTurnaround.toFixed(1)}d`}</td>
                    <td className="r" style={{ fontFamily: mono, fontWeight: 700, color: d.avgVariancePct === null ? T.faint : varianceColor(d.avgVariancePct) }}>
                      {d.avgVariancePct === null ? "—" : fmtPct(d.avgVariancePct)}
                    </td>
                    <td className="r" style={{ fontFamily: mono }}>{d.avgRevisions === null ? <span style={{ color: T.faint }}>—</span> : d.avgRevisions.toFixed(1)}</td>
                    <td className="r" style={{ fontFamily: mono, color: T.muted }}>{d.completedCount || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {decoratorStats.length === 0 && <div className="gm-empty">No decorator data yet.</div>}
          </div>
          <Reads>decorator_assignments · items.pipeline_timestamps · items.ship_qtys vs buy_sheet_lines.qty_ordered · item_files (revision_requested)</Reads>
        </div>
      </section>

      )}

      {/* ── 3. Cash Flow 90d ── */}
      {active === "cash" && (
      <section className="gm-section">
        <SectionHead title="Cash Flow" hint="Expected inflow from active projects, next 13 weeks">
          <CsvBtn onClick={() => downloadCsv("god-mode-cashflow.csv", upcomingPayments.map(p => ({
            expected_date: p.expectedIso, client: p.clientName, project: p.jobTitle,
            amount: p.amount.toFixed(2), invoice_number: p.invoiceNum || "",
          })))} />
        </SectionHead>
        <div className="gm-card" style={{ padding: "22px 24px" }}>
          {(() => {
            const max = Math.max(...weekBuckets, 1);
            return (
              <div className="gm-chart">
                {weekBuckets.map((amt, i) => (
                  <div key={i} className="gm-chart-col" onClick={() => amt > 0 && setModalCashWeek(i)} style={{ cursor: amt > 0 ? "pointer" : "default" }}>
                    <div className="gm-chart-val" style={{ color: amt > 0 ? T.muted : "transparent" }}>{amt > 0 ? fmtDk(amt) : "·"}</div>
                    <div className="gm-chart-track">
                      <div className={`gm-chart-bar${amt > 0 ? "" : " zero"}`} style={{ height: `${Math.max(3, (amt / max) * 100)}%`, animationDelay: `${i * 35}ms` }} />
                    </div>
                    <div className="gm-chart-x">{weekLabels[i]}</div>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="gm-chart-total">
            <span style={{ color: T.muted }}>90-day expected inflow</span>
            <span style={{ fontFamily: mono, color: T.green, fontWeight: 800, fontSize: 16 }}>{fmtD(totalExpectedInflow)}</span>
          </div>

          {upcomingPayments.length > 0 && (
            <>
              <div className="gm-subhead">Next 20 expected payments</div>
              <div style={{ overflowX: "auto" }}>
                <table className="gm-table">
                  <thead>
                    <tr>
                      <th>Expected</th>
                      <th>Client</th>
                      <th>Project</th>
                      <th className="r">Amount</th>
                      <th className="r">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingPayments.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: mono, color: T.muted }}>{fmtDateIso(p.expectedIso)}</td>
                        <td style={{ fontWeight: 700 }}>{p.clientName}</td>
                        <td style={{ color: T.muted }}>{p.jobTitle}</td>
                        <td className="r" style={{ fontFamily: mono, fontWeight: 700 }}>{fmtD(p.amount)}</td>
                        <td className="r" style={{ color: T.muted, fontFamily: mono }}>{p.invoiceNum ? `#${p.invoiceNum}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <Reads>jobs.target_ship_date · payment_terms · type_meta.qb_total_with_tax · costing_summary.grossRev · payment_records</Reads>
        </div>
      </section>

      )}

      {/* ── 4. Client 80/20 ── */}
      {active === "pareto" && (
      <section className="gm-section">
        <SectionHead title="Client 80/20" hint={`${pareto.top.length} ${pareto.top.length === 1 ? "client drives" : "clients drive"} 80% of profit`}>
          <CsvBtn onClick={() => downloadCsv("god-mode-pareto.csv", [
            ...pareto.top.map((c, i) => ({ rank: i + 1, client: c.name, profit: c.profit.toFixed(2), pct_of_profit: pareto.totalProfit > 0 ? (c.profit / pareto.totalProfit * 100).toFixed(2) : "0", in_top_80_pct: "yes" })),
            ...(pareto.restCount > 0 ? [{ rank: "rest", client: `${pareto.restCount} other clients`, profit: pareto.restProfit.toFixed(2), pct_of_profit: pareto.totalProfit > 0 ? (pareto.restProfit / pareto.totalProfit * 100).toFixed(2) : "0", in_top_80_pct: "no" }] : []),
          ])} />
        </SectionHead>
        <div className="gm-card" style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pareto.top.map((c, i) => {
              const pct = pareto.totalProfit > 0 ? (c.profit / pareto.totalProfit) * 100 : 0;
              const clientStat = clientStats.find(cs => cs.name === c.name);
              return (
                <div key={i} className="gm-pareto-row" onClick={() => clientStat && setModalClient(clientStat)} style={{ cursor: clientStat ? "pointer" : "default" }}>
                  <span className="gm-pareto-name">{c.name}</span>
                  <div className="gm-pareto-track">
                    <div className="gm-pareto-fill" style={{ width: `${pct}%`, animationDelay: `${i * 50}ms` }} />
                  </div>
                  <span className="gm-pareto-val">{fmtD(c.profit)} · {pct.toFixed(1)}%</span>
                </div>
              );
            })}
            {pareto.restCount > 0 && (
              <div className="gm-pareto-row" style={{ opacity: 0.55, marginTop: 4, paddingTop: 10, borderTop: `1px solid ${T.surface}` }}>
                <span className="gm-pareto-name" style={{ color: T.muted, fontWeight: 500 }}>Next {pareto.restCount} {pareto.restCount === 1 ? "client" : "clients"}</span>
                <div className="gm-pareto-track">
                  <div className="gm-pareto-fill rest" style={{ width: `${pareto.totalProfit > 0 ? (pareto.restProfit / pareto.totalProfit) * 100 : 0}%` }} />
                </div>
                <span className="gm-pareto-val">{fmtD(pareto.restProfit)} · {pareto.totalProfit > 0 ? ((pareto.restProfit / pareto.totalProfit) * 100).toFixed(1) : "0"}%</span>
              </div>
            )}
          </div>
          <Reads>costing_summary.grossRev − costing_summary.totalCost grouped by clients.id (cancelled jobs excluded)</Reads>
        </div>
      </section>

      )}

      {/* ── 5. Margin by Category ── */}
      {active === "margin" && (
      <section className="gm-section">
        <SectionHead title="Margin by Category" hint="Revenue + cost per garment type">
          {backfillResult && (
            <span style={{ fontSize: 10.5, color: backfillStatus === "error" ? T.red : T.green, marginRight: 4 }}>{backfillResult}</span>
          )}
          <button onClick={runBackfill} disabled={backfillStatus === "running"} className="gm-backfill">
            {backfillStatus === "running" ? "Backfilling…" : "Backfill exact costs"}
          </button>
          <CsvBtn onClick={() => downloadCsv("god-mode-margin-by-category.csv", categories.map(c => ({
            garment_type: c.garmentType, revenue: c.revenue.toFixed(2), cost: c.cost.toFixed(2),
            profit: (c.revenue - c.cost).toFixed(2), margin_pct: (c.marginPct * 100).toFixed(2),
            units: c.units, job_count: c.jobCount,
            exact_cost_coverage: (c.exactCostCoverage * 100).toFixed(0) + "%",
          })))} />
        </SectionHead>
        <div className="gm-card" style={{ padding: "14px 22px" }}>
          {categories.map((c, idx) => {
            const fillPct = Math.max(0, Math.min(100, c.marginPct * 100));
            const loss = c.marginPct < 0;
            return (
              <div key={c.garmentType} className="gm-cat-row" onClick={() => setModalCategory(c)}>
                <span className="gm-cat-name">{garmentLabel(c.garmentType)}</span>
                <div className="gm-cat-track">
                  <div className="gm-cat-fill" style={{ width: `${loss ? 100 : fillPct}%`, background: loss ? T.red : T.green, animationDelay: `${idx * 45}ms` }} />
                </div>
                <span className="gm-cat-val">
                  <span style={{ fontWeight: 700, color: T.text }}>{fmtD(c.revenue)}</span>
                  <span style={{ color: marginColor(c.marginPct), fontWeight: 700, margin: "0 6px" }}>{fmtPct(c.marginPct)}</span>
                  <span style={{ color: T.muted }}>{c.units.toLocaleString()}u</span>
                  {c.exactCostCoverage < 1 && (
                    <span style={{ color: T.amber, marginLeft: 6 }} title="Some items use proportional cost allocation">({Math.round(c.exactCostCoverage * 100)}% exact)</span>
                  )}
                </span>
              </div>
            );
          })}
          {categories.length === 0 && <div className="gm-empty">No category data yet.</div>}
          <Reads>items.garment_type · sell_per_unit × qty_ordered (revenue) · cost_per_unit_all_in when saved, else allocated from costing_summary.totalCost</Reads>
        </div>
      </section>
      )}

      {/* ── 6. AR Aging ── */}
      {active === "ar" && (
      <section className="gm-section">
        <SectionHead title="AR Aging" hint="Outstanding receivables by age — jobs + ShipStation invoices">
          <CsvBtn onClick={() => downloadCsv("god-mode-ar-aging.csv", [
            { bucket: "current", amount: ar.current.toFixed(2) },
            { bucket: "1-30d", amount: ar.d30.toFixed(2) },
            { bucket: "31-60d", amount: ar.d60.toFixed(2) },
            { bucket: "60d+", amount: ar.d90plus.toFixed(2) },
          ])} />
        </SectionHead>
        <div className="gm-card" style={{ padding: "18px 22px" }}>
          <div className="gm-ar-grid">
            {[
              { label: "Current", val: ar.current, color: T.green },
              { label: "1–30 days", val: ar.d30, color: T.amber },
              { label: "31–60 days", val: ar.d60, color: "#e8862b" },
              { label: "60+ days", val: ar.d90plus, color: T.red },
            ].map(b => (
              <div key={b.label} className="gm-ar-card">
                <div className="gm-ar-bar" style={{ background: b.color }} />
                <div className="gm-ar-amt" style={{ color: b.val > 0 ? b.color : T.faint }}>{fmtD(b.val)}</div>
                <div className="gm-ar-label">{b.label}</div>
                <div className="gm-ar-pct">{arTotal > 0 ? Math.round((b.val / arTotal) * 100) : 0}% of AR</div>
              </div>
            ))}
          </div>
          <div className="gm-chart-total">
            <span style={{ color: T.muted }}>Total outstanding</span>
            <span style={{ fontFamily: mono, color: ar.d90plus > 0 ? T.red : T.text, fontWeight: 800, fontSize: 16 }}>{fmtD(arTotal)}</span>
          </div>
          <Reads>jobs (effectiveRevenue − paid) + unpaid shipstation_reports, bucketed by oldest unpaid due date</Reads>
        </div>
      </section>
      )}

      {/* ── 7. Production Health ── */}
      {active === "production" && (
      <section className="gm-section">
        <SectionHead title="Production Health" hint="Cycle times, bottleneck, and stalled items" />
        <div className="gm-card" style={{ padding: "18px 22px" }}>
          <div className="gm-prod-stats">
            <div className="gm-prod-stat">
              <div className="gm-prod-stat-val">{operations.production.avgCycleTime}d</div>
              <div className="gm-prod-stat-label">Avg cycle · intake → complete</div>
            </div>
            <div className="gm-prod-stat">
              <div className="gm-prod-stat-val" style={{ color: T.amber }}>{operations.production.bottleneck ? phaseLabel(operations.production.bottleneck.phase) : "—"}</div>
              <div className="gm-prod-stat-label">{operations.production.bottleneck ? `Slowest phase · ${operations.production.bottleneck.days}d` : "No bottleneck data"}</div>
            </div>
            <div className="gm-prod-stat">
              <div className="gm-prod-stat-val" style={{ color: operations.production.stalled.length ? T.red : T.green }}>{operations.production.stalled.length}</div>
              <div className="gm-prod-stat-label">Stalled items · 7d+ in stage</div>
            </div>
          </div>

          <div className="gm-subhead">Active projects by phase</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sortedActivePhases.map(([ph, count]) => (
              <div key={ph} className="gm-pareto-row">
                <span className="gm-pareto-name" style={{ width: 130 }}>{phaseLabel(ph)}</span>
                <div className="gm-pareto-track">
                  <div className="gm-pareto-fill" style={{ width: `${(count / maxPhaseCount) * 100}%`, background: T.blue }} />
                </div>
                <span className="gm-pareto-val" style={{ width: 150 }}>{count} active{operations.production.avgPhaseTimes[ph] ? ` · ${operations.production.avgPhaseTimes[ph]}d avg` : ""}</span>
              </div>
            ))}
            {sortedActivePhases.length === 0 && <div className="gm-empty">No active projects.</div>}
          </div>

          {operations.production.stalled.length > 0 && (
            <>
              <div className="gm-subhead">Stalled items — longest first</div>
              <div style={{ overflowX: "auto" }}>
                <table className="gm-table">
                  <thead><tr><th>Item</th><th>Project</th><th>Client</th><th>Stage</th><th className="r">Days</th></tr></thead>
                  <tbody>
                    {operations.production.stalled.slice(0, 25).map((s, i) => (
                      <tr key={i} className="gm-row" onClick={() => { window.location.href = `/jobs/${s.jobId}`; }}>
                        <td style={{ fontWeight: 700 }}>{s.name}</td>
                        <td style={{ color: T.muted }}>{s.jobTitle}</td>
                        <td style={{ color: T.muted }}>{s.clientName}</td>
                        <td style={{ color: T.muted }}>{phaseLabel(s.stage)}</td>
                        <td className="r" style={{ fontFamily: mono, fontWeight: 700, color: s.days >= 14 ? T.red : T.amber }}>{s.days}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <Reads>jobs.phase_timestamps (cycle + bottleneck) · active jobs by phase · items 7d+ in pipeline_stage</Reads>
        </div>
      </section>
      )}

      {/* ── 8. Payment Attention ── */}
      {active === "paymentsAttn" && (
      <section className="gm-section">
        <SectionHead title="Payment Attention" hint="Overdue now + due in the next 30 days">
          <CsvBtn onClick={() => downloadCsv("god-mode-payments-attention.csv", [
            ...operations.payments.overdue.map(p => ({ status: "overdue", client: p.clientName, project: p.jobTitle, amount: p.amount.toFixed(2), due: p.dueDate, days_over: p.daysOver })),
            ...operations.payments.upcoming.map(p => ({ status: "upcoming", client: p.clientName, project: p.jobTitle, amount: p.amount.toFixed(2), due: p.dueDate, days_over: "" })),
          ])} />
        </SectionHead>
        <div className="gm-card">
          <div className="gm-subhead" style={{ color: T.red }}>Overdue ({operations.payments.overdue.length})</div>
          {operations.payments.overdue.length === 0 ? <div className="gm-empty">Nothing overdue — all clear.</div> : (
            <div style={{ overflowX: "auto" }}>
              <table className="gm-table">
                <thead><tr><th>Client</th><th>Project</th><th className="r">Amount</th><th className="r">Due</th><th className="r">Overdue</th></tr></thead>
                <tbody>
                  {operations.payments.overdue.map((p, i) => (
                    <tr key={i} className="gm-row" onClick={() => { window.location.href = `/jobs/${p.jobId}`; }}>
                      <td style={{ fontWeight: 700 }}>{p.clientName}</td>
                      <td style={{ color: T.muted }}>{p.jobTitle}</td>
                      <td className="r" style={{ fontFamily: mono, fontWeight: 700 }}>{fmtD(p.amount)}</td>
                      <td className="r" style={{ fontFamily: mono, color: T.muted }}>{fmtDateIso(p.dueDate)}</td>
                      <td className="r" style={{ fontFamily: mono, fontWeight: 700, color: T.red }}>{p.daysOver}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="gm-subhead" style={{ marginTop: 18 }}>Due next 30 days ({operations.payments.upcoming.length})</div>
          {operations.payments.upcoming.length === 0 ? <div className="gm-empty">Nothing due in the next 30 days.</div> : (
            <div style={{ overflowX: "auto" }}>
              <table className="gm-table">
                <thead><tr><th>Client</th><th>Project</th><th className="r">Amount</th><th className="r">Due</th></tr></thead>
                <tbody>
                  {operations.payments.upcoming.map((p, i) => (
                    <tr key={i} className="gm-row" onClick={() => { window.location.href = `/jobs/${p.jobId}`; }}>
                      <td style={{ fontWeight: 700 }}>{p.clientName}</td>
                      <td style={{ color: T.muted }}>{p.jobTitle}</td>
                      <td className="r" style={{ fontFamily: mono, fontWeight: 700 }}>{fmtD(p.amount)}</td>
                      <td className="r" style={{ fontFamily: mono, color: T.muted }}>{fmtDateIso(p.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Reads>payment_records · status ≠ paid/void · due_date past (overdue) or within 30 days (upcoming)</Reads>
        </div>
      </section>
      )}

      {/* ── Modals ── */}
      {modalClient && (
        <Modal title={modalClient.name} subtitle={`${modalClient.ytdJobs} jobs YTD · health ${modalClient.healthScore}/100`} onClose={() => setModalClient(null)}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
            <CsvBtn onClick={() => downloadCsv(`${modalClient.name.replace(/\W+/g, "-")}-jobs.csv`, (details.clientJobs[modalClient.clientId] || []).map(j => ({
              job_title: j.title, phase: j.phase, created: j.createdAt,
              gross_rev: j.grossRev.toFixed(2), total_cost: j.totalCost.toFixed(2),
              margin_pct: (j.marginPct * 100).toFixed(2),
              paid: j.paid.toFixed(2), outstanding: j.outstanding.toFixed(2),
            })))} />
          </div>
          <table className="gm-table">
            <thead>
              <tr>
                <th>Job</th><th>Phase</th><th>Created</th>
                <th className="r">Revenue</th><th className="r">Cost</th><th className="r">Margin</th><th className="r">Paid</th><th className="r">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(details.clientJobs[modalClient.clientId] || []).map((j, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}><a href={detailHref(j)} className="gm-link">{j.title}</a></td>
                  <td style={{ color: T.muted }}>{j.phase}</td>
                  <td style={{ color: T.muted, fontFamily: mono }}>{fmtDateIso(j.createdAt)}</td>
                  <td className="r" style={{ fontFamily: mono }}>{fmtD(j.grossRev)}</td>
                  <td className="r" style={{ fontFamily: mono, color: T.muted }}>{fmtD(j.totalCost)}</td>
                  <td className="r" style={{ fontFamily: mono, fontWeight: 700, color: marginColor(j.marginPct) }}>{fmtPct(j.marginPct)}</td>
                  <td className="r" style={{ fontFamily: mono, color: T.green }}>{fmtD(j.paid)}</td>
                  <td className="r" style={{ fontFamily: mono, color: j.outstanding > 0 ? T.amber : T.muted }}>{fmtD(j.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modalDecorator && (
        <Modal title={modalDecorator.shortCode} subtitle={`${modalDecorator.activeLoad} active · ${modalDecorator.completedCount} shipped (90d)`} onClose={() => setModalDecorator(null)}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
            <CsvBtn onClick={() => downloadCsv(`${modalDecorator.shortCode.replace(/\W+/g, "-")}-items.csv`, (details.decoratorItems[modalDecorator.id] || []).map(it => ({
              item: it.name, project: it.jobTitle, client: it.clientName,
              turnaround_days: it.turnaroundDays ?? "",
              variance_pct: it.variancePct === null ? "" : (it.variancePct * 100).toFixed(2),
              revision_count: it.revisionCount,
            })))} />
          </div>
          <table className="gm-table">
            <thead>
              <tr>
                <th>Item</th><th>Project</th><th>Client</th>
                <th className="r">Turnaround</th><th className="r">Variance</th><th className="r">Revisions</th>
              </tr>
            </thead>
            <tbody>
              {(details.decoratorItems[modalDecorator.id] || []).map((it, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{it.name}</td>
                  <td style={{ color: T.muted }}>{it.jobTitle}</td>
                  <td style={{ color: T.muted }}>{it.clientName}</td>
                  <td className="r" style={{ fontFamily: mono }}>{it.turnaroundDays === null ? "—" : `${it.turnaroundDays}d`}</td>
                  <td className="r" style={{ fontFamily: mono, color: it.variancePct === null ? T.muted : varianceColor(it.variancePct) }}>{it.variancePct === null ? "—" : fmtPct(it.variancePct)}</td>
                  <td className="r" style={{ fontFamily: mono, color: T.muted }}>{it.revisionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modalCashWeek !== null && (
        <Modal title={`Cash Flow — ${weekLabels[modalCashWeek]}`} subtitle={`Expected inflow: ${fmtD(weekBuckets[modalCashWeek])}`} onClose={() => setModalCashWeek(null)}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
            <CsvBtn onClick={() => downloadCsv(`cashflow-${weekLabels[modalCashWeek!]}.csv`, (details.cashByWeek[modalCashWeek!] || []).map(p => ({
              expected_date: p.expectedIso, client: p.clientName, project: p.jobTitle,
              amount: p.amount.toFixed(2), invoice: p.invoiceNum || "",
            })))} />
          </div>
          <table className="gm-table">
            <thead>
              <tr>
                <th>Expected</th><th>Client</th><th>Project</th><th className="r">Amount</th><th className="r">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {(details.cashByWeek[modalCashWeek] || []).map((p, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: mono, color: T.muted }}>{fmtDateIso(p.expectedIso)}</td>
                  <td style={{ fontWeight: 700 }}><a href={detailHref(p)} className="gm-link">{p.clientName}</a></td>
                  <td style={{ color: T.muted }}>{p.jobTitle}</td>
                  <td className="r" style={{ fontFamily: mono, fontWeight: 700 }}>{fmtD(p.amount)}</td>
                  <td className="r" style={{ color: T.muted, fontFamily: mono }}>{p.invoiceNum ? `#${p.invoiceNum}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modalCategory && (
        <Modal title={garmentLabel(modalCategory.garmentType)} subtitle={`${modalCategory.units.toLocaleString()} units · ${fmtD(modalCategory.revenue)} revenue · ${fmtPct(modalCategory.marginPct)} margin`} onClose={() => setModalCategory(null)}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
            {modalCategory.exactCostCoverage < 1 && (
              <span style={{ fontSize: 10.5, color: T.amber }}>{Math.round(modalCategory.exactCostCoverage * 100)}% exact · rest allocated proportionally</span>
            )}
            <CsvBtn onClick={() => downloadCsv(`${modalCategory.garmentType}-items.csv`, (details.categoryItems[modalCategory.garmentType] || []).map(it => ({
              item: it.name, project: it.jobTitle, client: it.clientName,
              units: it.units, revenue: it.revenue.toFixed(2), cost: it.cost.toFixed(2),
              margin_pct: (it.marginPct * 100).toFixed(2), cost_source: it.exact ? "exact" : "proportional",
            })))} />
          </div>
          <table className="gm-table">
            <thead>
              <tr>
                <th>Item</th><th>Project</th><th>Client</th>
                <th className="r">Units</th><th className="r">Revenue</th><th className="r">Cost</th><th className="r">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(details.categoryItems[modalCategory.garmentType] || []).map((it, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{it.name} {!it.exact && <span style={{ color: T.amber, fontSize: 9 }} title="Proportional allocation">~</span>}</td>
                  <td style={{ color: T.muted }}>{it.jobTitle}</td>
                  <td style={{ color: T.muted }}>{it.clientName}</td>
                  <td className="r" style={{ fontFamily: mono }}>{it.units.toLocaleString()}</td>
                  <td className="r" style={{ fontFamily: mono }}>{fmtD(it.revenue)}</td>
                  <td className="r" style={{ fontFamily: mono, color: T.muted }}>{fmtD(it.cost)}</td>
                  <td className="r" style={{ fontFamily: mono, fontWeight: 700, color: marginColor(it.marginPct) }}>{fmtPct(it.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

// ── Scoped styles (theme tokens injected as CSS vars on .gm-root) ──
const GM_CSS = `
.gm-root { font-family: var(--font); color: var(--text); max-width: 1320px; margin: 0 auto; padding: 28px 28px 90px; }
@media (max-width: 767px) { .gm-root { padding: 18px 14px 70px; } }

.gm-hero { margin-bottom: 4px; }
.gm-eyebrow { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 800; color: var(--green); display: inline-flex; align-items: center; gap: 6px; }
.gm-title { font-size: 32px; font-weight: 800; letter-spacing: -0.03em; margin: 8px 0 4px; }
@media (max-width: 767px) { .gm-title { font-size: 26px; } }
.gm-subtitle { color: var(--muted); font-size: 13px; }

.gm-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin: 24px 0 38px; }
@media (max-width: 1100px) { .gm-kpis { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px) { .gm-kpis { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
.gm-kpi { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 15px 16px 14px; box-shadow: 0 1px 2px rgba(16,18,32,0.05); opacity: 0; animation: gm-rise 0.55s cubic-bezier(.2,.7,.2,1) forwards; }
.gm-kpi-label { font-size: 9.5px; letter-spacing: 0.09em; text-transform: uppercase; font-weight: 700; color: var(--faint); margin-bottom: 9px; }
.gm-kpi-value { font-size: 26px; font-weight: 800; font-family: var(--mono); letter-spacing: -0.02em; line-height: 1; }
@media (max-width: 600px) { .gm-kpi-value { font-size: 22px; } }
.gm-kpi-sub { font-size: 11px; color: var(--muted); margin-top: 7px; }

/* section selector chips */
.gm-nav-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 26px; }
@media (max-width: 1100px) { .gm-nav-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px) { .gm-nav-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
.gm-nav { text-align: left; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px 15px; cursor: pointer; font-family: var(--font); box-shadow: 0 1px 2px rgba(16,18,32,0.05); transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease; display: flex; flex-direction: column; gap: 8px; }
.gm-nav:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(16,18,32,0.10); }
.gm-nav.active { border-color: var(--nav-accent); box-shadow: 0 0 0 1px var(--nav-accent), 0 8px 20px rgba(16,18,32,0.10); }
.gm-nav-title { font-size: 12px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 7px; }
.gm-nav-title::before { content: ""; width: 8px; height: 8px; border-radius: 3px; background: var(--nav-accent); flex-shrink: 0; }
.gm-nav-value { font-size: 22px; font-weight: 800; font-family: var(--mono); letter-spacing: -0.02em; line-height: 1; color: var(--text); }
.gm-nav-sub { font-size: 11px; color: var(--muted); }
.gm-spark { display: flex; align-items: flex-end; gap: 2px; height: 26px; }
.gm-spark-bar { flex: 1; border-radius: 2px 2px 0 0; min-height: 2px; }
.gm-navgroup-label { font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); margin: 2px 2px 10px; }

/* AR aging cards */
.gm-ar-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 600px) { .gm-ar-grid { grid-template-columns: repeat(2, 1fr); } }
.gm-ar-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; position: relative; overflow: hidden; }
.gm-ar-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.gm-ar-amt { font-size: 20px; font-weight: 800; font-family: var(--mono); letter-spacing: -0.02em; }
.gm-ar-label { font-size: 11.5px; font-weight: 700; color: var(--text); margin-top: 7px; }
.gm-ar-pct { font-size: 10px; color: var(--muted); margin-top: 2px; }

/* production stat tiles */
.gm-prod-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 8px; }
@media (max-width: 600px) { .gm-prod-stats { grid-template-columns: 1fr; } }
.gm-prod-stat { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.gm-prod-stat-val { font-size: 22px; font-weight: 800; font-family: var(--mono); letter-spacing: -0.02em; line-height: 1; }
.gm-prod-stat-label { font-size: 11px; color: var(--muted); margin-top: 6px; }

.gm-section { margin-bottom: 30px; }
.gm-sechead { display: flex; align-items: center; gap: 12px; padding-bottom: 9px; margin-bottom: 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.gm-sectitle { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
.gm-sechint { color: var(--muted); font-size: 12px; }
.gm-secactions { margin-left: auto; display: flex; gap: 8px; align-items: center; }

.gm-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 6px 10px; box-shadow: 0 1px 2px rgba(16,18,32,0.05); }

.gm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.gm-table th { text-align: left; padding: 12px 12px; color: var(--faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; border-bottom: 1px solid var(--border); white-space: nowrap; }
.gm-table th.r, .gm-table td.r { text-align: right; }
.gm-table td { padding: 12px; border-bottom: 1px solid var(--surface); white-space: nowrap; }
.gm-table tbody tr:last-child td { border-bottom: none; }
.gm-table tbody tr { transition: background 0.12s ease; }
.gm-row { cursor: pointer; }
.gm-row:hover { background: var(--surface); }
.gm-link { color: var(--text); text-decoration: none; }
.gm-link:hover { text-decoration: underline; }

.gm-meter { width: 64px; height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
.gm-meter-fill { height: 100%; border-radius: 3px; transform-origin: left; animation: gm-stretch 0.7s cubic-bezier(.2,.8,.2,1) both; }

.gm-empty { padding: 28px; text-align: center; color: var(--muted); font-size: 13px; }
.gm-reads { font-size: 10px; color: var(--faint); font-family: var(--mono); margin: 10px 4px 6px; padding-top: 11px; border-top: 1px solid var(--surface); line-height: 1.5; }
.gm-subhead { font-size: 10px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; margin: 18px 4px 6px; }

.gm-csv { padding: 5px 11px; border-radius: 7px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 11px; font-weight: 600; cursor: pointer; font-family: var(--font); transition: background 0.12s, color 0.12s; }
.gm-csv:hover { background: var(--card); color: var(--text); }
.gm-backfill { padding: 5px 11px; border-radius: 7px; background: var(--accent); border: none; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer; font-family: var(--font); transition: opacity 0.12s; }
.gm-backfill:disabled { opacity: 0.5; cursor: wait; }
.gm-backfill:not(:disabled):hover { opacity: 0.85; }

/* cash chart */
.gm-chart { display: flex; align-items: flex-end; gap: 5px; height: 168px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.gm-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
.gm-chart-val { font-family: var(--mono); font-size: 9px; font-weight: 600; }
.gm-chart-track { width: 100%; flex: 1; display: flex; align-items: flex-end; }
.gm-chart-bar { width: 100%; background: linear-gradient(180deg, var(--green), color-mix(in srgb, var(--green) 78%, #000)); border-radius: 4px 4px 0 0; transform-origin: bottom; animation: gm-grow 0.65s cubic-bezier(.2,.8,.2,1) both; transition: filter 0.15s; }
.gm-chart-col:hover .gm-chart-bar { filter: brightness(1.12); }
.gm-chart-bar.zero { background: var(--surface); }
.gm-chart-x { font-size: 9px; color: var(--faint); }
.gm-chart-total { display: flex; justify-content: space-between; align-items: center; padding: 14px 2px 0; font-size: 12.5px; }

/* pareto */
.gm-pareto-row { display: flex; align-items: center; gap: 12px; font-size: 12.5px; }
.gm-pareto-name { width: 200px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.gm-pareto-track { flex: 1; height: 20px; background: var(--surface); border-radius: 6px; overflow: hidden; }
.gm-pareto-fill { height: 100%; background: linear-gradient(90deg, var(--blue), var(--purple)); border-radius: 6px; transform-origin: left; animation: gm-stretch 0.75s cubic-bezier(.2,.8,.2,1) both; }
.gm-pareto-fill.rest { background: var(--faint); }
.gm-pareto-val { font-family: var(--mono); width: 150px; text-align: right; color: var(--muted); flex-shrink: 0; }
@media (max-width: 600px) { .gm-pareto-name { width: 110px; } .gm-pareto-val { width: 96px; font-size: 11px; } }

/* margin category */
.gm-cat-row { display: flex; align-items: center; gap: 12px; padding: 11px 2px; border-bottom: 1px solid var(--surface); cursor: pointer; transition: background 0.12s; border-radius: 6px; }
.gm-cat-row:last-of-type { border-bottom: none; }
.gm-cat-row:hover { background: var(--surface); }
.gm-cat-name { width: 130px; font-size: 12.5px; font-weight: 700; flex-shrink: 0; }
.gm-cat-track { flex: 1; height: 22px; background: var(--surface); border-radius: 6px; overflow: hidden; }
.gm-cat-fill { height: 100%; border-radius: 6px; transform-origin: left; animation: gm-stretch 0.75s cubic-bezier(.2,.8,.2,1) both; }
.gm-cat-val { font-family: var(--mono); width: 230px; text-align: right; font-size: 11.5px; flex-shrink: 0; }
@media (max-width: 600px) { .gm-cat-name { width: 84px; } .gm-cat-val { width: 150px; font-size: 10.5px; } }

/* modal */
.gm-modal-backdrop { position: fixed; inset: 0; background: rgba(16,18,32,0.55); backdrop-filter: blur(3px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; animation: gm-fade 0.18s ease; }
.gm-modal { background: var(--card); border: 1px solid var(--border); border-radius: 16px; max-width: 1000px; width: 100%; max-height: 88vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 24px 70px rgba(16,18,32,0.30); animation: gm-pop 0.2s cubic-bezier(.2,.8,.2,1); }
.gm-modal-head { padding: 18px 22px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.gm-modal-x { background: none; border: none; color: var(--muted); font-size: 24px; line-height: 1; cursor: pointer; padding: 0 4px; transition: color 0.12s; }
.gm-modal-x:hover { color: var(--text); }
.gm-modal-body { padding: 18px 22px 22px; overflow: auto; flex: 1; }

@keyframes gm-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes gm-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes gm-stretch { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes gm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gm-pop { from { opacity: 0; transform: translateY(8px) scale(0.99); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .gm-kpi, .gm-meter-fill, .gm-chart-bar, .gm-pareto-fill, .gm-cat-fill, .gm-modal, .gm-modal-backdrop { animation: none !important; opacity: 1 !important; transform: none !important; }
}
`;

"use client";
import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { effectiveRevenue, effectiveCost } from "@/lib/revenue";

import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
const fmtD = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (n: number) => (n * 100).toFixed(1) + "%";
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export default function InsightsPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [jobs, setJobs] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [decorators, setDecorators] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("jobs").select("id, title, phase, job_type, client_id, payment_terms, target_ship_date, costing_summary, type_meta, phase_timestamps, created_at, clients(name)").order("created_at", { ascending: false }),
      supabase.from("items").select("id, job_id, name, pipeline_stage, pipeline_timestamps, sell_per_unit, cost_per_unit, garment_type, decorator_assignments(decorator_id, decorators(name, short_code))").order("sort_order"),
      supabase.from("payment_records").select("id, job_id, type, amount, status, due_date, paid_date, created_at"),
      supabase.from("decorators").select("id, name, short_code"),
      supabase.from("clients").select("id, name, type"),
    ]).then(([jRes, iRes, pRes, dRes, cRes]) => {
      setJobs(jRes.data || []);
      setItems(iRes.data || []);
      setPayments(pRes.data || []);
      setDecorators(dRes.data || []);
      setClients(cRes.data || []);
      setLoading(false);
    });
  }, []);

  // ── Computed metrics ──
  const metrics = useMemo(() => {
    if (!jobs.length) return null;
    const now = new Date();
    const active = jobs.filter(j => !["complete", "cancelled"].includes(j.phase));
    const completed = jobs.filter(j => j.phase === "complete");

    // Revenue & profit — use QB-adjusted revenue when invoice has been pushed
    // (covers variance-review adjustments). costing_summary.grossRev stays
    // frozen at the original quote after variance, which inflates these numbers.
    const totalRev = jobs.reduce((s, j) => s + effectiveRevenue(j), 0);
    const totalCost = jobs.reduce((s, j) => s + effectiveCost(j), 0);
    const totalProfit = totalRev - totalCost;
    const avgMargin = totalRev > 0 ? totalProfit / totalRev : 0;

    const activeRev = active.reduce((s, j) => s + effectiveRevenue(j), 0);
    const activeProfit = active.reduce((s, j) => s + effectiveRevenue(j) - effectiveCost(j), 0);

    // Cash flow
    const totalPaid = payments.filter(p => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);
    const outstanding = totalRev - totalPaid;

    // AR aging buckets
    const arBuckets = { current: 0, d30: 0, d60: 0, d90plus: 0 };
    for (const j of active) {
      const rev = effectiveRevenue(j);
      if (rev <= 0) continue;
      const jobPaid = payments.filter(p => p.job_id === j.id && p.status === "paid").reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const owed = rev - jobPaid;
      if (owed <= 0) continue;

      // Find the oldest unpaid invoice due date, or use job created_at
      const unpaidPayments = payments.filter(p => p.job_id === j.id && p.status !== "paid" && p.due_date);
      const oldestDue = unpaidPayments.length > 0
        ? unpaidPayments.sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0].due_date
        : j.created_at;
      const daysOld = oldestDue ? daysBetween(oldestDue, now.toISOString()) : 0;

      if (daysOld <= 0) arBuckets.current += owed;
      else if (daysOld <= 30) arBuckets.d30 += owed;
      else if (daysOld <= 60) arBuckets.d60 += owed;
      else arBuckets.d90plus += owed;
    }

    // Profitability by client
    const byClient: Record<string, { name: string; rev: number; cost: number; profit: number; projects: number; units: number }> = {};
    for (const j of jobs) {
      const cid = j.client_id || "unknown";
      const cname = (j.clients as any)?.name || "Unknown";
      if (!byClient[cid]) byClient[cid] = { name: cname, rev: 0, cost: 0, profit: 0, projects: 0, units: 0 };
      byClient[cid].rev += effectiveRevenue(j);
      byClient[cid].cost += effectiveCost(j);
      byClient[cid].profit += effectiveRevenue(j) - effectiveCost(j);
      byClient[cid].projects += 1;
      byClient[cid].units += j.costing_summary?.totalQty || 0;
    }
    const clientRanking = Object.values(byClient).sort((a, b) => b.rev - a.rev);

    // Profitability by decorator
    const byDecorator: Record<string, { name: string; rev: number; items: number; avgDays: number; totalDays: number; completedItems: number; onTime: number; totalOnTime: number }> = {};
    for (const item of items) {
      const da = item.decorator_assignments?.[0];
      if (!da) continue;
      const dname = da.decorators?.name || da.decorators?.short_code || "Unknown";
      const did = da.decorator_id || "unknown";
      if (!byDecorator[did]) byDecorator[did] = { name: dname, rev: 0, items: 0, avgDays: 0, totalDays: 0, completedItems: 0, onTime: 0, totalOnTime: 0 };
      byDecorator[did].items += 1;
      byDecorator[did].rev += (item.sell_per_unit || 0);

      // Turnaround from pipeline_timestamps
      const ts = item.pipeline_timestamps || {};
      if (ts.in_production && ts.shipped) {
        const days = daysBetween(ts.in_production, ts.shipped);
        byDecorator[did].totalDays += days;
        byDecorator[did].completedItems += 1;
      }
    }
    // Calculate averages
    Object.values(byDecorator).forEach(d => {
      d.avgDays = d.completedItems > 0 ? Math.round(d.totalDays / d.completedItems) : 0;
    });
    const decoratorRanking = Object.values(byDecorator).sort((a, b) => b.items - a.items);

    // Production health — cycle times
    const phaseTimes: Record<string, number[]> = {};
    for (const j of completed) {
      const pts = j.phase_timestamps || {};
      const phases = ["intake", "pending", "ready", "production", "complete"];
      for (let i = 0; i < phases.length - 1; i++) {
        if (pts[phases[i]] && pts[phases[i + 1]]) {
          const days = daysBetween(pts[phases[i]], pts[phases[i + 1]]);
          if (days >= 0 && days < 365) {
            if (!phaseTimes[phases[i]]) phaseTimes[phases[i]] = [];
            phaseTimes[phases[i]].push(days);
          }
        }
      }
    }
    const avgPhaseTimes: Record<string, number> = {};
    Object.entries(phaseTimes).forEach(([phase, times]) => {
      avgPhaseTimes[phase] = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    });

    // Full cycle time (intake → complete)
    const fullCycles = completed
      .filter(j => j.phase_timestamps?.intake && j.phase_timestamps?.complete)
      .map(j => daysBetween(j.phase_timestamps.intake, j.phase_timestamps.complete))
      .filter(d => d >= 0 && d < 365);
    const avgCycleTime = fullCycles.length > 0 ? Math.round(fullCycles.reduce((a: number, b: number) => a + b, 0) / fullCycles.length) : 0;

    // Bottleneck detection — which phase takes longest
    const bottleneck = Object.entries(avgPhaseTimes).sort((a, b) => b[1] - a[1])[0];

    // Phase distribution (active projects)
    const phaseCounts: Record<string, number> = {};
    for (const j of active) {
      phaseCounts[j.phase] = (phaseCounts[j.phase] || 0) + 1;
    }

    // Stalled items (7+ days in current phase)
    const stalledItems = items.filter(it => {
      const ts = it.pipeline_timestamps || {};
      const stage = it.pipeline_stage;
      if (!stage || !ts[stage]) return false;
      return daysBetween(ts[stage], now.toISOString()) >= 7;
    });

    // Revenue by month (last 12 months)
    const monthlyRev: { month: string; rev: number; cost: number; profit: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const monthJobs = completed.filter(j => {
        const ct = j.phase_timestamps?.complete;
        if (!ct) return false;
        const cd = new Date(ct);
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      });
      const rev = monthJobs.reduce((s: number, j: any) => s + effectiveRevenue(j), 0);
      const cost = monthJobs.reduce((s: number, j: any) => s + effectiveCost(j), 0);
      monthlyRev.push({ month: label, rev, cost, profit: rev - cost });
    }
    const maxMonthRev = Math.max(...monthlyRev.map(m => m.rev), 1);

    // Profitability by garment type
    const byGarment: Record<string, { rev: number; cost: number; units: number }> = {};
    for (const item of items) {
      const gt = item.garment_type || "other";
      if (!byGarment[gt]) byGarment[gt] = { rev: 0, cost: 0, units: 0 };
      byGarment[gt].rev += item.sell_per_unit || 0;
      byGarment[gt].cost += item.cost_per_unit || 0;
      byGarment[gt].units += 1;
    }

    // Cash flow forecast — expected income from active pipeline by month
    const forecast: { month: string; expected: number; collected: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const endD = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

      // Expected: revenue from active jobs with ship date in this month
      const expected = active
        .filter(j => {
          if (!j.target_ship_date) return false;
          const sd = new Date(j.target_ship_date);
          return sd >= d && sd <= endD;
        })
        .reduce((s: number, j: any) => s + effectiveRevenue(j), 0);

      // Collected: payments received in this month
      const collected = payments
        .filter(p => {
          if (p.status !== "paid" || !p.paid_date) return false;
          const pd = new Date(p.paid_date);
          return pd >= d && pd <= endD;
        })
        .reduce((s: number, p: any) => s + (p.amount || 0), 0);

      forecast.push({ month: label, expected, collected });
    }

    // Upcoming commitments — payments due within 30 days
    const today = now.toISOString().split("T")[0];
    const thirtyDaysOut = new Date(now.getTime() + 30 * 86400000).toISOString().split("T")[0];
    const upcomingPayments = payments
      .filter(p => p.due_date && p.status !== "paid" && p.status !== "void" && p.due_date >= today && p.due_date <= thirtyDaysOut)
      .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
      .map((p: any) => {
        const job = jobs.find(j => j.id === p.job_id);
        return { ...p, jobTitle: job?.title, clientName: (job?.clients as any)?.name, jobNumber: (job as any)?.type_meta?.qb_invoice_number || job?.job_number };
      });

    // Overdue payments
    const overduePayments = payments
      .filter(p => p.due_date && p.status !== "paid" && p.status !== "void" && p.due_date < today)
      .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
      .map((p: any) => {
        const job = jobs.find(j => j.id === p.job_id);
        const daysOver = daysBetween(p.due_date, now.toISOString());
        return { ...p, daysOver, jobTitle: job?.title, clientName: (job?.clients as any)?.name, jobNumber: (job as any)?.type_meta?.qb_invoice_number || job?.job_number };
      });

    return {
      totalRev, totalCost, totalProfit, avgMargin, activeRev, activeProfit, outstanding, totalPaid,
      arBuckets, clientRanking, decoratorRanking, avgPhaseTimes, avgCycleTime,
      bottleneck, phaseCounts, stalledItems, monthlyRev, maxMonthRev,
      activeCount: active.length, completedCount: completed.length, totalJobs: jobs.length,
      byGarment, forecast, upcomingPayments, overduePayments,
    };
  }, [jobs, items, payments]);

  if (loading) {
    return (
      <div style={{ fontFamily: font, color: T.text }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Insights</h1>
        <div style={{ color: T.muted, fontSize: 13 }}>Loading business intelligence...</div>
      </div>
    );
  }
  if (!metrics) {
    return (
      <div style={{ fontFamily: font, color: T.text }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Insights</h1>
        <div style={{ color: T.muted, fontSize: 13 }}>No data yet.</div>
      </div>
    );
  }

  const KPI = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: T.faint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || T.text, fontFamily: mono }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</div>
      {children}
    </div>
  );

  const phaseLabels: Record<string, string> = {
    intake: "Intake", pending: "Pending", ready: "Ready", production: "Production",
    receiving: "Receiving", fulfillment: "Fulfillment", on_hold: "On Hold",
  };

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Insights</h1>
        <span style={{ fontSize: 11, color: T.faint }}>Business intelligence — auto-calculated from all project data</span>
      </div>

      {/* ── KPI Strip ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <KPI label="Total Revenue" value={fmtD(metrics.totalRev)} sub={`${metrics.totalJobs} projects`} />
        <KPI label="Net Profit" value={fmtD(metrics.totalProfit)} color={metrics.totalProfit > 0 ? T.green : T.red} />
        <KPI label="Avg Margin" value={fmtPct(metrics.avgMargin)} color={metrics.avgMargin >= 0.25 ? T.green : metrics.avgMargin >= 0.15 ? T.amber : T.red} />
        <KPI label="Cash Collected" value={fmtD(metrics.totalPaid)} sub={`${fmtD(metrics.outstanding)} outstanding`} color={T.green} />
        <KPI label="Active Pipeline" value={fmtD(metrics.activeRev)} sub={`${metrics.activeCount} projects`} color={T.accent} />
        <KPI label="Avg Turnaround" value={`${metrics.avgCycleTime}d`} sub={metrics.bottleneck ? `Bottleneck: ${phaseLabels[metrics.bottleneck[0]] || metrics.bottleneck[0]} (${metrics.bottleneck[1]}d)` : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        {/* ── Cash Flow & AR Aging ── */}
        <Section title="Cash Flow">
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Current", amount: metrics.arBuckets.current, color: T.green },
              { label: "1–30 days", amount: metrics.arBuckets.d30, color: T.amber },
              { label: "31–60 days", amount: metrics.arBuckets.d60, color: "#f59e0b" },
              { label: "60+ days", amount: metrics.arBuckets.d90plus, color: T.red },
            ].map(b => (
              <div key={b.label} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: b.color, fontFamily: mono }}>{fmtD(b.amount)}</div>
                <div style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>{b.label}</div>
              </div>
            ))}
          </div>
          {/* Collection rate bar */}
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>Collection Rate</div>
          <div style={{ height: 8, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4,
              background: `linear-gradient(90deg, ${T.green}, ${T.accent})`,
              width: `${metrics.totalRev > 0 ? Math.min(100, (metrics.totalPaid / metrics.totalRev) * 100) : 0}%`,
              transition: "width 0.5s",
            }} />
          </div>
          <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>
            {fmtD(metrics.totalPaid)} of {fmtD(metrics.totalRev)} ({metrics.totalRev > 0 ? fmtPct(metrics.totalPaid / metrics.totalRev) : "0%"})
          </div>
        </Section>

        {/* ── Production Health ── */}
        <Section title="Production Health">
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {Object.entries(metrics.phaseCounts).sort((a, b) => {
              const order = ["intake", "pending", "ready", "production", "receiving", "fulfillment", "on_hold"];
              return order.indexOf(a[0]) - order.indexOf(b[0]);
            }).map(([phase, count]) => (
              <div key={phase} style={{
                padding: "6px 12px", borderRadius: 8, background: T.surface,
                textAlign: "center", flex: "1 1 70px", minWidth: 60,
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: T.text }}>{count as number}</div>
                <div style={{ fontSize: 9, color: T.faint }}>{phaseLabels[phase] || phase}</div>
              </div>
            ))}
          </div>

          {/* Phase cycle times */}
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 6 }}>Avg Days Per Phase</div>
          {Object.entries(metrics.avgPhaseTimes).map(([phase, days]) => (
            <div key={phase} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 70, fontSize: 10, color: T.muted }}>{phaseLabels[phase] || phase}</span>
              <div style={{ flex: 1, height: 6, background: T.surface, borderRadius: 3 }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  background: (days as number) > 10 ? T.red : (days as number) > 5 ? T.amber : T.green,
                  width: `${Math.min(100, ((days as number) / 20) * 100)}%`,
                }} />
              </div>
              <span style={{ width: 30, fontSize: 10, fontFamily: mono, color: T.text, textAlign: "right" }}>{days as number}d</span>
            </div>
          ))}

          {metrics.stalledItems.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: T.redDim, borderRadius: 6, fontSize: 11, color: T.red }}>
              {metrics.stalledItems.length} items stalled 7+ days
            </div>
          )}
        </Section>

        {/* ── Cash Flow Forecast ── */}
        <Section title="Cash Flow Forecast (4 months)">
          <div style={{ display: "flex", gap: 12 }}>
            {metrics.forecast.map((f, i) => {
              const maxVal = Math.max(...metrics.forecast.map(x => Math.max(x.expected, x.collected)), 1);
              return (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: T.muted, marginBottom: 6 }}>{f.month}</div>
                  <div style={{ height: 80, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
                    <div style={{
                      width: "35%", borderRadius: "3px 3px 0 0",
                      height: Math.max(2, (f.expected / maxVal) * 70),
                      background: T.accentDim,
                    }} title={`Expected: ${fmtD(f.expected)}`} />
                    <div style={{
                      width: "35%", borderRadius: "3px 3px 0 0",
                      height: Math.max(2, (f.collected / maxVal) * 70),
                      background: T.green,
                    }} title={`Collected: ${fmtD(f.collected)}`} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: mono, color: T.text, marginTop: 4 }}>{fmtD(f.expected)}</div>
                  <div style={{ fontSize: 9, color: T.green }}>{f.collected > 0 ? fmtD(f.collected) + " in" : ""}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 10, color: T.muted }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: T.accentDim }} /> Expected (by ship date)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: T.green }} /> Collected</div>
          </div>
        </Section>

        {/* ── Upcoming & Overdue Payments ── */}
        <Section title="Payments Attention">
          {metrics.overduePayments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.red, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Overdue</div>
              {metrics.overduePayments.map((p: any) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: T.redDim, borderRadius: 6, marginBottom: 4, fontSize: 11 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: T.text }}>{p.clientName}</span>
                    <span style={{ color: T.muted, marginLeft: 6 }}>{p.jobNumber}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: mono, fontWeight: 600, color: T.red }}>{fmtD(p.amount)}</span>
                    <span style={{ fontSize: 10, color: T.red }}>{p.daysOver}d overdue</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {metrics.upcomingPayments.length > 0 ? (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.amber, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Due within 30 days</div>
              {metrics.upcomingPayments.map((p: any) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: T.surface, borderRadius: 6, marginBottom: 4, fontSize: 11 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: T.text }}>{p.clientName}</span>
                    <span style={{ color: T.muted, marginLeft: 6 }}>{p.jobNumber}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: mono, fontWeight: 600, color: T.text }}>{fmtD(p.amount)}</span>
                    <span style={{ fontSize: 10, color: T.muted }}>{new Date(p.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : metrics.overduePayments.length === 0 ? (
            <div style={{ fontSize: 11, color: T.faint }}>No upcoming or overdue payments</div>
          ) : null}
        </Section>

        {/* ── Revenue by Client ── */}
        <Section title="Profitability by Client">
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ textAlign: "left", padding: "6px 0", color: T.faint, fontWeight: 600 }}>Client</th>
                  <th style={{ textAlign: "right", padding: "6px 0", color: T.faint, fontWeight: 600 }}>Revenue</th>
                  <th style={{ textAlign: "right", padding: "6px 0", color: T.faint, fontWeight: 600 }}>Profit</th>
                  <th style={{ textAlign: "right", padding: "6px 0", color: T.faint, fontWeight: 600 }}>Margin</th>
                  <th style={{ textAlign: "right", padding: "6px 0", color: T.faint, fontWeight: 600 }}>Projects</th>
                </tr>
              </thead>
              <tbody>
                {metrics.clientRanking.slice(0, 15).map((c, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "8px 0", fontWeight: 500, color: T.text }}>{c.name}</td>
                    <td style={{ textAlign: "right", padding: "8px 0", fontFamily: mono, color: T.text }}>{fmtD(c.rev)}</td>
                    <td style={{ textAlign: "right", padding: "8px 0", fontFamily: mono, color: c.profit > 0 ? T.green : T.red }}>{fmtD(c.profit)}</td>
                    <td style={{ textAlign: "right", padding: "8px 0", fontFamily: mono, color: c.rev > 0 && c.profit / c.rev >= 0.25 ? T.green : T.amber }}>
                      {c.rev > 0 ? fmtPct(c.profit / c.rev) : "—"}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px 0", color: T.muted }}>{c.projects}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── Decorator Scorecards ── */}
        <Section title="Decorator Performance">
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {metrics.decoratorRanking.length === 0 ? (
              <div style={{ fontSize: 11, color: T.faint }}>No decorator data yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {metrics.decoratorRanking.map((d, i) => (
                  <div key={i} style={{ background: T.surface, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{d.name}</span>
                      <span style={{ fontSize: 10, color: T.muted }}>{d.items} items</span>
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 9, color: T.faint }}>Avg Turnaround</div>
                        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: d.avgDays > 10 ? T.red : d.avgDays > 5 ? T.amber : T.green }}>
                          {d.completedItems > 0 ? `${d.avgDays}d` : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: T.faint }}>Completed</div>
                        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: T.text }}>{d.completedItems}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* ── Revenue Trend ── */}
        <div style={{ gridColumn: "1 / -1" }}>
          <Section title="Monthly Revenue">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160 }}>
              {metrics.monthlyRev.map((m, i) => {
                const h = metrics.maxMonthRev > 0 ? (m.rev / metrics.maxMonthRev) * 140 : 0;
                const profitH = metrics.maxMonthRev > 0 ? (Math.max(0, m.profit) / metrics.maxMonthRev) * 140 : 0;
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div style={{ fontSize: 9, fontFamily: mono, color: T.faint }}>
                      {m.rev > 0 ? fmtD(m.rev) : ""}
                    </div>
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{ position: "relative", width: "80%", height: Math.max(h, 2), borderRadius: "4px 4px 0 0" }}>
                        <div style={{ position: "absolute", bottom: 0, width: "100%", height: Math.max(h, 2), background: T.accentDim, borderRadius: "4px 4px 0 0" }} />
                        <div style={{ position: "absolute", bottom: 0, width: "100%", height: Math.max(profitH, 0), background: T.accent, borderRadius: "4px 4px 0 0", opacity: 0.7 }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 8, color: T.faint, marginTop: 2 }}>{m.month}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: T.muted }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: T.accentDim }} /> Revenue</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: T.accent, opacity: 0.7 }} /> Profit</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

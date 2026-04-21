import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { T, font, mono } from "@/lib/theme";

// Owner-only page. Email-gated (distinct from role=owner so multi-owner
// setups don't auto-expose Jon's financial view).
const OWNER_EMAIL = "jon@housepartydistro.com";

export const dynamic = "force-dynamic";

export default async function GodModePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== OWNER_EMAIL) redirect("/dashboard");

  // ── Fetch ─────────────────────────────────────────────────────────────
  const [
    jobsRes,
    itemsRes,
    paymentsRes,
    decoratorsRes,
    clientsRes,
    proofFilesRes,
  ] = await Promise.all([
    supabase.from("jobs")
      .select("id, title, phase, client_id, payment_terms, target_ship_date, costing_summary, costing_data, type_meta, phase_timestamps, created_at, quote_approved, quote_approved_at")
      .order("created_at", { ascending: false }),
    supabase.from("items")
      .select("id, job_id, name, pipeline_stage, pipeline_timestamps, sell_per_unit, cost_per_unit, garment_type, ship_qtys, buy_sheet_lines(qty_ordered), decorator_assignments(decorator_id)")
      .order("sort_order"),
    supabase.from("payment_records")
      .select("id, job_id, type, amount, status, due_date, paid_date, created_at"),
    supabase.from("decorators").select("id, name, short_code"),
    supabase.from("clients").select("id, name"),
    supabase.from("item_files")
      .select("item_id, stage, approval, created_at")
      .eq("stage", "proof"),
  ]);

  const jobs = jobsRes.data || [];
  const items = itemsRes.data || [];
  const payments = paymentsRes.data || [];
  const decorators = decoratorsRes.data || [];
  const clients = clientsRes.data || [];
  const proofFiles = proofFilesRes.data || [];

  // Lookup maps
  const clientById: Record<string, any> = Object.fromEntries(clients.map(c => [c.id, c]));
  const decoratorById: Record<string, any> = Object.fromEntries(decorators.map(d => [d.id, d]));
  const itemsByJob: Record<string, any[]> = {};
  for (const it of items) {
    if (!itemsByJob[it.job_id]) itemsByJob[it.job_id] = [];
    itemsByJob[it.job_id].push(it);
  }
  const paymentsByJob: Record<string, any[]> = {};
  for (const p of payments) {
    if (!paymentsByJob[p.job_id]) paymentsByJob[p.job_id] = [];
    paymentsByJob[p.job_id].push(p);
  }
  const proofsByItem: Record<string, any[]> = {};
  for (const pf of proofFiles) {
    if (!proofsByItem[pf.item_id]) proofsByItem[pf.item_id] = [];
    proofsByItem[pf.item_id].push(pf);
  }

  const now = new Date();
  const msPerDay = 86400000;
  const daysBetween = (a: string | Date, b: string | Date) =>
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);

  // Revenue-excluded jobs: cancelled never counts toward revenue; on_hold/complete do.
  const revenueJobs = jobs.filter(j => j.phase !== "cancelled");

  // ── 1. CLIENT HEALTH SCOREBOARD ───────────────────────────────────────
  type ClientStat = {
    clientId: string;
    name: string;
    lifetimeRev: number;
    totalCost: number;
    avgMarginPct: number;
    lastJobAt: Date | null;
    daysSinceLastJob: number | null;
    activeJobs: number;
    ytdJobs: number;
    avgPayDelay: number | null; // days; + = late, - = early
    paidPaymentCount: number;
    healthScore: number; // 0-100
    churnRisk: "high" | "medium" | "low" | "cold";
  };

  const ytdCutoff = new Date(now.getFullYear(), 0, 1);
  const clientStats: ClientStat[] = clients.map(c => {
    const clientJobs = revenueJobs.filter(j => j.client_id === c.id);
    const lifetimeRev = clientJobs.reduce((s, j) => s + ((j.costing_summary as any)?.grossRev || 0), 0);
    const totalCost = clientJobs.reduce((s, j) => s + ((j.costing_summary as any)?.totalCost || 0), 0);
    const avgMarginPct = lifetimeRev > 0 ? (lifetimeRev - totalCost) / lifetimeRev : 0;

    // Last job activity: most recent of (shipped/complete timestamp, created_at)
    let lastJobAt: Date | null = null;
    for (const j of clientJobs) {
      const ts = (j.phase_timestamps as any)?.complete || j.created_at;
      const d = ts ? new Date(ts) : null;
      if (d && (!lastJobAt || d > lastJobAt)) lastJobAt = d;
    }
    const daysSinceLastJob = lastJobAt ? daysBetween(lastJobAt, now) : null;

    const activeJobs = clientJobs.filter(j => !["complete", "cancelled"].includes(j.phase)).length;
    const ytdJobs = clientJobs.filter(j => new Date(j.created_at) >= ytdCutoff).length;

    // Pay behavior: for all paid invoices with due_date + paid_date, avg(paid_date - due_date)
    const paidPayments: number[] = [];
    for (const j of clientJobs) {
      const ps = paymentsByJob[j.id] || [];
      for (const p of ps) {
        if (p.status === "paid" && p.paid_date && p.due_date) {
          paidPayments.push(daysBetween(p.due_date, p.paid_date));
        }
      }
    }
    const avgPayDelay = paidPayments.length > 0
      ? paidPayments.reduce((a, b) => a + b, 0) / paidPayments.length
      : null;

    // Health scoring — weighted composite 0-100
    // Recency 40% | Margin 30% | Pay 20% | Frequency 10%
    const recencyScore = daysSinceLastJob === null ? 0
      : daysSinceLastJob <= 30 ? 100
      : daysSinceLastJob <= 60 ? 85
      : daysSinceLastJob <= 90 ? 70
      : daysSinceLastJob <= 180 ? 45
      : daysSinceLastJob <= 365 ? 20
      : 5;

    const marginScore = avgMarginPct >= 0.40 ? 100
      : avgMarginPct >= 0.30 ? 85
      : avgMarginPct >= 0.20 ? 70
      : avgMarginPct >= 0.10 ? 50
      : avgMarginPct >= 0 ? 30
      : 0;

    const payScore = avgPayDelay === null ? 70 // neutral if no data
      : avgPayDelay <= 3 ? 100
      : avgPayDelay <= 10 ? 85
      : avgPayDelay <= 20 ? 60
      : avgPayDelay <= 30 ? 35
      : 10;

    const frequencyScore = ytdJobs >= 6 ? 100
      : ytdJobs >= 3 ? 75
      : ytdJobs >= 2 ? 50
      : ytdJobs >= 1 ? 30
      : 0;

    const healthScore = Math.round(
      recencyScore * 0.4 + marginScore * 0.3 + payScore * 0.2 + frequencyScore * 0.1
    );

    let churnRisk: ClientStat["churnRisk"] = "low";
    if (daysSinceLastJob === null) churnRisk = "cold";
    else if (daysSinceLastJob > 180 && activeJobs === 0) churnRisk = "high";
    else if (daysSinceLastJob > 120 && activeJobs === 0) churnRisk = "medium";

    return {
      clientId: c.id,
      name: c.name,
      lifetimeRev,
      totalCost,
      avgMarginPct,
      lastJobAt,
      daysSinceLastJob,
      activeJobs,
      ytdJobs,
      avgPayDelay,
      paidPaymentCount: paidPayments.length,
      healthScore,
      churnRisk,
    };
  });

  // Sort: active work first (highest health, most jobs), then dormant
  const activeClients = clientStats
    .filter(c => c.lifetimeRev > 0)
    .sort((a, b) => b.healthScore - a.healthScore);

  // ── 2. DECORATOR SCORECARD ────────────────────────────────────────────
  type DecoratorStat = {
    id: string;
    name: string;
    shortCode: string;
    activeLoad: number; // items currently in_production
    avgTurnaround: number | null; // days (last 90d)
    avgVariancePct: number | null;
    avgRevisions: number | null;
    completedCount: number;
  };

  const ninetyDaysAgo = new Date(now.getTime() - 90 * msPerDay);

  const decoratorStats: DecoratorStat[] = decorators.map(d => {
    // Primary assignment = first in the array. Reassignments (rare) use the
    // first decorator. If this misattributes in practice we can switch to
    // most-recent by created_at later.
    const itemsForDecorator = items.filter((it: any) =>
      ((it.decorator_assignments || [])[0]?.decorator_id) === d.id
    );

    const activeLoad = itemsForDecorator.filter((it: any) => it.pipeline_stage === "in_production").length;

    // Turnaround: items shipped in last 90 days with both in_production + shipped timestamps
    const turnarounds: number[] = [];
    const variances: number[] = [];
    const revisionCounts: number[] = [];
    let completedCount = 0;
    for (const it of itemsForDecorator) {
      const ts = (it.pipeline_timestamps as any) || {};
      const inProdAt = ts.in_production;
      const shippedAt = ts.shipped;
      if (inProdAt && shippedAt && new Date(shippedAt) >= ninetyDaysAgo) {
        const d = daysBetween(inProdAt, shippedAt);
        if (d >= 0 && d < 120) {
          turnarounds.push(d);
          completedCount++;

          // Variance: |shipped total - ordered total| / ordered total
          const ordered = ((it as any).buy_sheet_lines || []).reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
          const shippedQtys = ((it as any).ship_qtys || {}) as Record<string, number>;
          const shippedTotal = Object.values(shippedQtys).reduce((s: number, q: any) => s + (Number(q) || 0), 0);
          if (ordered > 0 && shippedTotal > 0) {
            variances.push(Math.abs(shippedTotal - ordered) / ordered);
          }

          // Revision rounds: count of proof files with approval=revision_requested for this item
          const proofs = proofsByItem[it.id] || [];
          const revs = proofs.filter((p: any) => p.approval === "revision_requested").length;
          revisionCounts.push(revs);
        }
      }
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    return {
      id: d.id,
      name: d.name,
      shortCode: d.short_code || d.name,
      activeLoad,
      avgTurnaround: avg(turnarounds),
      avgVariancePct: avg(variances),
      avgRevisions: avg(revisionCounts),
      completedCount,
    };
  });

  // Sort by active load desc, then by completed count (show working decorators first)
  const rankedDecorators = decoratorStats
    .filter(d => d.activeLoad > 0 || d.completedCount > 0)
    .sort((a, b) => b.activeLoad - a.activeLoad || b.completedCount - a.completedCount);

  // ── 3. CASH FLOW 90-DAY FORECAST ──────────────────────────────────────
  // For each active job (not complete/cancelled), project expected cash-in date
  // based on invoice due date (if exists) or ship date + terms days.
  const termsDays: Record<string, number> = {
    net_15: 15, net_30: 30, net_60: 60,
    prepaid: -14, // assume payment ~2 weeks before ship
    deposit_balance: -7,
    due_on_receipt: 0,
  };

  // Exclude intake drafts from the forecast — they have no real ship date
  // yet and default their expected date to now+30, which pads the number.
  const active = jobs.filter(j => !["complete", "cancelled", "on_hold", "intake"].includes(j.phase));
  const forecast: { jobId: string; jobTitle: string; clientName: string; amount: number; expectedDate: Date; invoiceNum: string | null }[] = [];

  for (const j of active) {
    const clientName = clientById[j.client_id]?.name || "Unknown";
    const meta = (j.type_meta as any) || {};
    const qbTotal = meta.qb_total_with_tax || (j.costing_summary as any)?.grossRev || 0;
    if (qbTotal <= 0) continue;

    // If paid, skip (already in)
    const js_payments = paymentsByJob[j.id] || [];
    const paid = js_payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
    const outstanding = qbTotal - paid;
    if (outstanding <= 0) continue;

    // Expected date: first use payment_records with unpaid + due_date
    const unpaidWithDue = js_payments.filter(p => p.status !== "paid" && p.status !== "void" && p.due_date);
    let expectedDate: Date;
    if (unpaidWithDue.length > 0) {
      expectedDate = new Date(unpaidWithDue.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0].due_date);
    } else if (j.target_ship_date) {
      const tsd = new Date(j.target_ship_date);
      const delay = termsDays[j.payment_terms as string] ?? 30;
      expectedDate = new Date(tsd.getTime() + delay * msPerDay);
    } else {
      expectedDate = new Date(now.getTime() + 30 * msPerDay);
    }

    forecast.push({
      jobId: j.id,
      jobTitle: j.title,
      clientName,
      amount: outstanding,
      expectedDate,
      invoiceNum: meta.qb_invoice_number || null,
    });
  }

  // Bucket into 12 weeks
  const weekBuckets: number[] = Array(13).fill(0);
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday start

  for (const f of forecast) {
    const weekIdx = Math.floor((f.expectedDate.getTime() - startOfWeek.getTime()) / (7 * msPerDay));
    if (weekIdx >= 0 && weekIdx < 13) weekBuckets[weekIdx] += f.amount;
  }

  const totalExpectedInflow = weekBuckets.reduce((a, b) => a + b, 0);
  const upcomingPayments = forecast
    .filter(f => f.expectedDate >= now && f.expectedDate.getTime() - now.getTime() <= 90 * msPerDay)
    .sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime())
    .slice(0, 20);

  // ── 4. CLIENT 80/20 PARETO ────────────────────────────────────────────
  const profitByClient = clientStats
    .map(c => ({ name: c.name, profit: c.lifetimeRev - c.totalCost }))
    .filter(c => c.profit > 0)
    .sort((a, b) => b.profit - a.profit);
  const totalProfit = profitByClient.reduce((s, c) => s + c.profit, 0);
  let paretoCutoff = profitByClient.length; // show all if no positive profit
  if (totalProfit > 0) {
    let cum = 0;
    for (let i = 0; i < profitByClient.length; i++) {
      cum += profitByClient[i].profit;
      if (cum / totalProfit >= 0.8) { paretoCutoff = i + 1; break; }
    }
  }
  const top8020 = profitByClient.slice(0, paretoCutoff);
  const restCount = profitByClient.length - paretoCutoff;
  const restProfit = profitByClient.slice(paretoCutoff).reduce((s, c) => s + c.profit, 0);

  // ── 5. MARGIN BY CATEGORY ─────────────────────────────────────────────
  // For each item: revenue = sell_per_unit × ordered units.
  // Cost: proportionally allocated from costing_summary.totalCost by item's
  // revenue share in its job. This is an approximation (assumes same margin
  // on every item within a job) but is the cleanest honest split with what
  // we currently store.
  type CatStat = { garmentType: string; revenue: number; cost: number; units: number; jobCount: Set<string> };
  const byCat: Record<string, CatStat> = {};

  for (const j of revenueJobs) {
    // Skip uncosted jobs — including them would report 100% margin (revenue
    // without cost) and mislead the category breakdown.
    const jobCost = ((j.costing_summary as any)?.totalCost) || 0;
    if (jobCost <= 0) continue;

    const jItems = itemsByJob[j.id] || [];
    if (jItems.length === 0) continue;

    // Compute per-item revenue within this job
    const perItemRev: { it: any; rev: number }[] = [];
    for (const it of jItems) {
      const units = ((it as any).buy_sheet_lines || []).reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
      const spu = parseFloat(it.sell_per_unit) || 0;
      perItemRev.push({ it, rev: spu * units });
    }
    const jobRevSum = perItemRev.reduce((s, x) => s + x.rev, 0);

    for (const { it, rev } of perItemRev) {
      const type = it.garment_type || "uncategorized";
      if (!byCat[type]) byCat[type] = { garmentType: type, revenue: 0, cost: 0, units: 0, jobCount: new Set() };
      const units = ((it as any).buy_sheet_lines || []).reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
      const itemCost = jobRevSum > 0 ? jobCost * (rev / jobRevSum) : 0;
      byCat[type].revenue += rev;
      byCat[type].cost += itemCost;
      byCat[type].units += units;
      byCat[type].jobCount.add(j.id);
    }
  }

  const categories = Object.values(byCat)
    .filter(c => c.revenue > 0)
    .map(c => ({
      ...c,
      marginPct: c.revenue > 0 ? (c.revenue - c.cost) / c.revenue : 0,
      jobCount: c.jobCount.size,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── HELPERS ──────────────────────────────────────────────────────────
  const fmtD = (n: number) => "$" + (Math.round(n) || 0).toLocaleString();
  const fmtPct = (n: number) => (n * 100).toFixed(1) + "%";
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const garmentLabel = (g: string) => g === "uncategorized" ? "Uncategorized" : g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");

  // ── RENDER ────────────────────────────────────────────────────────────
  const card: any = {
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 16,
  };
  const sectionHead: any = {
    display: "flex", alignItems: "baseline", gap: 12,
    borderBottom: `1px solid ${T.border}`, paddingBottom: 8, marginBottom: 16,
  };

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
          {activeClients.length} clients · {active.length} active projects · {fmtD(totalExpectedInflow)} expected next 90 days
        </div>
      </div>

      {/* 1. Client Health Scoreboard */}
      <section style={{ marginBottom: 32 }}>
        <div style={sectionHead}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Client Health</h2>
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            {activeClients.length} clients with lifetime revenue
          </span>
        </div>
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: T.faint, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Client</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Lifetime</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Avg Margin</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Last Job</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Active</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Pay Behavior</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Health</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}></th>
                </tr>
              </thead>
              <tbody>
                {activeClients.map(c => (
                  <tr key={c.clientId}>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono }}>{fmtD(c.lifetimeRev)}</td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono,
                      color: c.avgMarginPct >= 0.3 ? T.green : c.avgMarginPct >= 0.15 ? T.amber : T.red }}>
                      {fmtPct(c.avgMarginPct)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", color: T.muted }}>
                      {c.daysSinceLastJob === null ? "—" : c.daysSinceLastJob === 0 ? "today" : `${c.daysSinceLastJob}d ago`}
                    </td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono }}>
                      {c.activeJobs || "—"}
                    </td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right" }}>
                      {c.avgPayDelay === null ? (
                        <span style={{ color: T.faint, fontSize: 11 }}>—</span>
                      ) : (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                          background: c.avgPayDelay <= 3 ? T.greenDim : c.avgPayDelay <= 15 ? "#3a2a0a" : "#3a0a0a",
                          color: c.avgPayDelay <= 3 ? T.green : c.avgPayDelay <= 15 ? T.amber : T.red,
                        }}>
                          {c.avgPayDelay <= 0 ? "On time" : `+${Math.round(c.avgPayDelay)}d late`}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 6, background: T.surface, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", width: `${c.healthScore}%`,
                            background: c.healthScore >= 70 ? T.green : c.healthScore >= 40 ? T.amber : T.red,
                          }} />
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, minWidth: 22 }}>{c.healthScore}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right" }}>
                      {c.churnRisk === "high" && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: T.red, padding: "2px 8px", borderRadius: 99, background: "#3a0a0a" }}>CHURN</span>
                      )}
                      {c.churnRisk === "medium" && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, padding: "2px 8px", borderRadius: 99, background: "#3a2a0a" }}>COOLING</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {activeClients.length === 0 && (
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
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            Turnaround + variance on items shipped in the last 90 days
          </span>
        </div>
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: T.faint, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Decorator</th>
                <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Active Load</th>
                <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Avg Turnaround</th>
                <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Variance %</th>
                <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Revision Rounds</th>
                <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>Completed 90d</th>
              </tr>
            </thead>
            <tbody>
              {rankedDecorators.map(d => (
                <tr key={d.id}>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, fontWeight: 600 }}>{d.shortCode}</td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono }}>
                    {d.activeLoad || <span style={{ color: T.faint }}>—</span>}
                  </td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono }}>
                    {d.avgTurnaround === null ? <span style={{ color: T.faint }}>—</span> : `${d.avgTurnaround.toFixed(1)}d`}
                  </td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right" }}>
                    {d.avgVariancePct === null ? (
                      <span style={{ color: T.faint, fontFamily: mono }}>—</span>
                    ) : (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: d.avgVariancePct <= 0.02 ? T.greenDim : d.avgVariancePct <= 0.05 ? "#3a2a0a" : "#3a0a0a",
                        color: d.avgVariancePct <= 0.02 ? T.green : d.avgVariancePct <= 0.05 ? T.amber : T.red,
                      }}>
                        {fmtPct(d.avgVariancePct)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono }}>
                    {d.avgRevisions === null ? <span style={{ color: T.faint }}>—</span> : d.avgRevisions.toFixed(1)}
                  </td>
                  <td style={{ padding: "10px", borderBottom: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono, color: T.muted }}>
                    {d.completedCount || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rankedDecorators.length === 0 && (
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
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            Expected inflow from active projects
          </span>
        </div>
        <div style={card}>
          {/* Bars */}
          {(() => {
            const max = Math.max(...weekBuckets, 1);
            return (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                {weekBuckets.map((amt, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: amt > 0 ? T.muted : T.faint }}>
                      {amt > 0 ? `$${Math.round(amt/1000)}k` : ""}
                    </div>
                    <div style={{
                      width: "100%",
                      height: `${Math.max(2, (amt / max) * 110)}px`,
                      background: amt > 0 ? T.green : T.surface,
                      borderRadius: "3px 3px 0 0",
                      opacity: 0.9,
                    }} />
                    <div style={{ fontSize: 9, color: T.faint }}>W{i+1}</div>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 12 }}>
            <span style={{ color: T.muted }}>90-day expected inflow</span>
            <span style={{ fontFamily: mono, color: T.green, fontWeight: 700 }}>{fmtD(totalExpectedInflow)}</span>
          </div>

          {/* Upcoming Payments table */}
          {upcomingPayments.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
                Next 20 Expected Payments
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: T.faint, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Expected</th>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Client</th>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Project</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Amount</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingPayments.map((p, i) => (
                    <tr key={i}>
                      <td style={{ padding: "8px 10px", borderTop: `1px solid ${T.surface}`, fontFamily: mono, color: T.muted }}>
                        {fmtDate(p.expectedDate)}
                      </td>
                      <td style={{ padding: "8px 10px", borderTop: `1px solid ${T.surface}`, fontWeight: 600 }}>{p.clientName}</td>
                      <td style={{ padding: "8px 10px", borderTop: `1px solid ${T.surface}`, color: T.muted }}>{p.jobTitle}</td>
                      <td style={{ padding: "8px 10px", borderTop: `1px solid ${T.surface}`, textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{fmtD(p.amount)}</td>
                      <td style={{ padding: "8px 10px", borderTop: `1px solid ${T.surface}`, textAlign: "right", color: T.muted, fontFamily: mono }}>
                        {p.invoiceNum ? `#${p.invoiceNum}` : "—"}
                      </td>
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
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            {top8020.length} {top8020.length === 1 ? "client drives" : "clients drive"} 80% of profit
          </span>
        </div>
        <div style={card}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {top8020.map((c, i) => {
              const pct = totalProfit > 0 ? (c.profit / totalProfit) * 100 : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                  <span style={{ width: 200, fontWeight: 600 }}>{c.name}</span>
                  <div style={{ flex: 1, height: 18, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                    }} />
                  </div>
                  <span style={{ fontFamily: mono, width: 100, textAlign: "right", color: T.muted }}>
                    {fmtD(c.profit)} · {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
            {restCount > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, opacity: 0.6, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.surface}` }}>
                <span style={{ width: 200, color: T.muted }}>Next {restCount} {restCount === 1 ? "client" : "clients"}</span>
                <div style={{ flex: 1, height: 18, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${totalProfit > 0 ? (restProfit / totalProfit) * 100 : 0}%`,
                    background: T.faint,
                  }} />
                </div>
                <span style={{ fontFamily: mono, width: 100, textAlign: "right", color: T.muted }}>
                  {fmtD(restProfit)} · {totalProfit > 0 ? ((restProfit/totalProfit)*100).toFixed(1) : "0"}%
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
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            Revenue + cost per garment type
          </span>
        </div>
        <div style={card}>
          {categories.map(c => {
            const profit = c.revenue - c.cost;
            const total = c.revenue;
            const costPct = total > 0 ? (c.cost / total) * 100 : 0;
            const profitPct = total > 0 ? (profit / total) * 100 : 0;
            return (
              <div key={c.garmentType} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.surface}` }}>
                <span style={{ width: 120, fontSize: 12, fontWeight: 600 }}>{garmentLabel(c.garmentType)}</span>
                <div style={{ flex: 1, height: 22, background: T.surface, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${costPct}%`, background: "#3a0a0a" }} title={`Cost: ${fmtD(c.cost)}`} />
                  <div style={{ width: `${profitPct}%`, background: "#0a3a26" }} title={`Profit: ${fmtD(profit)}`} />
                </div>
                <span style={{ fontFamily: mono, width: 180, textAlign: "right", color: T.muted, fontSize: 11 }}>
                  {fmtD(c.revenue)} · {fmtPct(c.marginPct)} · {c.units.toLocaleString()}u
                </span>
              </div>
            );
          })}
          {categories.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: T.muted, fontSize: 13 }}>No category data yet.</div>
          )}
          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.surface}` }}>
            reads: items.garment_type × sell_per_unit × qty_ordered (revenue) · cost allocated proportionally from job costing_summary.totalCost
          </div>
        </div>
      </section>
    </div>
  );
}

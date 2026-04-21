import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GodModeClient, type ClientStat, type DecoratorStat, type CashRow, type CategoryStat } from "@/components/GodModeClient";
import { effectiveRevenue, effectiveCost } from "@/lib/revenue";

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
      .select("id, job_id, name, pipeline_stage, pipeline_timestamps, sell_per_unit, cost_per_unit, cost_per_unit_all_in, garment_type, ship_qtys, buy_sheet_lines(qty_ordered), decorator_assignments(decorator_id)")
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
  const jobById: Record<string, any> = Object.fromEntries(jobs.map(j => [j.id, j]));
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

  const revenueJobs = jobs.filter(j => j.phase !== "cancelled");

  // ── 1. CLIENT HEALTH ──────────────────────────────────────────────────
  const ytdCutoff = new Date(now.getFullYear(), 0, 1);
  const allClientStats: ClientStat[] = clients.map(c => {
    const clientJobs = revenueJobs.filter(j => j.client_id === c.id);
    const lifetimeRev = clientJobs.reduce((s, j) => s + effectiveRevenue(j), 0);
    const totalCost = clientJobs.reduce((s, j) => s + effectiveCost(j), 0);
    const avgMarginPct = lifetimeRev > 0 ? (lifetimeRev - totalCost) / lifetimeRev : 0;

    let lastJobAt: Date | null = null;
    for (const j of clientJobs) {
      const ts = (j.phase_timestamps as any)?.complete || j.created_at;
      const d = ts ? new Date(ts) : null;
      if (d && (!lastJobAt || d > lastJobAt)) lastJobAt = d;
    }
    const daysSinceLastJob = lastJobAt ? daysBetween(lastJobAt, now) : null;

    const activeJobs = clientJobs.filter(j => !["complete", "cancelled"].includes(j.phase)).length;
    const ytdJobs = clientJobs.filter(j => new Date(j.created_at) >= ytdCutoff).length;

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

    const recencyScore = daysSinceLastJob === null ? 0
      : daysSinceLastJob <= 30 ? 100
      : daysSinceLastJob <= 60 ? 85
      : daysSinceLastJob <= 90 ? 70
      : daysSinceLastJob <= 180 ? 45
      : daysSinceLastJob <= 365 ? 20 : 5;
    const marginScore = avgMarginPct >= 0.40 ? 100
      : avgMarginPct >= 0.30 ? 85
      : avgMarginPct >= 0.20 ? 70
      : avgMarginPct >= 0.10 ? 50
      : avgMarginPct >= 0 ? 30 : 0;
    const payScore = avgPayDelay === null ? 70
      : avgPayDelay <= 3 ? 100
      : avgPayDelay <= 10 ? 85
      : avgPayDelay <= 20 ? 60
      : avgPayDelay <= 30 ? 35 : 10;
    const frequencyScore = ytdJobs >= 6 ? 100
      : ytdJobs >= 3 ? 75
      : ytdJobs >= 2 ? 50
      : ytdJobs >= 1 ? 30 : 0;
    const healthScore = Math.round(recencyScore * 0.4 + marginScore * 0.3 + payScore * 0.2 + frequencyScore * 0.1);

    let churnRisk: ClientStat["churnRisk"] = "low";
    if (daysSinceLastJob === null) churnRisk = "cold";
    else if (daysSinceLastJob > 180 && activeJobs === 0) churnRisk = "high";
    else if (daysSinceLastJob > 120 && activeJobs === 0) churnRisk = "medium";

    return {
      clientId: c.id, name: c.name, lifetimeRev, totalCost, avgMarginPct,
      daysSinceLastJob, activeJobs, ytdJobs, avgPayDelay,
      paidPaymentCount: paidPayments.length, healthScore, churnRisk,
    };
  });

  const clientStats = allClientStats
    .filter(c => c.lifetimeRev > 0)
    .sort((a, b) => b.healthScore - a.healthScore);

  // Client jobs drill-down
  const clientJobsDetail: Record<string, any[]> = {};
  for (const c of clientStats) {
    const clientJobs = revenueJobs.filter(j => j.client_id === c.clientId).sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    clientJobsDetail[c.clientId] = clientJobs.map(j => {
      const grossRev = effectiveRevenue(j);
      const tCost = effectiveCost(j);
      const marginPct = grossRev > 0 ? (grossRev - tCost) / grossRev : 0;
      const paid = (paymentsByJob[j.id] || []).filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
      const qbTotal = (j.type_meta as any)?.qb_total_with_tax || grossRev;
      return {
        jobId: j.id, title: j.title, phase: j.phase, createdAt: j.created_at,
        grossRev, totalCost: tCost, marginPct, paid, outstanding: Math.max(0, qbTotal - paid),
      };
    });
  }

  // ── 2. DECORATOR SCORECARD ────────────────────────────────────────────
  const ninetyDaysAgo = new Date(now.getTime() - 90 * msPerDay);
  const decoratorItemsDetail: Record<string, any[]> = {};

  const allDecoratorStats: DecoratorStat[] = decorators.map(d => {
    const itemsForDecorator = items.filter((it: any) =>
      ((it.decorator_assignments || [])[0]?.decorator_id) === d.id
    );

    const activeLoad = itemsForDecorator.filter((it: any) => it.pipeline_stage === "in_production").length;

    const turnarounds: number[] = [];
    const variances: number[] = [];
    const revisionCounts: number[] = [];
    const itemDetails: any[] = [];
    let completedCount = 0;
    for (const it of itemsForDecorator) {
      const ts = (it.pipeline_timestamps as any) || {};
      const inProdAt = ts.in_production;
      const shippedAt = ts.shipped;
      if (inProdAt && shippedAt && new Date(shippedAt) >= ninetyDaysAgo) {
        const d2 = daysBetween(inProdAt, shippedAt);
        if (d2 >= 0 && d2 < 120) {
          turnarounds.push(d2);
          completedCount++;

          const ordered = ((it as any).buy_sheet_lines || []).reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
          const shippedQtys = ((it as any).ship_qtys || {}) as Record<string, number>;
          const shippedTotal = Object.values(shippedQtys).reduce((s: number, q: any) => s + (Number(q) || 0), 0);
          let variancePct: number | null = null;
          if (ordered > 0 && shippedTotal > 0) {
            variancePct = Math.abs(shippedTotal - ordered) / ordered;
            variances.push(variancePct);
          }

          const proofs = proofsByItem[it.id] || [];
          const revs = proofs.filter((p: any) => p.approval === "revision_requested").length;
          revisionCounts.push(revs);

          const job = jobById[it.job_id];
          itemDetails.push({
            itemId: it.id,
            name: it.name,
            jobTitle: job?.title || "—",
            clientName: job ? (clientById[job.client_id]?.name || "—") : "—",
            turnaroundDays: d2,
            variancePct,
            revisionCount: revs,
          });
        }
      }
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    decoratorItemsDetail[d.id] = itemDetails.sort((a, b) => (b.turnaroundDays || 0) - (a.turnaroundDays || 0));

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

  const decoratorStats = allDecoratorStats
    .filter(d => d.activeLoad > 0 || d.completedCount > 0)
    .sort((a, b) => b.activeLoad - a.activeLoad || b.completedCount - a.completedCount);

  // ── 3. CASH FLOW 90D ──────────────────────────────────────────────────
  const termsDays: Record<string, number> = {
    net_15: 15, net_30: 30, net_60: 60,
    prepaid: -14, deposit_balance: -7, due_on_receipt: 0,
  };

  const active = jobs.filter(j => !["complete", "cancelled", "on_hold", "intake"].includes(j.phase));
  const forecast: CashRow[] & { _date: Date }[] = [] as any;

  for (const j of active) {
    const clientName = clientById[j.client_id]?.name || "Unknown";
    const meta = (j.type_meta as any) || {};
    const qbTotal = meta.qb_total_with_tax || (j.costing_summary as any)?.grossRev || 0;
    if (qbTotal <= 0) continue;

    const js_payments = paymentsByJob[j.id] || [];
    const paid = js_payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
    const outstanding = qbTotal - paid;
    if (outstanding <= 0) continue;

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

    const row: any = {
      jobId: j.id, jobTitle: j.title, clientName, amount: outstanding,
      expectedIso: expectedDate.toISOString(), invoiceNum: meta.qb_invoice_number || null,
      _date: expectedDate,
    };
    forecast.push(row);
  }

  const weekBuckets: number[] = Array(13).fill(0);
  const cashByWeek: Record<number, CashRow[]> = {};
  for (let i = 0; i < 13; i++) cashByWeek[i] = [];
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  for (const f of forecast as any[]) {
    const weekIdx = Math.floor((f._date.getTime() - startOfWeek.getTime()) / (7 * msPerDay));
    if (weekIdx >= 0 && weekIdx < 13) {
      weekBuckets[weekIdx] += f.amount;
      cashByWeek[weekIdx].push({
        jobId: f.jobId, jobTitle: f.jobTitle, clientName: f.clientName,
        amount: f.amount, expectedIso: f.expectedIso, invoiceNum: f.invoiceNum,
      });
    }
  }

  const weekLabels: string[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(startOfWeek.getTime() + i * 7 * msPerDay);
    weekLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  const totalExpectedInflow = weekBuckets.reduce((a, b) => a + b, 0);
  const upcomingPayments: CashRow[] = (forecast as any[])
    .filter(f => f._date >= now && f._date.getTime() - now.getTime() <= 90 * msPerDay)
    .sort((a, b) => a._date.getTime() - b._date.getTime())
    .slice(0, 20)
    .map(f => ({
      jobId: f.jobId, jobTitle: f.jobTitle, clientName: f.clientName,
      amount: f.amount, expectedIso: f.expectedIso, invoiceNum: f.invoiceNum,
    }));

  // ── 4. PARETO ─────────────────────────────────────────────────────────
  const profitByClient = clientStats
    .map(c => ({ name: c.name, profit: c.lifetimeRev - c.totalCost }))
    .filter(c => c.profit > 0)
    .sort((a, b) => b.profit - a.profit);
  const totalProfit = profitByClient.reduce((s, c) => s + c.profit, 0);
  let paretoCutoff = profitByClient.length;
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
  // Uses items.cost_per_unit_all_in when saved (exact). Falls back to
  // proportional allocation from costing_summary.totalCost when null
  // (legacy items, pre-028 migration).
  type CatAccum = {
    garmentType: string;
    revenue: number; cost: number; units: number;
    jobIds: Set<string>;
    exactRev: number; // revenue from items that had exact cost
    items: any[];
  };
  const byCat: Record<string, CatAccum> = {};

  for (const j of revenueJobs) {
    const jobCost = ((j.costing_summary as any)?.totalCost) || 0;
    if (jobCost <= 0) continue;

    const jItems = itemsByJob[j.id] || [];
    if (jItems.length === 0) continue;

    // Per-item revenue
    const perItem: { it: any; rev: number; exact: number | null }[] = [];
    for (const it of jItems) {
      const units = ((it as any).buy_sheet_lines || []).reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
      const spu = parseFloat(it.sell_per_unit) || 0;
      const exactCostPerUnit = it.cost_per_unit_all_in !== null && it.cost_per_unit_all_in !== undefined
        ? parseFloat(it.cost_per_unit_all_in) : null;
      const exact = exactCostPerUnit !== null ? exactCostPerUnit * units : null;
      perItem.push({ it, rev: spu * units, exact });
    }
    const jobRevSum = perItem.reduce((s, x) => s + x.rev, 0);
    const allocatedExactCost = perItem.reduce((s, x) => s + (x.exact || 0), 0);
    const remainingCost = Math.max(0, jobCost - allocatedExactCost);
    const remainingRev = perItem.filter(x => x.exact === null).reduce((s, x) => s + x.rev, 0);

    // Scale per-item revenue so the category total matches the job's actual
    // billed revenue (covers variance-review adjustments where the QB total
    // differs from the sum of items' sell_per_unit × ordered qty).
    const billedRev = effectiveRevenue(j);
    const revScale = jobRevSum > 0 && billedRev > 0 ? billedRev / jobRevSum : 1;

    const clientName = clientById[j.client_id]?.name || "—";

    for (const { it, rev, exact } of perItem) {
      const type = it.garment_type || "uncategorized";
      if (!byCat[type]) byCat[type] = { garmentType: type, revenue: 0, cost: 0, units: 0, jobIds: new Set(), exactRev: 0, items: [] };
      const units = ((it as any).buy_sheet_lines || []).reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
      const scaledRev = rev * revScale;

      let itemCost: number;
      let isExact: boolean;
      if (exact !== null) {
        itemCost = exact;
        isExact = true;
        byCat[type].exactRev += scaledRev;
      } else if (remainingRev > 0) {
        itemCost = remainingCost * (rev / remainingRev);
        isExact = false;
      } else {
        itemCost = 0;
        isExact = false;
      }

      byCat[type].revenue += scaledRev;
      byCat[type].cost += itemCost;
      byCat[type].units += units;
      byCat[type].jobIds.add(j.id);
      byCat[type].items.push({
        itemId: it.id,
        name: it.name,
        jobTitle: j.title,
        clientName,
        units,
        revenue: scaledRev,
        cost: itemCost,
        marginPct: scaledRev > 0 ? (scaledRev - itemCost) / scaledRev : 0,
        exact: isExact,
      });
    }
  }

  const categories: CategoryStat[] = Object.values(byCat)
    .filter(c => c.revenue > 0)
    .map(c => ({
      garmentType: c.garmentType,
      revenue: c.revenue,
      cost: c.cost,
      units: c.units,
      marginPct: c.revenue > 0 ? (c.revenue - c.cost) / c.revenue : 0,
      jobCount: c.jobIds.size,
      exactCostCoverage: c.revenue > 0 ? c.exactRev / c.revenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const categoryItemsDetail: Record<string, any[]> = {};
  for (const c of Object.values(byCat)) {
    categoryItemsDetail[c.garmentType] = c.items.sort((a, b) => b.revenue - a.revenue);
  }

  return (
    <GodModeClient
      totalExpectedInflow={totalExpectedInflow}
      activeClientCount={clientStats.length}
      activeProjectCount={active.length}
      clientStats={clientStats}
      decoratorStats={decoratorStats}
      weekBuckets={weekBuckets}
      weekLabels={weekLabels}
      upcomingPayments={upcomingPayments}
      pareto={{ top: top8020, restCount, restProfit, totalProfit }}
      categories={categories}
      details={{
        clientJobs: clientJobsDetail,
        decoratorItems: decoratorItemsDetail,
        cashByWeek,
        categoryItems: categoryItemsDetail,
      }}
    />
  );
}

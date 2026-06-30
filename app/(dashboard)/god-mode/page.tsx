import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GodModeClient, type ClientStat, type DecoratorStat, type CashRow, type CategoryStat } from "@/components/GodModeClient";
import { effectiveRevenue, effectiveCost } from "@/lib/revenue";
import { poSentToItem, isItemInProduction } from "@/lib/item-status";
import { buildPrintersMap } from "@/lib/pricing";
import { computeBillingQueue } from "@/lib/billing-queue";
import { computeVarianceSummary } from "@/lib/variance";

// Owner cockpit. Gated by is_god OR an explicit /god-mode page grant (the
// access model) — NOT a hardcoded email, which broke god-by-flag accounts and
// co-owners (e.g. Corey) who were granted it. Middleware enforces the same;
// this is defense-in-depth at the page.

export const dynamic = "force-dynamic";

export default async function GodModePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: gate } = await supabase.from("profiles").select("is_god, page_access").eq("id", user.id).single();
  const allowed = gate?.is_god === true || (((gate?.page_access as string[] | null) || []).includes("/god-mode"));
  if (!allowed) redirect("/dashboard");

  // ── Fetch ─────────────────────────────────────────────────────────────
  const [
    jobsRes,
    itemsRes,
    paymentsRes,
    decoratorsRes,
    clientsRes,
    proofFilesRes,
    ssReportsRes,
    apVendorsRes,
    costEntriesRes,
    costMarksRes,
  ] = await Promise.all([
    supabase.from("jobs")
      .select("id, job_number, title, phase, client_id, clients(name), company_id, payment_terms, target_ship_date, costing_summary, costing_data, type_meta, phase_timestamps, created_at, quote_approved, quote_approved_at, is_inventory")
      .order("created_at", { ascending: false }),
    supabase.from("items")
      .select("id, job_id, name, pipeline_stage, pipeline_timestamps, sell_per_unit, cost_per_unit, cost_per_unit_all_in, garment_type, ship_qtys, blanks_order_cost, blanks_order_number, buy_sheet_lines(qty_ordered), decorator_assignments(decorator_id)")
      .order("sort_order"),
    supabase.from("payment_records")
      .select("id, job_id, type, amount, status, due_date, paid_date, created_at"),
    supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities"),
    supabase.from("clients").select("id, name, default_terms"),
    supabase.from("item_files")
      .select("item_id, stage, approval, created_at")
      .eq("stage", "proof"),
    // ShipStation/fulfillment invoices live in their own table. Revenue and
    // profit here are margin-accurate: revenue = what the client was billed,
    // cost = the carrier postage we actually paid out — so postage markup +
    // fulfillment fees show as real profit, pure pass-through nets to zero.
    supabase.from("shipstation_reports")
      .select("id, client_id, report_type, postage_mode, period_label, totals, postage_totals, qb_invoice_number, qb_total_with_tax, qb_tax_amount, paid_at, paid_amount, sent_at, created_at"),
    // For the Cost-vs-Plan tile (decorator-bill variance via the billing queue).
    supabase.from("ap_vendors").select("id, name, kind, decorator_id, match_keys").eq("active", true),
    supabase.from("cost_entries").select("job_id, vendor_id, amount, po_ref, not_job_specific"),
    supabase.from("cost_vendor_status").select("job_id, vendor_id, reason"),
  ]);

  const jobs = jobsRes.data || [];
  const items = itemsRes.data || [];
  const payments = paymentsRes.data || [];
  const decorators = decoratorsRes.data || [];
  const clients = clientsRes.data || [];
  const proofFiles = proofFilesRes.data || [];

  // ── Cost-vs-Plan variance (decorator bills + blanks vs projection) ──
  // Same engine as the /reconciliation Variances tab — shared lib/variance.
  const vxPrinters = buildPrintersMap(decorators);
  const vxQueue = computeBillingQueue({ jobs, printers: vxPrinters, apVendors: (apVendorsRes.data as any) || [], entries: (costEntriesRes.data as any) || [], marks: (costMarksRes.data as any) || [] });
  const vxJobsRaw = Object.fromEntries(jobs.map((j: any) => [j.id, j]));
  const costVariance = computeVarianceSummary({ queue: vxQueue, jobsRaw: vxJobsRaw, items, printers: vxPrinters }).netVar;
  // Only reports that became a real invoice (QB invoice # or emailed to the
  // client) count as revenue — unsent drafts don't.
  const ssReports: any[] = (ssReportsRes.data || []).filter((r: any) => r.qb_invoice_number || r.sent_at);

  // ── ShipStation revenue/cost — margin-accurate per report ──
  const num = (x: any) => Number(x) || 0;
  function ssRevCost(r: any): { revenue: number; cost: number } {
    const t = r.totals || {};
    const pt = r.postage_totals || {};
    if (r.report_type === "combined") {
      return { revenue: num(t.fee) + num(pt.billed) + num(pt.fulfillment), cost: num(pt.cost_raw) + num(pt.insurance) };
    }
    if (r.report_type === "postage") {
      return { revenue: num(t.billed) + num(t.fulfillment), cost: num(t.cost_raw) + num(t.insurance) };
    }
    if (r.report_type === "fulfillment") {
      return { revenue: num(t.fulfillment), cost: 0 };
    }
    return { revenue: num(t.fee), cost: 0 }; // sales — pure commission
  }
  const ssTypeLabel = (rt: string) => rt === "combined" ? "Full Service" : rt === "postage" ? "Postage" : rt === "fulfillment" ? "Fulfillment" : "Sales";

  // Aggregate per client + keep per-report rows for the drill-downs.
  type SsRow = { reportId: string; period: string; type: string; createdAt: string; revenue: number; cost: number; marginPct: number; paid: number; outstanding: number; shipments: number };
  const ssByClient: Record<string, { revenue: number; cost: number; rows: SsRow[] }> = {};
  for (const r of ssReports) {
    const { revenue, cost } = ssRevCost(r);
    const t = r.totals || {}, pt = r.postage_totals || {};
    const shipments = num(t.shipments) + num(pt.shipments);
    const paid = r.paid_at ? revenue : 0;
    const g = ssByClient[r.client_id] || (ssByClient[r.client_id] = { revenue: 0, cost: 0, rows: [] });
    g.revenue += revenue;
    g.cost += cost;
    g.rows.push({
      reportId: r.id, period: r.period_label || "—", type: ssTypeLabel(r.report_type), createdAt: r.created_at,
      revenue, cost, marginPct: revenue > 0 ? (revenue - cost) / revenue : 0,
      paid, outstanding: Math.max(0, revenue - paid), shipments,
    });
  }

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

  // Exclude bulk inventory/stock-buy jobs from all P&L — their cost rides the
  // future jobs that decorate + sell the stock (see lib/revenue pnlJobs).
  const revenueJobs = jobs.filter(j => j.phase !== "cancelled" && !(j as any).is_inventory);

  // ── 1. CLIENT HEALTH ──────────────────────────────────────────────────
  const ytdCutoff = new Date(now.getFullYear(), 0, 1);
  const allClientStats: ClientStat[] = clients.map(c => {
    const clientJobs = revenueJobs.filter(j => j.client_id === c.id);
    const jobRev = clientJobs.reduce((s, j) => s + effectiveRevenue(j), 0);
    const jobCost = clientJobs.reduce((s, j) => s + effectiveCost(j), 0);
    // Fold in ShipStation/fulfillment invoices (margin-accurate).
    const ss = ssByClient[c.id] || { revenue: 0, cost: 0, rows: [] };
    const lifetimeRev = jobRev + ss.revenue;
    const totalCost = jobCost + ss.cost;
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
    clientJobsDetail[c.clientId] = [
      ...clientJobs.map(j => {
        const grossRev = effectiveRevenue(j);
        const tCost = effectiveCost(j);
        const marginPct = grossRev > 0 ? (grossRev - tCost) / grossRev : 0;
        const paid = (paymentsByJob[j.id] || []).filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
        const qbTotal = (j.type_meta as any)?.qb_total_with_tax || grossRev;
        // AR = invoiced & unpaid. Un-invoiced jobs (intake/pending) and cancelled
        // jobs are NOT receivables, even if they carry projected revenue.
        const isAR = !!(j.type_meta as any)?.qb_invoice_number && j.phase !== "cancelled";
        return {
          jobId: j.id, title: j.title, phase: j.phase, createdAt: j.created_at,
          grossRev, totalCost: tCost, marginPct, paid, outstanding: isAR ? Math.max(0, qbTotal - paid) : 0,
        };
      }),
      // ShipStation/fulfillment invoices as their own rows (link to the report).
      ...((ssByClient[c.clientId]?.rows) || []).map(r => ({
        jobId: "", reportId: r.reportId, title: `${r.type} · ${r.period}`, phase: "invoice", createdAt: r.createdAt,
        grossRev: r.revenue, totalCost: r.cost, marginPct: r.marginPct, paid: r.paid, outstanding: r.outstanding,
      })),
    ];
  }

  // ── 2. DECORATOR SCORECARD ────────────────────────────────────────────
  const ninetyDaysAgo = new Date(now.getTime() - 90 * msPerDay);
  const decoratorItemsDetail: Record<string, any[]> = {};

  const allDecoratorStats: DecoratorStat[] = decorators.map(d => {
    const itemsForDecorator = items.filter((it: any) =>
      ((it.decorator_assignments || [])[0]?.decorator_id) === d.id
    );

    const activeLoad = itemsForDecorator.filter((it: any) => {
      const itJob = jobById[it.job_id];
      const printVendor = ((itJob?.costing_data?.costProds) || []).find((cp: any) => cp.id === it.id)?.printVendor;
      const poSent = poSentToItem({ printVendor, decoratorName: d.name, decoratorShortCode: d.short_code, poSentVendors: itJob?.type_meta?.po_sent_vendors });
      return isItemInProduction({ pipeline_stage: it.pipeline_stage, received_at_hpd: it.received_at_hpd, poSent });
    }).length;

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

  // ShipStation/fulfillment invoices not yet paid → expected inflow too.
  // No payment_records or ship date on these, so the expected date is the
  // invoice date + the client's default terms.
  for (const r of ssReports) {
    if (r.paid_at) continue;
    const ssTotal = num(r.qb_total_with_tax) || ssRevCost(r).revenue; // actual billable, incl tax
    if (ssTotal <= 0) continue;
    const client = clientById[r.client_id];
    const delay = termsDays[(client?.default_terms) as string] ?? 30;
    const expectedDate = new Date(new Date(r.created_at).getTime() + delay * msPerDay);
    forecast.push({
      jobId: "", reportId: r.id, jobTitle: `${ssTypeLabel(r.report_type)} · ${r.period_label || "—"}`,
      clientName: client?.name || "Unknown", amount: ssTotal,
      expectedIso: expectedDate.toISOString(), invoiceNum: r.qb_invoice_number || null,
      _date: expectedDate,
    } as any);
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
        jobId: f.jobId, reportId: f.reportId, jobTitle: f.jobTitle, clientName: f.clientName,
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
      jobId: f.jobId, reportId: f.reportId, jobTitle: f.jobTitle, clientName: f.clientName,
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

  // ── 6. OPERATIONS (merged in from the old Insights page) ──────────────
  const opsActive = jobs.filter(j => !["complete", "cancelled"].includes(j.phase));
  const completedJobs = jobs.filter(j => j.phase === "complete");

  // AR aging — jobs + unpaid ShipStation invoices, bucketed by oldest due date.
  const arBuckets = { current: 0, d30: 0, d60: 0, d90plus: 0 };
  const bucketize = (owed: number, daysOld: number) => {
    if (owed <= 0) return;
    if (daysOld <= 0) arBuckets.current += owed;
    else if (daysOld <= 30) arBuckets.d30 += owed;
    else if (daysOld <= 60) arBuckets.d60 += owed;
    else arBuckets.d90plus += owed;
  };
  // Only invoiced, non-cancelled jobs are receivables (any phase, incl. complete).
  const arJobs = jobs.filter(j => j.phase !== "cancelled" && (j.type_meta as any)?.qb_invoice_number);
  for (const j of arJobs) {
    const rev = num((j.type_meta as any)?.qb_total_with_tax) || effectiveRevenue(j);
    if (rev <= 0) continue;
    const jobPaid = (paymentsByJob[j.id] || []).filter(p => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);
    const owed = rev - jobPaid;
    if (owed <= 0) continue;
    const unpaid = (paymentsByJob[j.id] || []).filter(p => p.status !== "paid" && p.due_date);
    const oldestDue = unpaid.length
      ? unpaid.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0].due_date
      : j.created_at;
    bucketize(owed, oldestDue ? daysBetween(oldestDue, now) : 0);
  }
  for (const r of ssReports) {
    if (r.paid_at) continue;
    const owed = num(r.qb_total_with_tax) || ssRevCost(r).revenue;
    if (owed <= 0) continue;
    const delay = termsDays[(clientById[r.client_id]?.default_terms) as string] ?? 30;
    const due = new Date(new Date(r.created_at).getTime() + delay * msPerDay);
    bucketize(owed, daysBetween(due.toISOString(), now));
  }

  // Production health — phase cycle times, bottleneck, stalled items.
  const phaseTimes: Record<string, number[]> = {};
  for (const j of completedJobs) {
    const pts = (j.phase_timestamps as any) || {};
    const phaseSeq = ["intake", "pending", "ready", "production", "complete"];
    for (let i = 0; i < phaseSeq.length - 1; i++) {
      if (pts[phaseSeq[i]] && pts[phaseSeq[i + 1]]) {
        const d = daysBetween(pts[phaseSeq[i]], pts[phaseSeq[i + 1]]);
        if (d >= 0 && d < 365) (phaseTimes[phaseSeq[i]] ||= []).push(d);
      }
    }
  }
  const avgPhaseTimes: Record<string, number> = {};
  for (const [p, arr] of Object.entries(phaseTimes)) avgPhaseTimes[p] = arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const fullCycles = completedJobs
    .filter(j => (j.phase_timestamps as any)?.intake && (j.phase_timestamps as any)?.complete)
    .map(j => daysBetween((j.phase_timestamps as any).intake, (j.phase_timestamps as any).complete))
    .filter(d => d >= 0 && d < 365);
  const avgCycleTime = fullCycles.length ? Math.round(fullCycles.reduce((a, b) => a + b, 0) / fullCycles.length) : 0;
  const bnEntry = Object.entries(avgPhaseTimes).sort((a, b) => b[1] - a[1])[0];
  const bottleneck = bnEntry ? { phase: bnEntry[0], days: bnEntry[1] } : null;
  const phaseCounts: Record<string, number> = {};
  for (const j of opsActive) phaseCounts[j.phase] = (phaseCounts[j.phase] || 0) + 1;
  const stalled = items
    .filter(it => {
      const ts = (it.pipeline_timestamps as any) || {};
      return it.pipeline_stage && ts[it.pipeline_stage] && daysBetween(ts[it.pipeline_stage], now) >= 7;
    })
    .map(it => {
      const job = jobById[it.job_id];
      return {
        itemId: it.id, name: it.name, jobId: it.job_id, jobTitle: job?.title || "—",
        clientName: job ? (clientById[job.client_id]?.name || "—") : "—",
        stage: it.pipeline_stage, days: daysBetween(((it.pipeline_timestamps as any) || {})[it.pipeline_stage], now),
      };
    })
    .sort((a, b) => b.days - a.days);

  // Payment attention — overdue + upcoming (next 30 days).
  const todayStr = now.toISOString().split("T")[0];
  const in30Str = new Date(now.getTime() + 30 * msPerDay).toISOString().split("T")[0];
  const mapPay = (p: any) => {
    const job = jobById[p.job_id];
    return {
      id: p.id, jobId: p.job_id, jobTitle: job?.title || "—",
      clientName: job ? (clientById[job.client_id]?.name || "—") : "—",
      amount: p.amount || 0, dueDate: p.due_date,
    };
  };
  const overduePayments = payments
    .filter(p => p.due_date && p.status !== "paid" && p.status !== "void" && p.due_date < todayStr)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    .map(p => ({ ...mapPay(p), daysOver: daysBetween(p.due_date, now) }));
  const upcomingDue = payments
    .filter(p => p.due_date && p.status !== "paid" && p.status !== "void" && p.due_date >= todayStr && p.due_date <= in30Str)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    .map(mapPay);

  const operations = {
    arBuckets,
    production: { phaseCounts, avgPhaseTimes, avgCycleTime, bottleneck, stalled },
    payments: { overdue: overduePayments, upcoming: upcomingDue },
  };

  // Shipping & Fulfillment as its own category so this section reconciles
  // with total revenue (margin = postage markup + fulfillment fees).
  const ssCatRev = Object.values(ssByClient).reduce((s, g) => s + g.revenue, 0);
  const ssCatCost = Object.values(ssByClient).reduce((s, g) => s + g.cost, 0);
  if (ssCatRev > 0) {
    const ssAllRows = Object.values(ssByClient).flatMap(g => g.rows);
    categories.push({
      garmentType: "Shipping & Fulfillment",
      revenue: ssCatRev, cost: ssCatCost,
      units: ssAllRows.reduce((s, r) => s + r.shipments, 0),
      marginPct: ssCatRev > 0 ? (ssCatRev - ssCatCost) / ssCatRev : 0,
      jobCount: ssAllRows.length,
      exactCostCoverage: 1,
    });
    categories.sort((a, b) => b.revenue - a.revenue);
    categoryItemsDetail["Shipping & Fulfillment"] = Object.entries(ssByClient)
      .flatMap(([cid, g]) => g.rows.map(r => ({
        itemId: r.reportId, name: `${r.type} · ${r.period}`, jobTitle: r.type,
        clientName: clientById[cid]?.name || "—",
        units: r.shipments, revenue: r.revenue, cost: r.cost, marginPct: r.marginPct, exact: true,
      })))
      .sort((a, b) => b.revenue - a.revenue);
  }

  return (
    <GodModeClient
      totalExpectedInflow={totalExpectedInflow}
      costVariance={costVariance}
      activeClientCount={clientStats.length}
      activeProjectCount={active.length}
      clientStats={clientStats}
      decoratorStats={decoratorStats}
      weekBuckets={weekBuckets}
      weekLabels={weekLabels}
      upcomingPayments={upcomingPayments}
      pareto={{ top: top8020, restCount, restProfit, totalProfit }}
      categories={categories}
      operations={operations}
      details={{
        clientJobs: clientJobsDetail,
        decoratorItems: decoratorItemsDetail,
        cashByWeek,
        categoryItems: categoryItemsDetail,
      }}
    />
  );
}

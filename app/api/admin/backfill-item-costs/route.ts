export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { calcCostProduct, buildPrintersMap } from "@/lib/pricing";

// Owner-only one-time backfill. Runs the same per-item cost calc CostingTab
// runs, but across every job that has costing_data — no need to re-open
// each job manually. Safe to re-run (overwrites prior values).

const OWNER_EMAIL = "jon@housepartydistro.com";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email !== OWNER_EMAIL) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Load all jobs with costing data + all decorators (for printers map).
    const [jobsRes, decoratorsRes] = await Promise.all([
      admin.from("jobs")
        .select("id, title, phase, costing_data, costing_summary")
        .not("costing_data", "is", null),
      admin.from("decorators").select("*"),
    ]);

    if (jobsRes.error) throw new Error(jobsRes.error.message);
    if (decoratorsRes.error) throw new Error(decoratorsRes.error.message);

    const jobs = jobsRes.data || [];
    const decorators = decoratorsRes.data || [];
    const printers = buildPrintersMap(decorators);

    let jobsScanned = 0;
    let itemsUpdated = 0;
    let itemsSkipped = 0;
    const errors: { jobId: string; title: string; error: string }[] = [];

    for (const job of jobs) {
      jobsScanned++;
      const cd = (job.costing_data as any) || {};
      const costProds = cd.costProds || [];
      const costMargin = cd.costMargin || "low";
      const inclShip = !!cd.inclShip;
      const inclCC = !!cd.inclCC;

      if (costProds.length === 0) continue;

      try {
        for (const cp of costProds) {
          if (!cp?.id) { itemsSkipped++; continue; }
          const r = calcCostProduct(cp, costMargin, inclShip, inclCC, costProds, printers);
          if (!r || !(r.qty > 0) || !(r.totalCost >= 0)) { itemsSkipped++; continue; }

          const costPerUnitAllIn = Math.round((r.totalCost / r.qty) * 100) / 100;
          const updateData: any = { cost_per_unit_all_in: costPerUnitAllIn };

          // Also backfill sell_per_unit if missing — same pattern CostingTab uses.
          if (r.sellPerUnit > 0) {
            updateData.sell_per_unit = Math.round(r.sellPerUnit * 100) / 100;
          } else if (cp.sellOverride > 0) {
            updateData.sell_per_unit = Math.round(cp.sellOverride * 100) / 100;
          }

          const { error } = await admin.from("items").update(updateData).eq("id", cp.id);
          if (error) {
            errors.push({ jobId: job.id, title: job.title, error: `item ${cp.id}: ${error.message}` });
            itemsSkipped++;
          } else {
            itemsUpdated++;
          }
        }
      } catch (e: any) {
        errors.push({ jobId: job.id, title: job.title, error: e.message || String(e) });
      }
    }

    return NextResponse.json({
      success: true,
      jobsScanned,
      itemsUpdated,
      itemsSkipped,
      errors: errors.slice(0, 20), // cap error list
      totalErrors: errors.length,
    });
  } catch (e: any) {
    console.error("[backfill-item-costs]", e);
    return NextResponse.json({ error: e.message || "Backfill failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// God Mode V2 data feed — the six imported years, compacted for client-side
// interactivity (one fetch, all filtering happens in the browser).
// Gate mirrors /god-mode: is_god OR an explicit page grant.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function pageAll(db: any, table: string, cols: string) {
  // ordered paging — without .order, PostgREST page boundaries aren't
  // deterministic and rows can be skipped or doubled across pages
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: gate } = await supabase.from("profiles").select("is_god, page_access").eq("id", user.id).single();
    const pa = (((gate as any)?.page_access as string[] | null) || []);
    const allowed = (gate as any)?.is_god === true || pa.includes("/god-mode-v2") || pa.includes("/god-mode");
    if (!allowed) return NextResponse.json({ error: "Not available" }, { status: 403 });

    const db = admin();
    // opshub_job_id null = pure history; stamped rows live on as jobs and
    // would double-count (Jon, Jul 22)
    const sales = (await pageAll(db, "history_sales",
      "txn_date, customer, product_group, amount, qty, blank_style, size_qtys, opshub_job_id"))
      .filter((r: any) => !r.opshub_job_id);
    const costs = await pageAll(db, "history_vendor_costs", "txn_date, vendor, amount, txn_type");

    // compact lines: [ym, customer, group, amount, qty]
    const lines = sales
      .filter((r: any) => r.txn_date && r.customer)
      .map((r: any) => [String(r.txn_date).slice(0, 7), r.customer, r.product_group || "Other", Number(r.amount) || 0, Number(r.qty) || 0]);

    // size curves per customer+group (raw sums; browser aggregates "all")
    const curveMap = new Map<string, Record<string, number>>();
    for (const r of sales) {
      if (!r.size_qtys || !r.customer) continue;
      const key = `${r.customer}|||${r.product_group || "Other"}`;
      const acc = curveMap.get(key) || {};
      for (const [s, n] of Object.entries(r.size_qtys as Record<string, number>)) {
        acc[s] = (acc[s] || 0) + (Number(n) || 0);
      }
      curveMap.set(key, acc);
    }
    const curves = Array.from(curveMap.entries()).map(([k, sizes]) => {
      const [customer, group] = k.split("|||");
      return { c: customer, g: group, s: sizes };
    });

    // blank usage per customer
    const blankMap = new Map<string, number>();
    for (const r of sales) {
      if (!r.blank_style || !r.customer) continue;
      const key = `${r.customer}|||${r.blank_style}`;
      blankMap.set(key, (blankMap.get(key) || 0) + (Number(r.qty) || 0));
    }
    const blanks = Array.from(blankMap.entries()).map(([k, units]) => {
      const [customer, blank] = k.split("|||");
      return { c: customer, b: blank, u: Math.round(units) };
    });

    // vendor spend per month (bills/expenses only — importer already dropped payments)
    const spend = costs
      .filter((r: any) => r.txn_date && r.vendor)
      .map((r: any) => [String(r.txn_date).slice(0, 7), r.vendor, Number(r.amount) || 0]);

    return NextResponse.json({ lines, curves, blanks, spend });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

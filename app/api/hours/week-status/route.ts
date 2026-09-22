export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

// Week status for /hours: the latest submission + per-contractor billed/paid
// dates. contractor_pay_runs is AP-gated (it holds rate + amount), so this
// reads it with the service role and returns ONLY dates — /hours stays rate-blind.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "Missing start/end" }, { status: 400 });

  const { data: submission } = await supabase.from("hours_submissions")
    .select("submitted_at, submitted_by_name, total_hours, snapshot")
    .eq("week_start", start).order("submitted_at", { ascending: false }).limit(1).maybeSingle();

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: runs } = await admin.from("contractor_pay_runs")
    .select("id, contractor_id, pushed_at, qb_paid_at")
    .lte("period_start", end).gte("period_end", start);

  return NextResponse.json({ submission: submission || null, payRuns: runs || [] });
}

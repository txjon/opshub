import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { refreshJobFinancials } from "@/lib/costing-summary";

export const dynamic = "force-dynamic";

// POST — recompute this job's costing_summary from saved costing_data
// (lib/costing-summary, the verified mirror of CostingTab's aggregation).
// Fired fire-and-forget by ProductBuilder after item mutations so dollar
// KPIs can no longer go stale between costing-tab visits. Session required;
// write runs service-role. Mutation-triggered ONLY — never sweep historical
// jobs (old summaries embed the rates of their era; see verify harness).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const res = await refreshJobFinancials(admin, params.id);
    return NextResponse.json(res, { status: res.ok ? 200 : 500 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "refresh failed" }, { status: 500 });
  }
}

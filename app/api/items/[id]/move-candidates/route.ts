import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/items/[id]/move-candidates
// Returns the list of jobs this item could be moved TO:
//   - same client as the item's current job
//   - not the current job
//   - not complete or cancelled
// Sorted newest first.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();

    const { data: item } = await db
      .from("items")
      .select("id, job_id, jobs(client_id)")
      .eq("id", params.id)
      .single();
    if (!item || !(item as any).jobs) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const clientId = (item as any).jobs.client_id;
    if (!clientId) return NextResponse.json({ jobs: [] });

    const { data: jobs } = await db
      .from("jobs")
      .select("id, job_number, title, phase, created_at, target_ship_date, type_meta")
      .eq("client_id", clientId)
      .neq("id", item.job_id)
      .not("phase", "in", "(complete,cancelled)")
      .order("created_at", { ascending: false })
      .limit(50);

    // Surface QB invoice # on the picker so Jon can tell apart same-named
    // jobs at a glance. Strip the rest of type_meta — it's noisy.
    const slim = (jobs || []).map((j: any) => ({
      id: j.id,
      job_number: j.job_number,
      title: j.title,
      phase: j.phase,
      target_ship_date: j.target_ship_date,
      qb_invoice_number: (j.type_meta as any)?.qb_invoice_number || null,
    }));

    return NextResponse.json({ jobs: slim });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

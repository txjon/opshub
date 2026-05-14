import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/dashboard/seen
//
// Bumps companies.branding.last_dashboard_seen_at = now() for the
// user's tenant. Called from AppShell when the user lands on
// /dashboard, which clears the badge instantly. Subsequent external
// events count again from this point forward.
//
// Team-wide (no per-user tracking) — anyone on the team opening the
// dashboard marks "we've seen the news". Matches Jon's stated model.

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    // RLS filters companies to the user's tenant — first row is ours.
    const { data: companies } = await supabase.from("companies").select("id").limit(1);
    const company = (companies || [])[0] as any;
    if (!company) return NextResponse.json({ ok: false }, { status: 404 });

    // Atomic JSONB-key update via RPC — doesn't race with
    // mark-unread / mark-read which touch a sibling key.
    await (supabase as any).rpc("bump_dashboard_seen", {
      p_company_id: company.id,
      p_ts: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[dashboard/seen]", e?.message || e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

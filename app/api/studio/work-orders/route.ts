import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company";
import { woDb } from "@/lib/design-work-orders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE DESK — every live work order across the studio, so nothing waits on
// someone remembering to scroll Slack. Open orders + anything accepted in the
// last 3 days (so the win is visible, then it clears itself). Company-scoped
// through the design's client.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const company = await getActiveCompany();
  const db = woDb();
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await db.from("design_work_orders")
    .select("id, brief_id, type, title, headline, brief, due_by, designer_name, designer_email, state, sent_at, last_designer_at, last_hpd_at, hpd_seen_at, created_at, updated_at, art_briefs!inner(id, title, clients!inner(name, company_id))")
    .eq("art_briefs.clients.company_id", company.id)
    .or(`state.in.(out,delivered,in_revision),and(state.eq.accepted,updated_at.gte.${since})`)
    .order("updated_at", { ascending: false });
  const list = ((data || []) as any[]).map(w => ({
    ...w, art_briefs: undefined,
    client_name: w.art_briefs?.clients?.name || null,
    design_title: w.art_briefs?.title || w.title || null,
    _thumb: w.brief?.canvases?.[0]?.previewId || w.brief?.canvases?.[0]?.driveId || w.brief?.extras?.[0]?.previewId || w.brief?.extras?.[0]?.driveId || null,
    brief: undefined,
  }));
  return NextResponse.json({ workOrders: list });
}

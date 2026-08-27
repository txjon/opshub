import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company";
import { woDb, resolveTarget } from "@/lib/design-work-orders-server";
import { createWorkOrder } from "@/lib/design-work-orders-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET          → THE DESK: every live work order across designs AND runs (open
//                + accepted in the last 3 days), company-scoped.
// GET ?jobId=  → the orders on one job (the job page's list).
// POST         → hand an ITEM to a designer: { itemId, type, headline?,
//                instructions?, brief, dueBy?, designerName?, designerEmail? }.
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}
const SEL = "id, brief_id, item_id, job_id, type, title, headline, brief, due_by, designer_name, designer_email, state, sent_at, last_designer_at, last_hpd_at, hpd_seen_at, created_at, updated_at, art_briefs(id, title, deleted_at, clients(name, company_id)), items(id, name, jobs:job_id(id, title, job_number, clients:client_id(name, company_id)))";
const shape = (w: any) => ({
  ...w, art_briefs: undefined, items: undefined, brief: undefined,
  client_name: w.art_briefs?.clients?.name || w.items?.jobs?.clients?.name || null,
  design_title: w.art_briefs?.title || w.items?.name || w.title || null,
  job_number: w.items?.jobs?.job_number || null,
  _thumb: w.brief?.canvases?.[0]?.previewId || w.brief?.canvases?.[0]?.driveId || w.brief?.extras?.[0]?.previewId || w.brief?.extras?.[0]?.driveId || null,
});

export async function GET(req: NextRequest) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = woDb();
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const { data } = await db.from("design_work_orders").select(SEL).eq("job_id", jobId).order("created_at", { ascending: false });
    return NextResponse.json({ workOrders: ((data || []) as any[]).map(shape) });
  }
  const company = await getActiveCompany();
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await db.from("design_work_orders").select(SEL)
    .or(`state.in.(out,delivered,in_revision),and(state.eq.accepted,updated_at.gte.${since})`)
    .order("updated_at", { ascending: false });
  const list = ((data || []) as any[])
    .filter(w => (w.art_briefs?.clients?.company_id || w.items?.jobs?.clients?.company_id) === company.id)
    .filter(w => !w.art_briefs?.deleted_at)
    .map(shape);
  return NextResponse.json({ workOrders: list });
}

export async function POST(req: NextRequest) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.itemId) return NextResponse.json({ error: "Which item is this for?" }, { status: 400 });
  const t = await resolveTarget({ itemId: String(b.itemId) });
  if (!t) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const r = await createWorkOrder(t, b, who, req.nextUrl.origin);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}

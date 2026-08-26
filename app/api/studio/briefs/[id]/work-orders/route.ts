import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { woDb, resolveTarget } from "@/lib/design-work-orders-server";
import { createWorkOrder } from "@/lib/design-work-orders-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE DESIGNER DOOR on one design (mig 165).
// GET  → the design's work orders (newest first).
// POST → hand it to a designer (lib/design-work-orders-create).
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data } = await woDb().from("design_work_orders").select("*").eq("brief_id", params.id).order("created_at", { ascending: false });
  return NextResponse.json({ workOrders: data || [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const t = await resolveTarget({ briefId: params.id });
  if (!t) return NextResponse.json({ error: "Design not found" }, { status: 404 });
  const r = await createWorkOrder(t, b, who, req.nextUrl.origin);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}

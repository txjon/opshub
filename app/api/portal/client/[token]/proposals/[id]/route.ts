import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function resolveOwnership(token: string, proposalId: string) {
  const db = admin();
  const { data: client } = await db
    .from("clients").select("id").eq("portal_token", token).single();
  if (!client) return { error: "Invalid link", status: 404 as const };
  const { data: proposal } = await db
    .from("client_proposal_items")
    .select("id, client_id, status")
    .eq("id", proposalId)
    .single();
  if (!proposal || (proposal as any).client_id !== (client as any).id) {
    return { error: "Not found", status: 404 as const };
  }
  return { db, client, proposal };
}

// PATCH — update name / qty / notes / garment_type. Status is HPD-side
// only (clients shouldn't flip 'converted' / 'declined' themselves).
export async function PATCH(req: NextRequest, { params }: { params: { token: string; id: string } }) {
  try {
    const r = await resolveOwnership(params.token, params.id);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

    const body = await req.json();
    const updates: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const v = (body.name || "").toString().trim();
      if (!v) return NextResponse.json({ error: "Name required" }, { status: 400 });
      updates.name = v;
    }
    if (body.notes !== undefined) updates.notes = (body.notes || "").toString().trim() || null;
    if (body.qty_estimate !== undefined) updates.qty_estimate = body.qty_estimate ? parseInt(body.qty_estimate) || null : null;
    if (body.garment_type !== undefined) updates.garment_type = body.garment_type || null;

    const { error } = await r.db.from("client_proposal_items").update(updates).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE — remove a proposal entirely. Cascades through release_items
// via FK so any release the proposal was sitting in stays consistent.
export async function DELETE(_req: NextRequest, { params }: { params: { token: string; id: string } }) {
  try {
    const r = await resolveOwnership(params.token, params.id);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    const { error } = await r.db.from("client_proposal_items").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

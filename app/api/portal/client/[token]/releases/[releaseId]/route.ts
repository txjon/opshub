import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function resolveClientFromRelease(token: string, releaseId: string) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id").eq("portal_token", token).single();
  if (!client) return null;
  const { data: release } = await db
    .from("client_releases")
    .select("id, client_id")
    .eq("id", releaseId)
    .single();
  if (!release || release.client_id !== client.id) return null;
  return { db, clientId: client.id };
}

// PATCH /api/portal/client/[token]/releases/[releaseId]
// Body: { title?, target_date? }
export async function PATCH(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await resolveClientFromRelease(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const updates: any = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) {
      const t = (body.title || "").toString().trim();
      if (!t) return NextResponse.json({ error: "Title required" }, { status: 400 });
      updates.title = t;
    }
    if (body.target_date !== undefined) updates.target_date = body.target_date || null;

    const { data, error } = await ctx.db
      .from("client_releases")
      .update(updates)
      .eq("id", params.releaseId)
      .select("id, title, target_date, sort_order")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ release: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE /api/portal/client/[token]/releases/[releaseId]
// Cascade removes any release_items rows attached.
export async function DELETE(_req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await resolveClientFromRelease(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error } = await ctx.db.from("client_releases").delete().eq("id", params.releaseId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

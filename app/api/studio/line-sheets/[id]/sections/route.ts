import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sections (the shelves). POST {name} · PATCH {id, name?, sort?} · DELETE {id}
// (items fall back to the tray — section_id is ON DELETE SET NULL).
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!String(b.name || "").trim()) return NextResponse.json({ error: "Name it" }, { status: 400 });
  const db = admin();
  const { data: maxRow } = await db.from("line_sheet_sections").select("sort").eq("sheet_id", params.id).order("sort", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("line_sheet_sections").insert({ sheet_id: params.id, name: String(b.name).trim().slice(0, 80), sort: ((maxRow as any)?.sort || 0) + 1 } as never).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ section: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch: Record<string, any> = {};
  if (b.name !== undefined) patch.name = String(b.name || "").trim().slice(0, 80);
  if (b.sort !== undefined) patch.sort = Number(b.sort) || 0;
  const { error } = await admin().from("line_sheet_sections").update(patch as never).eq("id", b.id).eq("sheet_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const { error } = await admin().from("line_sheet_sections").delete().eq("id", b.id).eq("sheet_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

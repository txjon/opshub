import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup } from "@/lib/hub-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client's line sheets — PUBLISHED ones only (a draft is ours alone).
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = admin();
  const { data: client } = await hubClientLookup(db, params.token, "id, name");
  if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const { data } = await db.from("line_sheets")
    .select("id, title, season, status, current_version, updated_at")
    .eq("client_id", (client as any).id).gt("current_version", 0)
    .order("updated_at", { ascending: false });
  const sheets = (data || []) as any[];
  const out: any[] = [];
  for (const s of sheets) {
    const { data: v } = await db.from("line_sheet_versions").select("n, note, published_at").eq("sheet_id", s.id).eq("n", s.current_version).maybeSingle();
    const { count } = await db.from("line_sheet_items").select("id", { count: "exact", head: true }).eq("sheet_id", s.id).eq("dropped", false);
    out.push({ ...s, latest: v || null, itemCount: count || 0 });
  }
  return NextResponse.json({ sheets: out });
}

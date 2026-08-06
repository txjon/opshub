import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — start a lineup round on a design (or return the open one; one live
// round per design keeps the menu unambiguous).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const byName = (profile as any)?.full_name || user.email || "HPD";
  const db = dbNoStore();
  const { data: brief } = await db.from("art_briefs").select("id, state").eq("id", params.id).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: open } = await db.from("lineups").select("id").eq("brief_id", params.id).is("closed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (open) return NextResponse.json({ lineup: open, existed: true });
  const { data: lineup, error } = await db.from("lineups").insert({ brief_id: params.id, created_by: byName } as never).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineup });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getActiveCompany } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LINE SHEETS (mig 190) — the index.
// GET  → the company's sheets (client, version, counts), newest first.
// POST → start one: { clientId, title, season? }.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}

export async function GET() {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = admin();
  const company = await getActiveCompany();
  const { data } = await db.from("line_sheets")
    .select("*, clients!inner(id, name, company_id)")
    .eq("clients.company_id", company.id)
    .order("updated_at", { ascending: false });
  const sheets = ((data || []) as any[]);
  const ids = sheets.map(s => s.id);
  const counts: Record<string, { items: number; thumbsUp: number; thumbsDown: number }> = {};
  if (ids.length) {
    const { data: items } = await db.from("line_sheet_items").select("sheet_id, dropped, client_thumb").in("sheet_id", ids);
    for (const it of (items || []) as any[]) {
      const c = (counts[it.sheet_id] ||= { items: 0, thumbsUp: 0, thumbsDown: 0 });
      if (it.dropped) continue;
      c.items++;
      if (it.client_thumb === "up") c.thumbsUp++;
      if (it.client_thumb === "down") c.thumbsDown++;
    }
  }
  return NextResponse.json({ sheets: sheets.map(s => ({ ...s, client_name: s.clients?.name || null, clients: undefined, _counts: counts[s.id] || { items: 0, thumbsUp: 0, thumbsDown: 0 } })) });
}

export async function POST(req: NextRequest) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.clientId || !String(b.title || "").trim()) return NextResponse.json({ error: "A client and a title are required" }, { status: 400 });
  const db = admin();
  const { data: sheet, error } = await db.from("line_sheets").insert({
    client_id: b.clientId, title: String(b.title).trim().slice(0, 140),
    season: b.season ? String(b.season).trim().slice(0, 60) : null, created_by: who.name,
  } as never).select("*").single();
  if (error || !sheet) return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  return NextResponse.json({ sheet });
}

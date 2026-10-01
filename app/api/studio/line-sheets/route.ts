import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getActiveCompany } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LINE SHEETS (mig 190) — the index.
// GET  → the company's sheets (client, release, version, counts), newest first.
//        ?client=<id> → instead, that client's building releases with no
//        sheet yet (the New-sheet picker).
// POST → start one: { clientId, title, season?, releaseId? }. A sheet is the
//        proposal stage of ONE release (mig 192): no releaseId → a new
//        building release is born with the sheet's title.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}

export async function GET(req: NextRequest) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = admin();
  const company = await getActiveCompany();
  const forClient = req.nextUrl.searchParams.get("client");
  if (forClient) {
    const { data: rels } = await db.from("releases").select("id, title, target_live_date")
      .eq("client_id", forClient).eq("company_id", company.id).eq("status", "building").order("created_at", { ascending: false });
    const { data: taken } = await db.from("line_sheets").select("release_id").eq("client_id", forClient);
    const used = new Set(((taken || []) as any[]).map(t => t.release_id));
    return NextResponse.json({ releases: ((rels || []) as any[]).filter(r => !used.has(r.id)) });
  }
  const { data } = await db.from("line_sheets")
    .select("*, clients!inner(id, name, company_id), releases(id, title)")
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
  return NextResponse.json({ sheets: sheets.map(s => ({ ...s, client_name: s.clients?.name || null, clients: undefined, release_title: s.releases?.title || null, releases: undefined, _counts: counts[s.id] || { items: 0, thumbsUp: 0, thumbsDown: 0 } })) });
}

export async function POST(req: NextRequest) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.clientId || !String(b.title || "").trim()) return NextResponse.json({ error: "A client and a title are required" }, { status: 400 });
  const db = admin();
  const title = String(b.title).trim().slice(0, 140);
  let releaseId: string | null = b.releaseId || null;
  let bornRelease = false;
  if (releaseId) {
    const { data: rel } = await db.from("releases").select("id, client_id").eq("id", releaseId).maybeSingle();
    if (!rel || (rel as any).client_id !== b.clientId) return NextResponse.json({ error: "That release isn't this client's" }, { status: 400 });
  } else {
    const { data: cl } = await db.from("clients").select("company_id").eq("id", b.clientId).maybeSingle();
    if (!cl) return NextResponse.json({ error: "Unknown client" }, { status: 400 });
    const { data: rel, error: rErr } = await db.from("releases").insert({
      company_id: (cl as any).company_id || null, client_id: b.clientId, title: title.slice(0, 120),
      model: null, status: "building", status_timestamps: { building: new Date().toISOString() },
    } as never).select("id").single();
    if (rErr || !rel) return NextResponse.json({ error: rErr?.message || "Couldn't start the release" }, { status: 500 });
    releaseId = (rel as any).id;
    bornRelease = true;
  }
  const { data: sheet, error } = await db.from("line_sheets").insert({
    client_id: b.clientId, release_id: releaseId, title,
    season: b.season ? String(b.season).trim().slice(0, 60) : null, created_by: who.name,
  } as never).select("*").single();
  if (error || !sheet) {
    if (bornRelease) await db.from("releases").delete().eq("id", releaseId!);
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
  return NextResponse.json({ sheet });
}

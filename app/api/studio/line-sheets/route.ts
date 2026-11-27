import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getActiveCompany } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LINE SHEETS (mig 190) — the index.
// GET  → the company's sheets (client, release, version, counts), newest first.
//        Archived sheets (mig 211) only with ?archived=1, and then only those.
//        ?client=<id> → instead, that client's building releases with no
//        sheet yet (the New-sheet picker).
// POST → start one: { clientId, title, releaseId? }. A sheet is the
//        proposal stage of ONE release (mig 192): no releaseId → a new
//        building release is born with the sheet's title.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function me() {
  const supabase = await createClient();
  const user = await studioUser(supabase);
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}

export async function GET(req: NextRequest) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = admin();
  const company = await getActiveCompany();
  const archived = req.nextUrl.searchParams.get("archived") === "1";
  let q = db.from("line_sheets")
    .select("*, clients!inner(id, name, company_id)")
    .eq("clients.company_id", company.id);
  q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data } = await q.order("updated_at", { ascending: false });
  const sheets = ((data || []) as any[]);
  const ids = sheets.map(s => s.id);
  // verdict counts (mig 215): liked = an old thumbs-up still waiting on an answer
  const zero = () => ({ items: 0, asis: 0, change: 0, pass: 0, liked: 0 });
  const counts: Record<string, ReturnType<typeof zero>> = {};
  if (ids.length) {
    const { data: items } = await db.from("line_sheet_items").select("sheet_id, dropped, client_verdict").in("sheet_id", ids);
    for (const it of (items || []) as any[]) {
      const c = (counts[it.sheet_id] ||= zero());
      if (it.dropped) continue;
      c.items++;
      const v = it.client_verdict as "asis" | "change" | "pass" | "liked" | null;
      if (v) c[v]++;
    }
  }
  return NextResponse.json({ sheets: sheets.map(s => ({ ...s, client_name: s.clients?.name || null, clients: undefined, _counts: counts[s.id] || zero() })) });
}

export async function POST(req: NextRequest) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.clientId) return NextResponse.json({ error: "Pick a client" }, { status: 400 });
  const db = admin();
  const { data: cl } = await db.from("clients").select("company_id").eq("id", b.clientId).maybeSingle();
  if (!cl || (cl as any).company_id !== (await getActiveCompany()).id) return NextResponse.json({ error: "Unknown client" }, { status: 400 });
  // one planner per client (mig 218): archive the old one to start another
  const { data: live } = await db.from("line_sheets").select("id").eq("client_id", b.clientId).is("archived_at", null).limit(1);
  if ((live || []).length) return NextResponse.json({ error: "This client already has a planner. Add to it, or archive it to start a new one.", sheetId: (live as any[])[0].id }, { status: 409 });
  // A planner has no name of its own (Jon, Nov 27): it's the client's.
  // Releases are separate and many (mig 220 dropped the one-release link).
  const { data: sheet, error } = await db.from("line_sheets").insert({
    client_id: b.clientId, title: "Planner", created_by: who.name,
  } as never).select("*").single();
  if (error || !sheet) {
    // someone made one a moment ago (mig 218: one live planner per client)
    if ((error as any)?.code === "23505") return NextResponse.json({ error: "This client already has a planner. Add to it, or archive it to start a new one." }, { status: 409 });
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
  return NextResponse.json({ sheet });
}

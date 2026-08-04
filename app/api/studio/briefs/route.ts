import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";
import { getActiveCompany } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE STUDIO's feed (Phase 2 — the Lab's UX on the real tables).
// GET  → every active brief: client, five-state, latest client-visible art,
//        bridged job if the ask became one. Company-scoped, auth-gated.
// POST → start a design on a REAL client: { clientId, title, concept? }.
const admin = dbNoStore;
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = admin();
  const company = await getActiveCompany();
  const { data: briefs } = await db.from("art_briefs")
    .select("id, title, state, source, internal_only, client_aborted_at, approved_file_id, updated_at, created_at, clients!inner(id, name, company_id)")
    .eq("clients.company_id", company.id)
    .is("client_aborted_at", null)
    .order("updated_at", { ascending: false });
  const list = (briefs || []) as any[];
  const ids = list.map(b => b.id);

  // THE LATEST file fronts the internal card — our side sees everything, so
  // no client-visibility preference here (that's the portal's rule). Only
  // passed-on versions defer; if every version is passed, newest shows anyway.
  const artByBrief: Record<string, string> = {};
  if (ids.length) {
    const { data: files } = await db.from("art_brief_files")
      .select("brief_id, drive_file_id, preview_drive_file_id, reaction, created_at")
      .in("brief_id", ids).not("drive_file_id", "is", null)
      .order("created_at", { ascending: false });
    for (const f of (files || []) as any[]) {
      if (artByBrief[f.brief_id]) continue;
      if (f.reaction === "down") continue;
      artByBrief[f.brief_id] = f.preview_drive_file_id || f.drive_file_id;
    }
    for (const f of (files || []) as any[]) {
      if (!artByBrief[f.brief_id]) artByBrief[f.brief_id] = f.preview_drive_file_id || f.drive_file_id;
    }
  }

  // Bridged asks: brief → job via order requests.
  const jobByBrief: Record<string, any> = {};
  if (ids.length) {
    const { data: reqs } = await db.from("lab_order_requests")
      .select("brief_id, job_id, jobs(job_number)").in("brief_id", ids).not("job_id", "is", null);
    for (const r of (reqs || []) as any[]) jobByBrief[r.brief_id] = { id: r.job_id, number: r.jobs?.job_number || null };
  }

  return NextResponse.json({
    briefs: list.map(b => ({
      id: b.id, title: b.title, state: b.state, source: b.source,
      client_name: b.clients?.name || null, updated_at: b.updated_at,
      _art: artByBrief[b.id] || null, _job: jobByBrief[b.id] || null,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.clientId || !String(b.title || "").trim()) {
    return NextResponse.json({ error: "A client and a title are required" }, { status: 400 });
  }
  const db = admin();
  const { data: brief, error } = await db.from("art_briefs").insert({
    client_id: b.clientId,
    title: String(b.title).trim().slice(0, 140),
    concept: String(b.concept || "").trim() || null,
    state: "working",
    source: "hpd",
  }).select("id").single();
  if (error || !brief) return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  return NextResponse.json({ brief });
}

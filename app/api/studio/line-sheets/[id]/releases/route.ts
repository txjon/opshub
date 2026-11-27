import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser, lineSheetInCompany } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { addSlot, isSlotOpFail } from "@/lib/release-slot-ops";
import { boardReleases, OPEN_RELEASE } from "@/lib/line-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE DOOR from the board to a release (mig 217, Jon Nov 26 2026: the board
// says what we're making; the release says when, how many and the order).
// GET  → the client's open releases (not cut/done/shelved), each with the
//        board cards already on it: { releases: [{ id, title, status,
//        target_live_date, cardIds }] }
// POST → { cardIds, releaseId } or { cardIds, newTitle } (a new building
//        release for this client). Each card goes in as HPD (As is or
//        Change; lib/release-slot-ops addSlot). Per-card results come back:
//        { releaseId, added, skipped: [{ cardId, error }] }
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function guard(id: string) {
  const supabase = await createClient();
  if (!(await studioUser(supabase))) return { res: NextResponse.json({ error: "Sign in" }, { status: 401 }) };
  const db = admin();
  if (!(await lineSheetInCompany(db, id))) return { res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const { data: sheet } = await db.from("line_sheets").select("id, client_id").eq("id", id).single();
  return { db, sheet: sheet as any };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id); if ("res" in g) return g.res;
  const { db, sheet } = g;
  return NextResponse.json({ releases: await boardReleases(db, sheet.client_id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id); if ("res" in g) return g.res;
  const { db, sheet } = g;
  const b = await req.json().catch(() => ({} as any));
  const cardIds: string[] = Array.isArray(b.cardIds) ? b.cardIds.map(String).slice(0, 200) : [];
  if (!cardIds.length) return NextResponse.json({ error: "No cards" }, { status: 400 });
  let release: any = null;
  let born = false;
  if (b.releaseId) {
    const { data } = await db.from("releases").select("id, client_id, status, company_id").eq("id", String(b.releaseId)).maybeSingle();
    if (!data || (data as any).client_id !== sheet.client_id) return NextResponse.json({ error: "That release isn't this client's" }, { status: 400 });
    if (!OPEN_RELEASE.includes((data as any).status)) return NextResponse.json({ error: `That release is ${(data as any).status}` }, { status: 409 });
    release = data;
  } else {
    const title = String(b.newTitle || "").trim().slice(0, 120);
    if (!title) return NextResponse.json({ error: "Name the release" }, { status: 400 });
    const { data: cl } = await db.from("clients").select("company_id").eq("id", sheet.client_id).single();
    const { data, error } = await db.from("releases").insert({
      company_id: (cl as any)?.company_id || null, client_id: sheet.client_id, title,
      model: null, status: "building", status_timestamps: { building: new Date().toISOString() },
    } as never).select("id, client_id, status, company_id").single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Couldn't start the release" }, { status: 500 });
    release = data;
    born = true;
  }
  let added = 0;
  const skipped: { cardId: string; error: string }[] = [];
  for (const cardId of cardIds) {
    const out = await addSlot(db, release, { cardId }, "ops");
    if (isSlotOpFail(out)) skipped.push({ cardId, error: out.error }); else added++;
  }
  // a release born here that took nothing would sit empty in his hub
  if (born && !added) await db.from("releases").delete().eq("id", release.id);
  return NextResponse.json({ releaseId: born && !added ? null : release.id, added, skipped });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser, lineSheetInCompany } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { mergeJobTypeMeta } from "@/lib/job-type-meta";
import { logJobActivityServer } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LINE SHEET → ORDER (Nov 2026; first run by hand on HPD-2611-022).
// GET  → { job: {id, job_number} | null, pending } — the sheet's order, and how
//        many thumbs-up items aren't on it yet.
// POST → first time: births ONE intake job for the sheet's client (on the
//        sheet's release) with an item per thumbs-up, each carrying its line
//        sheet mockups. After that: adds only the thumbs-ups not yet ordered
//        to that same job. type_meta.line_sheet_item_ids is the ordered set.
// Items are NOT art-approved: a thumbs-up on a comp isn't a print proof.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function sheetOrder(db: any, sheetId: string) {
  const { data } = await db.from("jobs").select("id, job_number, type_meta, phase")
    .eq("type_meta->>line_sheet_id", sheetId).neq("phase", "cancelled")
    .order("created_at", { ascending: true }).limit(1);
  return ((data || []) as any[])[0] || null;
}
async function thumbsUp(db: any, sheetId: string) {
  const { data } = await db.from("line_sheet_items").select("*").eq("sheet_id", sheetId)
    .eq("client_thumb", "up").eq("dropped", false).order("item_no");
  return (data || []) as any[];
}

async function guard(id: string) {
  const supabase = await createClient();
  if (!(await studioUser(supabase))) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  if (!(await lineSheetInCompany(admin(), id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard(params.id); if (denied) return denied;
  const db = admin();
  const [job, ups] = await Promise.all([sheetOrder(db, params.id), thumbsUp(db, params.id)]);
  const ordered = new Set<string>(job?.type_meta?.line_sheet_item_ids || []);
  return NextResponse.json({
    job: job ? { id: job.id, job_number: job.job_number } : null,
    pending: ups.filter(i => !ordered.has(i.id)).length,
  });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard(params.id); if (denied) return denied;
  const db = admin();
  const { data: sheet } = await db.from("line_sheets")
    .select("id, title, client_id, release_id, clients(name, company_id, default_terms)").eq("id", params.id).single();
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const s: any = sheet;

  let job = await sheetOrder(db, params.id);
  const ordered = new Set<string>(job?.type_meta?.line_sheet_item_ids || []);
  const picks = (await thumbsUp(db, params.id)).filter(i => !ordered.has(i.id));
  if (!picks.length) return NextResponse.json({ error: job ? `Every thumbs-up is already on ${job.job_number}` : "No thumbs-up items yet" }, { status: 400 });

  const { data: secs } = await db.from("line_sheet_sections").select("id, name").eq("sheet_id", params.id);
  const secName: Record<string, string> = {};
  for (const x of (secs || []) as any[]) secName[x.id] = x.name;

  const born = !job;
  if (!job) {
    // Terms/route/type ride from the client's latest job, like the release cut.
    const { data: last } = await db.from("jobs").select("id, job_type, payment_terms, shipping_route")
      .eq("client_id", s.client_id).order("created_at", { ascending: false }).limit(1);
    const lastJob = ((last || []) as any[])[0];
    const { data: nj, error: jErr } = await db.from("jobs").insert({
      title: s.title, job_type: lastJob?.job_type || "corporate", phase: "intake",
      payment_terms: lastJob?.payment_terms || s.clients?.default_terms || null,
      shipping_route: lastJob?.shipping_route || null,
      client_id: s.client_id, company_id: s.clients?.company_id || null, release_id: s.release_id || null,
      job_number: "", quote_approved: false,
      type_meta: { source: "line_sheet", line_sheet_id: s.id, line_sheet_item_ids: [], release_id: s.release_id, release_title: s.title },
    } as never).select("id, job_number, type_meta").single();
    if (jErr || !nj) return NextResponse.json({ error: jErr?.message || "Couldn't create the order" }, { status: 500 });
    job = nj;
    if (lastJob?.id) {
      const { data: cs } = await db.from("job_contacts").select("contact_id, role_on_job").eq("job_id", lastJob.id);
      if ((cs || []).length) await db.from("job_contacts").insert((cs as any[]).map(c => ({ job_id: (nj as any).id, contact_id: c.contact_id, role_on_job: c.role_on_job })) as never);
    }
  }

  const { data: existing } = await db.from("items").select("sort_order").eq("job_id", job.id).order("sort_order", { ascending: false }).limit(1);
  let sort = (((existing || []) as any[])[0]?.sort_order ?? -1) + 1;
  const done: string[] = [];
  let failed = 0;
  for (const it of picks) {
    const no = it.item_no != null ? String(it.item_no).padStart(2, "0") : null;
    const name = `${secName[it.section_id] || "Item"} - ${it.name || no || "Untitled"}`.slice(0, 120);
    const { data: item, error: iErr } = await db.from("items").insert({
      job_id: job.id, name, status: "tbd", sort_order: sort++, pipeline_stage: null,
      notes: `From line sheet${no ? ` #${no}` : ""} (client thumbs up)`,
    } as never).select("id").single();
    if (iErr || !item) { failed++; continue; }
    for (const img of (it.images || []) as any[]) {
      if (!img?.driveId) continue;
      await db.from("item_files").insert({
        item_id: (item as any).id, file_name: img.name || `${name} mockup`, stage: "mockup",
        drive_file_id: img.driveId, drive_link: `https://drive.google.com/file/d/${img.driveId}/view`,
        mime_type: /\.png$/i.test(img.name || "") ? "image/png" : /\.jpe?g$/i.test(img.name || "") ? "image/jpeg" : null,
        approval: "none",
      } as never);
    }
    done.push(it.id);
  }
  // Record what's on the order, even on a partial run, so a retry adds only the rest.
  const m = await mergeJobTypeMeta(db, job.id, { line_sheet_item_ids: [...Array.from(ordered), ...done] });
  if (!m.ok) return NextResponse.json({ error: `Items added, but the order record didn't save: ${m.error}` }, { status: 500 });
  try {
    await logJobActivityServer(job.id, born
      ? `Job created from line sheet "${s.title}": ${done.length} thumbs-up item${done.length === 1 ? "" : "s"} with their mockups.`
      : `${done.length} more thumbs-up item${done.length === 1 ? "" : "s"} added from line sheet "${s.title}".`);
  } catch {}
  if (failed) return NextResponse.json({ error: `${failed} item${failed === 1 ? "" : "s"} failed; press again to retry`, jobId: job.id, jobNumber: job.job_number, added: done.length }, { status: 500 });
  return NextResponse.json({ ok: true, jobId: job.id, jobNumber: job.job_number, added: done.length, born });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser, lineSheetInCompany } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { newImageId, publishedImageIds } from "@/lib/line-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Items on a sheet (the draft side — the client only ever sees snapshots).
// POST  → { images: [{driveId, name}] } register uploads: one new TRAY item
//         per image (grouping happens after, like sorting the desktop folder)
// PATCH → { id, name? , sectionId?(null→tray), sort?, images?, drop?, restore?,
//           mergeFrom?, replaceImage? } mergeFrom = another item id whose
//         images fold into this one (front+back become one product; the donor
//         item is removed if it was never published, else dropped).
//         replaceImage = { at, driveId, name, size } swaps one mockup in place
//         (Jon, Nov 25): the item keeps its thumb, comment, number and name.
//         Until the next publish the client keeps seeing the picture it
//         replaced (image.replaces, read by lib/line-sheets clientSheetView).
// DELETE → { id } hard-remove a never-published item
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
// Signed-in studio user AND this sheet is the request's company's.
async function authed(sheetId?: string) {
  const supabase = await createClient();
  const user = await studioUser(supabase);
  if (!user) return false;
  return sheetId ? lineSheetInCompany(admin(), sheetId) : true;
}

// Pairing "Smiley Tee Front" + "Smiley Tee Back" → "Smiley Tee": the words the
// two names share from the start, trailing separators trimmed. Nothing shared
// → the first name stands.
function pairName(a: string | null, b: string | null): string | null {
  if (!a || !b) return a || b || null;
  const wa = a.trim().split(/\s+/), wb = b.trim().split(/\s+/);
  const common: string[] = [];
  for (let i = 0; i < Math.min(wa.length, wb.length) && wa[i].toLowerCase() === wb[i].toLowerCase(); i++) common.push(wa[i]);
  const joined = common.join(" ").replace(/[\s\-–—·_|,:/]+$/, "").trim();
  // two shared words at least: "The Front" + "The Back" must not become "The"
  return joined && common.length >= 2 && common.length < Math.max(wa.length, wb.length) ? joined : a;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed(params.id))) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const imgs = Array.isArray(b.images) ? b.images.filter((i: any) => i?.driveId) : [];
  if (!imgs.length) return NextResponse.json({ error: "No images" }, { status: 400 });
  const db = admin();
  const { data: maxRow } = await db.from("line_sheet_items").select("sort").eq("sheet_id", params.id).order("sort", { ascending: false }).limit(1).maybeSingle();
  let sort = ((maxRow as any)?.sort || 0) + 1;
  // splitFrom = unpair. Splitting is organizing (live, Oct 1 2026): the new
  // singles inherit the source's published state + shelf and get their own
  // numbers, so they stay on the client's sheet instead of vanishing until
  // the next publish. Plain uploads stay drafts (added_in null).
  let from: any = null;
  if (b.splitFrom) {
    const { data } = await db.from("line_sheet_items").select("section_id, added_in, sort").eq("id", b.splitFrom).eq("sheet_id", params.id).maybeSingle();
    from = data;
  }
  let nextNo = 0;
  if (from?.added_in != null) {
    const { data: maxNo } = await db.from("line_sheet_items").select("item_no").eq("sheet_id", params.id).not("item_no", "is", null).order("item_no", { ascending: false }).limit(1).maybeSingle();
    nextNo = (((maxNo as any)?.item_no) || 0) + 1;
  }
  const rows = imgs.map((i: any) => ({
    // A plain upload is named by its file, minus the extension (Jon, Nov 2026:
    // mockups are saved with descriptive names). A split stays unnamed.
    sheet_id: params.id, section_id: from ? from.section_id : null,
    name: from ? null : (String(i.name || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim().slice(0, 140) || null), sort: sort++,
    images: [{ id: newImageId(), driveId: String(i.driveId), name: i.name || null, ...(Number(i.size) > 0 ? { size: Number(i.size) } : {}) }],
    ...(from?.added_in != null ? { added_in: from.added_in, item_no: nextNo++ } : {}),
  }));
  const { data, error } = await db.from("line_sheet_items").insert(rows as never).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("line_sheets").update({ updated_at: new Date().toISOString() } as never).eq("id", params.id);
  return NextResponse.json({ items: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed(params.id))) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  // Drag-to-reorder: { reorder: [{id, sort}] } — one shelf's new order.
  if (Array.isArray(b.reorder)) {
    const db = admin();
    for (const r of (b.reorder as any[]).slice(0, 500)) {
      if (!r?.id) continue;
      const { error } = await db.from("line_sheet_items").update({ sort: Number(r.sort) || 0 } as never).eq("id", r.id).eq("sheet_id", params.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await db.from("line_sheets").update({ updated_at: new Date().toISOString() } as never).eq("id", params.id);
    return NextResponse.json({ ok: true });
  }
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = admin();
  const { data: item } = await db.from("line_sheet_items").select("*").eq("id", b.id).eq("sheet_id", params.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.mergeFrom) {
    const { data: donor } = await db.from("line_sheet_items").select("*").eq("id", b.mergeFrom).eq("sheet_id", params.id).maybeSingle();
    if (!donor) return NextResponse.json({ error: "Merge source not found" }, { status: 404 });
    const merged = [ ...((item as any).images || []), ...((donor as any).images || []) ];
    // Grouping is organizing (live): the client's reaction survives it. The
    // kept item inherits the donor's thumb, and separately its comment, when
    // it has none of its own.
    const keepThumb = (item as any).client_thumb ? {} : (donor as any).client_thumb ? {
      client_thumb: (donor as any).client_thumb, client_thumb_at: (donor as any).client_thumb_at, client_thumb_version: (donor as any).client_thumb_version,
    } : {};
    const keepNote = (item as any).client_note ? {} : (donor as any).client_note ? {
      client_note: (donor as any).client_note, client_note_version: (donor as any).client_note_version,
    } : {};
    await db.from("line_sheet_items").update({ images: merged, name: pairName((item as any).name, (donor as any).name), ...keepThumb, ...keepNote } as never).eq("id", b.id);
    if ((donor as any).added_in == null) await db.from("line_sheet_items").delete().eq("id", b.mergeFrom);
    else await db.from("line_sheet_items").update({ dropped: true } as never).eq("id", b.mergeFrom);
  }

  const patch: Record<string, any> = {};
  if (b.name !== undefined) patch.name = b.name ? String(b.name).trim().slice(0, 140) : null;
  if (b.sectionId !== undefined) {
    patch.section_id = b.sectionId || null;
    // landing on a shelf mints the item's permanent number — never reshuffled
    if (b.sectionId && (item as any).item_no == null) {
      const { data: maxRow } = await db.from("line_sheet_items").select("item_no").eq("sheet_id", params.id).not("item_no", "is", null).order("item_no", { ascending: false }).limit(1).maybeSingle();
      patch.item_no = (((maxRow as any)?.item_no) || 0) + 1;
    }
  }
  if (b.sort !== undefined) patch.sort = Number(b.sort) || 0;
  if (b.images !== undefined && Array.isArray(b.images)) patch.images = b.images.filter((i: any) => i?.driveId).map((i: any) => ({ id: i.id || newImageId(), driveId: String(i.driveId), name: i.name || null, ...(Number(i.size) > 0 ? { size: Number(i.size) } : {}), ...(i.replaces?.driveId ? { replaces: { driveId: String(i.replaces.driveId), name: i.replaces.name || null } } : {}) }));
  if (b.replaceImage) {
    const r = b.replaceImage, imgs: any[] = [...((item as any).images || [])];
    const at = Number(r.at);
    if (!Number.isInteger(at) || at < 0 || at >= imgs.length || !r.driveId) return NextResponse.json({ error: "Nothing to replace there" }, { status: 400 });
    const old = imgs[at];
    // what the client is looking at now: the old picture if it was published,
    // or whatever an unpublished earlier replacement was standing in for
    const published = await publishedImageIds(db, params.id);
    const shown = published.has(old.driveId) ? { driveId: old.driveId, name: old.name || null } : old.replaces || null;
    imgs[at] = { id: newImageId(), driveId: String(r.driveId), name: r.name || null, ...(Number(r.size) > 0 ? { size: Number(r.size) } : {}), ...(shown ? { replaces: shown } : {}) };
    patch.images = imgs;
  }
  if (b.drop) { patch.dropped = true; }
  if (b.restore) { patch.dropped = false; patch.dropped_in = null; }
  if (Object.keys(patch).length) {
    const { error } = await db.from("line_sheet_items").update(patch as never).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await db.from("line_sheets").update({ updated_at: new Date().toISOString() } as never).eq("id", params.id);
  const { data: fresh } = await db.from("line_sheet_items").select("*").eq("id", b.id).maybeSingle();
  return NextResponse.json({ item: fresh || null });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed(params.id))) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const db = admin();
  const { data: item } = await db.from("line_sheet_items").select("id, added_in").eq("id", b.id).eq("sheet_id", params.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((item as any).added_in != null) return NextResponse.json({ error: "Published items drop, they don't delete" }, { status: 409 });
  await db.from("line_sheet_items").delete().eq("id", b.id);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { newImageId } from "@/lib/line-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Items on a sheet (the draft side — the client only ever sees snapshots).
// POST  → { images: [{driveId, name}] } register uploads: one new TRAY item
//         per image (grouping happens after, like sorting the desktop folder)
// PATCH → { id, name? , sectionId?(null→tray), sort?, images?, drop?, restore?,
//           mergeFrom? } mergeFrom = another item id whose images fold into
//         this one (front+back become one product; the donor item is removed
//         if it was never published, else dropped)
// DELETE → { id } hard-remove a never-published item
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
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
    sheet_id: params.id, section_id: from ? from.section_id : null, name: null, sort: sort++,
    images: [{ id: newImageId(), driveId: String(i.driveId), name: i.name || null }],
    ...(from?.added_in != null ? { added_in: from.added_in, item_no: nextNo++ } : {}),
  }));
  const { data, error } = await db.from("line_sheet_items").insert(rows as never).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("line_sheets").update({ updated_at: new Date().toISOString() } as never).eq("id", params.id);
  return NextResponse.json({ items: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await authed())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = admin();
  const { data: item } = await db.from("line_sheet_items").select("*").eq("id", b.id).eq("sheet_id", params.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.mergeFrom) {
    const { data: donor } = await db.from("line_sheet_items").select("*").eq("id", b.mergeFrom).eq("sheet_id", params.id).maybeSingle();
    if (!donor) return NextResponse.json({ error: "Merge source not found" }, { status: 404 });
    const merged = [ ...((item as any).images || []), ...((donor as any).images || []) ];
    // Grouping is organizing (live): the client's reaction survives it. The
    // kept item inherits the donor's thumb when it has none of its own.
    const keepThumb = (item as any).client_thumb ? {} : (donor as any).client_thumb ? {
      client_thumb: (donor as any).client_thumb, client_thumb_at: (donor as any).client_thumb_at, client_thumb_version: (donor as any).client_thumb_version, client_thumb_note: (donor as any).client_thumb_note,
    } : {};
    await db.from("line_sheet_items").update({ images: merged, name: (item as any).name || (donor as any).name, ...keepThumb } as never).eq("id", b.id);
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
  if (b.images !== undefined && Array.isArray(b.images)) patch.images = b.images.filter((i: any) => i?.driveId).map((i: any) => ({ id: i.id || newImageId(), driveId: String(i.driveId), name: i.name || null }));
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
  if (!(await authed())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const db = admin();
  const { data: item } = await db.from("line_sheet_items").select("id, added_in").eq("id", b.id).eq("sheet_id", params.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((item as any).added_in != null) return NextResponse.json({ error: "Published items drop, they don't delete" }, { status: 409 });
  await db.from("line_sheet_items").delete().eq("id", b.id);
  return NextResponse.json({ ok: true });
}

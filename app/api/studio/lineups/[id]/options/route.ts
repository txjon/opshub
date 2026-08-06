import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST multipart { file } — add one option to a DRAFT lineup. The browser
// fires these in parallel for a bulk drop; position is assigned from the
// current max so numbers follow arrival. Files land in the design's own
// Drive tree ({Client}/Studio/{Design} — Lineup) — the data map holds.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();
  const { data: lineup } = await db.from("lineups")
    .select("id, sent_at, closed_at, art_briefs!lineups_brief_id_fkey(id, title, clients(name))")
    .eq("id", params.id).maybeSingle();
  if (!lineup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((lineup as any).sent_at || (lineup as any).closed_at) return NextResponse.json({ error: "This round already went out" }, { status: 409 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.size) return NextResponse.json({ error: "No file" }, { status: 400 });

  const brief = (lineup as any).art_briefs;
  const folderId = await getItemFolderId(brief?.clients?.name || "Studio", "Studio", `${brief?.title || "Design"} — Lineup`);
  const buffer = Buffer.from(await file.arrayBuffer());
  const up = await uploadFile(folderId, file.name || "option.png", file.type || "image/png", buffer);

  const { data: maxRow } = await db.from("lineup_options").select("position").eq("lineup_id", params.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const position = ((maxRow as any)?.position || 0) + 1;
  const { data: opt, error } = await db.from("lineup_options").insert({
    lineup_id: params.id, position,
    drive_file_id: up.fileId, drive_link: up.webViewLink,
    mime_type: file.type || null, file_size: buffer.length,
  } as never).select("id, position").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ option: opt });
}
